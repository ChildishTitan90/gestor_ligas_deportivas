import assert from "node:assert/strict";
import test from "node:test";
import { checkPrivateSignatureDownload } from "./signature-download-check";

const origin = "https://storage.example.test";
const bucket = "firmas-afiliacion";
const key = "affiliation-signatures/v1/test-context/file";
const path = `/storage/v1/object/sign/${bucket}/${key}`;
const bytes = new Uint8Array([1, 2, 3]);

function setup(failure?: "public" | "content" | "expiry" | "network" | "cleanup") {
  const removed: string[] = [];
  let expired = false;
  const provider = {
    storage: {
      async put(input: string) { assert.equal(input, key); },
      async remove(input: string) { removed.push(input); if (failure === "cleanup") throw new Error("SYNTHETIC_FAILURE"); },
    },
    async createDownloadUrl() { return { signedUrl: `${origin}${path}?token=synthetic`, expiresInSeconds: 60 }; },
  };
  const request: typeof fetch = async (address, options) => {
    assert.equal(options?.credentials, "omit"); assert.equal(options?.redirect, "error"); assert.equal(options?.cache, "no-store");
    if (failure === "network") throw new Error("SYNTHETIC_FAILURE");
    const url = new URL(String(address));
    if (!url.searchParams.has("token")) return new Response(null, { status: failure === "public" ? 200 : 403 });
    if (expired) return new Response(null, { status: failure === "expiry" ? 200 : 403 });
    return new Response(failure === "content" ? new Uint8Array([3, 2, 1]) : bytes, { headers: { "content-type": "image/png" } });
  };
  const wait = async (milliseconds: number) => { assert.equal(milliseconds, 65000); expired = true; };
  return { provider, request, wait, removed };
}

test("Comprobador de descarga: verifica contenido, privacidad, vencimiento y limpieza con proveedor simulado", async () => {
  const testCase = setup();
  assert.deepEqual(await checkPrivateSignatureDownload(testCase.provider, { origin, bucket, key, bytes, ...testCase }), {
    contentMatches: true, unsignedAccessDenied: true, publicAccessDenied: true, expirationVerified: true,
  });
  assert.deepEqual(testCase.removed, [key]);
});

test("Comprobador de descarga: los fallos de contenido, privacidad, vencimiento o red conservan la limpieza", async () => {
  for (const [failure, code] of [["public", "PUBLIC_ACCESS_ALLOWED"], ["content", "CONTENT_MISMATCH"],
    ["expiry", "LINK_DID_NOT_EXPIRE"], ["network", "SYNTHETIC_FAILURE"]] as const) {
    const testCase = setup(failure);
    await assert.rejects(checkPrivateSignatureDownload(testCase.provider, { origin, bucket, key, bytes, ...testCase }), new RegExp(code));
    assert.deepEqual(testCase.removed, [key]);
  }
});

test("Comprobador de descarga: una limpieza fallida impide declarar la comprobación aprobada", async () => {
  const testCase = setup("cleanup");
  await assert.rejects(checkPrivateSignatureDownload(testCase.provider, { origin, bucket, key, bytes, ...testCase }), /CLEANUP_FAILED/);
});
