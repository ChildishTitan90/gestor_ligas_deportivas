import "server-only";
import { z } from "zod";
import { isCalendarDate, normalizeCurp, normalizeIdentityName } from "../identity-rules";
import { playerIdentitySchema, type PlayerIdentityInput } from "../schemas";
import { identityFields, type CurpProviderResult } from "../curp-verification";

const endpoint = "https://api.verificamex.com/identity/v1/scraping/renapo";
const citizenRecord = z.object({
  curp: z.string().min(1).max(64), nombres: z.string().min(1).max(240),
  primerApellido: z.string().min(1).max(240), segundoApellido: z.string().max(240).nullable().optional(),
  fechaNacimiento: z.string().refine(isCalendarDate),
});
const responseSchema = z.object({ data: z.object({ object: z.literal("citizeninformations"),
  citizen: z.object({ codigo: z.number().int(), status: z.boolean(), registros: z.array(citizenRecord).max(10) }),
}) });

export type CurpProvider = {
  configured: boolean;
  verify: (identity: PlayerIdentityInput) => Promise<CurpProviderResult>;
};

/** Transporte obligatorio para que las pruebas sintéticas nunca usen fetch por omisión. */
export function createVerificamexCurpAdapter({ apiKey, transport, timeoutMs = 10_000 }: {
  apiKey: string | undefined; transport: typeof fetch; timeoutMs?: number;
}): CurpProvider {
  const key = apiKey?.trim();
  return { configured: Boolean(key), async verify(identity) {
    if (!key) throw new Error("VMX_NOT_CONFIGURED");
    const parsedIdentity = playerIdentitySchema.safeParse(identity);
    if (!parsedIdentity.success) return result("UNEXPECTED_RESPONSE");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<CurpProviderResult>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(result("UNCERTAIN")); }, timeoutMs);
    });
    try {
      return await Promise.race([timeout, (async (): Promise<CurpProviderResult> => {
        try {
          const response = await transport(endpoint, { method: "POST", cache: "no-store", redirect: "error",
            headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${key}` },
            body: JSON.stringify({ curp: parsedIdentity.data.curp, pdf_required: false }), signal: controller.signal });
          if (response.status === 401 || response.status === 403) return result("INVALID_CREDENTIALS");
          // Clasificación HTTP defensiva; el contrato concreto de saldo se contrasta en la prueba humana.
          if (response.status === 402) return result("INSUFFICIENT_BALANCE");
          if (response.status === 429 || response.status >= 500) return result("UNAVAILABLE");
          if (response.status !== 200 || !response.headers.get("content-type")?.includes("application/json"))
            return result("UNEXPECTED_RESPONSE");
          const body = await readBoundedJson(response);
          const parsed = responseSchema.safeParse(body);
          if (!parsed.success) return result("UNEXPECTED_RESPONSE");
          const citizen = parsed.data.data.citizen;
          // No inventar el significado de códigos RENAPO no documentados.
          if (!citizen.status || citizen.codigo !== 0) return result("UNEXPECTED_RESPONSE");
          if (!citizen.registros.length) return result("NOT_FOUND");
          if (citizen.registros.length !== 1) return result("UNEXPECTED_RESPONSE");
          const record = citizen.registros[0];
          const received = { curp: normalizeCurp(record.curp), firstName: record.nombres,
            paternalSurname: record.primerApellido, maternalSurname: record.segundoApellido ?? null,
            birthDate: record.fechaNacimiento };
          const mismatchedFields = identityFields.filter(field => field === "curp" || field === "birthDate"
            ? received[field] !== parsedIdentity.data[field]
            : normalizeIdentityName(received[field] ?? "") !== normalizeIdentityName(parsedIdentity.data[field] ?? ""));
          return { status: mismatchedFields.length ? "DISCREPANCY" : "VERIFIED", mismatchedFields };
        } catch {
          // Red, aborto o respuesta que se corta: se desconoce si el proveedor cobró. No reintentar.
          return result("UNCERTAIN");
        }
      })()]);
    } finally { clearTimeout(timer!); }
  } };
}

function result(status: CurpProviderResult["status"]): CurpProviderResult { return { status, mismatchedFields: [] }; }

async function readBoundedJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 131_072) { await reader.cancel(); return null; }
    chunks.push(part.value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}

/** Único cableado real, privado y diferido hasta una operación autenticada. */
export function getVerificamexCurpProvider(): CurpProvider {
  if (process.env.AUTH_TEST_RUN === "1") throw new Error("SYNTHETIC_TRANSPORT_REQUIRED");
  return createVerificamexCurpAdapter({ apiKey: process.env.VMX_API_KEY, transport: fetch });
}
