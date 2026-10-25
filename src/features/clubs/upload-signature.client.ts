import { z } from "zod";

const MAX_BYTES = 10 * 1024 * 1024;

const contextSchema = z.strictObject({
  clubId: z.uuid(),
  seasonId: z.uuid(),
  office: z.enum(["PRESIDENT", "SECRETARY", "TREASURER"]),
  storageOrigin: z.url(),
});

const preparedSchema = z.strictObject({
  ticket: z.string().min(1).max(4096),
  uploadUrl: z.url(),
});

const confirmedSchema = z.strictObject({
  signatureFileId: z.uuid(),
});

export type SignatureUploadInput = {
  file: File;
  clubId: string;
  seasonId: string;
  office: "PRESIDENT" | "SECRETARY" | "TREASURER";
  storageOrigin: string;
};

export class SignatureUploadClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignatureUploadClientError";
  }
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new SignatureUploadClientError(
      "No pudimos confirmar la respuesta. Reintenta la carga.",
    );
  }
}

// Crear una tarea por archivo y contexto.
// Conservar la misma tarea cuando se pulsa Reintentar.
export function createSignatureUploadTask(
  input: SignatureUploadInput,
  fetcher: typeof fetch = fetch,
) {
  const parsed = contextSchema.safeParse({
    clubId: input.clubId,
    seasonId: input.seasonId,
    office: input.office,
    storageOrigin: input.storageOrigin,
  });

  if (!parsed.success) {
    throw new SignatureUploadClientError(
      "El contexto de la carga no es válido.",
    );
  }

  const context = parsed.data;
  const origin = new URL(context.storageOrigin);

  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  ) {
    throw new SignatureUploadClientError(
      "El destino de almacenamiento no es válido.",
    );
  }

  const file = input.file;

  if (
    !["image/png", "image/jpeg", "application/pdf"].includes(file.type) ||
    file.size === 0 ||
    file.size > MAX_BYTES
  ) {
    throw new SignatureUploadClientError(
      "Selecciona un PNG, JPEG o PDF de hasta 10 MiB que no esté vacío.",
    );
  }

  let prepared: z.infer<typeof preparedSchema> | undefined;
  let uploaded = false;
  let inFlight: Promise<string> | undefined;

  async function perform(): Promise<string> {
    if (!prepared) {
      const response = await fetcher(
        "/api/affiliations/signatures/prepare",
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clubId: context.clubId,
            seasonId: context.seasonId,
            office: context.office,
            mimeType: file.type,
            sizeBytes: file.size,
          }),
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!response.ok) {
        throw new SignatureUploadClientError(
          "No se pudo autorizar la carga. Revisa tu sesión y permisos.",
        );
      }

      const result = preparedSchema.safeParse(
        await readJson(response),
      );

      if (!result.success) {
        throw new SignatureUploadClientError(
          "La preparación devolvió una respuesta incompleta.",
        );
      }

      const destination = new URL(result.data.uploadUrl);

      if (
        destination.origin !== origin.origin ||
        destination.username ||
        destination.password ||
        destination.hash ||
        !destination.pathname.startsWith(
          "/storage/v1/object/upload/sign/firmas-afiliacion/",
        )
      ) {
        throw new SignatureUploadClientError(
          "El destino recibido no corresponde al almacenamiento configurado.",
        );
      }

      prepared = result.data;
    }

    if (!uploaded) {
      const response = await fetcher(prepared.uploadUrl, {
        method: "PUT",
        credentials: "omit",
        redirect: "error",
        headers: {
          "Content-Type": file.type,
          "Cache-Control": "max-age=0",
        },
        body: await file.arrayBuffer(),
        signal: AbortSignal.timeout(60_000),
      });

      // Una respuesta perdida puede dejar el objeto ya almacenado.
      // Un conflicto permite intentar su confirmación, sin sobrescribirlo.
      if (!response.ok && response.status !== 409) {
        throw new SignatureUploadClientError(
          "No se pudo completar la subida. Conserva el archivo y reintenta.",
        );
      }

      uploaded = true;
    }

    const response = await fetcher(
      "/api/affiliations/signatures/confirm",
      {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket: prepared.ticket }),
        signal: AbortSignal.timeout(30_000),
      },
    );

    if (!response.ok) {
      throw new SignatureUploadClientError(
        response.status === 403
          ? "No se autorizó la confirmación. Comprueba tu sesión, permisos o la vigencia de la carga."
          : response.status === 400 || response.status === 413
            ? "El servidor rechazó el archivo. Selecciona una firma válida."
            : "El archivo se subió, pero falta confirmar su registro. Reintenta.",
      );
    }

    const result = confirmedSchema.safeParse(
      await readJson(response),
    );

    if (!result.success) {
      throw new SignatureUploadClientError(
        "No recibimos un identificador válido. Reintenta la confirmación.",
      );
    }

    return result.data.signatureFileId;
  }

  return {
    run(): Promise<string> {
      if (!inFlight) {
        inFlight = perform()
          .catch((error: unknown) => {
            if (error instanceof SignatureUploadClientError) {
              throw error;
            }

            throw new SignatureUploadClientError(
              "Se interrumpió la conexión. Conserva el archivo y reintenta.",
            );
          })
          .finally(() => {
            inFlight = undefined;
          });
      }

      return inFlight;
    },
  };
}