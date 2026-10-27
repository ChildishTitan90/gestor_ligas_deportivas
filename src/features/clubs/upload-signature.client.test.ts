import assert from "node:assert/strict";
import test from "node:test";
import {
  createSignatureUploadTask,
  SignatureUploadClientError,
} from "./upload-signature.client";

const preparePath = "/api/affiliations/signatures/prepare";
const confirmPath = "/api/affiliations/signatures/confirm";
const storageOrigin = "https://storage.example.test";
const uploadUrl =
  `${storageOrigin}/storage/v1/object/upload/sign/` +
  "firmas-afiliacion/synthetic-file?token=synthetic";
const fileId = "59000000-0000-4000-8000-000000000001";

// Estos bytes prueban el transporte del cliente.
// La validación de contenido real se prueba en el servidor.
function validInput() {
  return {
    file: new File(
      [new Uint8Array([1, 2, 3])],
      "firma-sintetica.png",
      { type: "image/png" },
    ),
    clubId: "59000000-0000-4000-8000-000000000002",
    seasonId: "59000000-0000-4000-8000-000000000003",
    office: "PRESIDENT" as const,
    storageOrigin,
  };
}

function preparedResponse() {
  return Response.json({
    ticket: "comprobante-sintetico",
    uploadUrl,
  });
}

function confirmedResponse() {
  return Response.json({ signatureFileId: fileId });
}

test("carga el archivo y devuelve solo el identificador confirmado", async () => {
  const requests: string[] = [];

  const fetcher: typeof fetch = async (url, options) => {
    requests.push(String(url));

    if (url === preparePath) {
      assert.equal(options?.method, "POST");
      assert.equal(options?.credentials, "same-origin");
      return preparedResponse();
    }

    if (url === uploadUrl) {
      assert.equal(options?.method, "PUT");
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.redirect, "error");
      assert.equal(
        new Headers(options?.headers).get("authorization"),
        null,
      );
      assert.equal(
        new Headers(options?.headers).get("apikey"),
        null,
      );

      const bytes = new Uint8Array(options?.body as ArrayBuffer);
      assert.deepEqual([...bytes], [1, 2, 3]);

      return new Response(null, { status: 200 });
    }

    assert.equal(url, confirmPath);
    assert.equal(options?.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(options?.body)), {
      ticket: "comprobante-sintetico",
    });

    return confirmedResponse();
  };

  const task = createSignatureUploadTask(validInput(), fetcher);

  assert.equal(await task.run(), fileId);
  assert.deepEqual(requests, [
    preparePath,
    uploadUrl,
    confirmPath,
  ]);
});

test("un rechazo de autorización impide subir el archivo", async () => {
  const requests: string[] = [];

  const fetcher: typeof fetch = async (url) => {
    requests.push(String(url));

    return Response.json(
      { code: "FORBIDDEN" },
      { status: 403 },
    );
  };

  const task = createSignatureUploadTask(validInput(), fetcher);

  await assert.rejects(task.run(), SignatureUploadClientError);
  assert.deepEqual(requests, [preparePath]);
});

test("rechaza un destino de almacenamiento inesperado", async () => {
  let requests = 0;

  const fetcher: typeof fetch = async () => {
    requests++;

    return Response.json({
      ticket: "comprobante-sintetico",
      uploadUrl:
        "https://unexpected.example.test/storage/v1/object/upload/sign/firmas-afiliacion/file",
    });
  };

  const task = createSignatureUploadTask(validInput(), fetcher);

  await assert.rejects(task.run(), SignatureUploadClientError);
  assert.equal(requests, 1);
});

test("reintenta la confirmación sin volver a preparar ni subir", async () => {
  const requests: string[] = [];
  const confirmations: string[] = [];

  const fetcher: typeof fetch = async (url, options) => {
    requests.push(String(url));

    if (url === preparePath) return preparedResponse();

    if (url === uploadUrl) {
      return new Response(null, { status: 200 });
    }

    assert.equal(url, confirmPath);
    confirmations.push(String(options?.body));

    if (confirmations.length === 1) {
      throw new TypeError("Respuesta perdida de prueba");
    }

    return confirmedResponse();
  };

  const task = createSignatureUploadTask(validInput(), fetcher);

  await assert.rejects(task.run(), SignatureUploadClientError);
  assert.equal(await task.run(), fileId);

  assert.deepEqual(requests, [
    preparePath,
    uploadUrl,
    confirmPath,
    confirmPath,
  ]);
  assert.equal(confirmations[0], confirmations[1]);
});

test("dos llamadas simultáneas comparten la misma carga", async () => {
  const requests: string[] = [];

  const fetcher: typeof fetch = async (url) => {
    requests.push(String(url));

    if (url === preparePath) return preparedResponse();

    if (url === uploadUrl) {
      return new Response(null, { status: 200 });
    }

    assert.equal(url, confirmPath);
    return confirmedResponse();
  };

  const task = createSignatureUploadTask(validInput(), fetcher);
  const first = task.run();
  const second = task.run();

  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), [
    fileId,
    fileId,
  ]);
  assert.deepEqual(requests, [
    preparePath,
    uploadUrl,
    confirmPath,
  ]);
});