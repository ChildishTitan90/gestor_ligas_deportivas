import "server-only";
import { z } from "zod";
import type { ValidatedBinaryFile } from "@/server/files/private-file-validation";
import { ineReadingSchema, type IneReading } from "../ine-identity-match";

export type IneImages = Record<"front" | "back" | "selfie", ValidatedBinaryFile>;
export const ineProviderResultSchema=z.strictObject({status:z.enum(["PROVIDER_PASSED","ADMIN_REVIEW_REQUIRED","INVALID_CREDENTIALS","INSUFFICIENT_BALANCE","UNAVAILABLE","UNCERTAIN"]),readings:z.array(ineReadingSchema).max(100).default([])});
export type IneProviderResult=z.infer<typeof ineProviderResultSchema>;
export type IneProvider = { configured: boolean; verify(images: IneImages): Promise<IneProviderResult> };
const responseSchema = z.object({ data: z.object({ object: z.literal("ine_validations"), status: z.boolean(),
  documentInformation:z.object({documentData:z.array(z.object({type:z.string(),source:z.string(),value:z.unknown()})).max(500),
    // No ignorar fallos explícitos o códigos desconocidos que contradigan el dictamen global.
    documentVerifications:z.array(z.object({result:z.literal("Ok"),resultCode:z.literal(0)})).max(500).optional(),
  }).optional(),
}) });
function result(status:IneProviderResult["status"]):IneProviderResult{return {status,readings:[]};}
function extractReadings(entries:NonNullable<z.infer<typeof responseSchema>["data"]["documentInformation"]>["documentData"]):IneReading[]{
  const fields:Record<string,IneReading["field"]>={Name:"firstName",FatherSurname:"paternalSurname",MotherSurname:"maternalSurname",DateOfBirth:"birthDate",PersonalNumber:"curp"};
  return entries.flatMap(entry=>{
    const field=fields[entry.type];
    // PersonalNumber de MRZ es otro identificador, no CURP. No se confunden ambos.
    if(!field || !["OCR","MRZ"].includes(entry.source) || (field==="curp" && entry.source!=="OCR"))return [];
    return [{field,value:typeof entry.value==="string" && entry.value.length<=240?entry.value:""}];
  });
}

/** Transporte obligatorio: las pruebas nunca obtienen fetch de forma implícita. */
export function createVerificamexIneAdapter({ apiKey, transport, timeoutMs = 55_000 }: {
  apiKey?: string; transport: typeof fetch; timeoutMs?: number;
}): IneProvider {
  const key = apiKey?.trim();
  return { configured: Boolean(key), async verify(images) {
    if (!key) throw new Error("VMX_NOT_CONFIGURED");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<IneProviderResult>(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(result("UNCERTAIN")); }, timeoutMs);
    });
    const request = async (): Promise<IneProviderResult> => {
      try {
        const encode = (part: keyof IneImages) => `data:${images[part].mimeType};base64,${Buffer.from(images[part].bytes).toString("base64")}`;
        const response = await transport("https://api.verificamex.com/identity/v2/validations/basic", {
          method: "POST", redirect: "error", cache: "no-store", signal: controller.signal,
          headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ ine_front: encode("front"), ine_back: encode("back"), selfie: encode("selfie"), qr_validation: false }),
        });
        if (response.status === 401 || response.status === 403) { await response.body?.cancel(); return result("INVALID_CREDENTIALS"); }
        if (response.status === 402) { await response.body?.cancel(); return result("INSUFFICIENT_BALANCE"); }
        if (response.status === 429 || response.status >= 500) { await response.body?.cancel(); return result("UNAVAILABLE"); }
        if (response.status !== 200 || !response.headers.get("content-type")?.includes("application/json")) {
          await response.body?.cancel(); return result("ADMIN_REVIEW_REQUIRED");
        }
        const reader = response.body?.getReader();
        if (!reader) return result("ADMIN_REVIEW_REQUIRED");
        const chunks: Uint8Array[] = []; let total = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read(); if (done) break;
            total += value.byteLength;
            if (total > 262144) { await reader.cancel(); return result("ADMIN_REVIEW_REQUIRED"); }
            chunks.push(value);
          }
        } finally { reader.releaseLock(); }
        const parsed = responseSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        if(!parsed.success || !parsed.data.data.status)return result("ADMIN_REVIEW_REQUIRED");
        // Lecturas mínimas transitorias para cotejar; jamás se guardan en auditoría o DTOs.
        const readings=extractReadings(parsed.data.data.documentInformation?.documentData ?? []);
        const checked=ineProviderResultSchema.safeParse({status:"PROVIDER_PASSED",readings});
        return checked.success?checked.data:result("ADMIN_REVIEW_REQUIRED");
      } catch { return result("UNCERTAIN"); }
    };
    try { return await Promise.race([deadline, request()]); } finally { clearTimeout(timer); }
  } };
}
export function getVerificamexIneProvider(): IneProvider {
  if (process.env.AUTH_TEST_RUN === "1") throw new Error("SYNTHETIC_TRANSPORT_REQUIRED");
  return createVerificamexIneAdapter({ apiKey: process.env.VMX_API_KEY, transport: fetch });
}
