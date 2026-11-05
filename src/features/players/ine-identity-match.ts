import { z } from "zod";
import { identityFields } from "./curp-verification";
import { curpMatchesBirthDate, hasValidCurpStructure, isCalendarDate, normalizeCurp } from "./identity-rules";
import { playerIdentitySchema, type PlayerIdentityInput } from "./schemas";

export const ineReadingSchema = z.strictObject({ field: z.enum(identityFields), value: z.string().max(240) });
export type IneReading = z.infer<typeof ineReadingSchema>;
export type IneMatch = { status: "IDENTITY_VERIFIED" | "ADMIN_REVIEW_REQUIRED"; missingFields: typeof identityFields[number][]; mismatchedFields: typeof identityFields[number][] };

// Acentos tipográficos y espacios no distinguen una identidad; Ñ, separadores y orden sí.
function name(value: string) {
  return value.normalize("NFC").toUpperCase().split("Ñ").map(part=>part.normalize("NFD").replace(/\p{M}/gu,"")).join("Ñ").trim().replace(/\s+/g," ");
}
function birthDate(value: string) {
  const found = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!found) return null;
  const date = `${found[3]}-${found[2]}-${found[1]}`;
  return isCalendarDate(date) ? date : null;
}
/** Solo igualdad de todos los datos explícitos, sin aproximaciones ni adivinar siglos. */
export function matchIneIdentity(expected: PlayerIdentityInput, readings: IneReading[]): IneMatch {
  const missingFields: IneMatch["missingFields"] = [], mismatchedFields: IneMatch["mismatchedFields"] = [];
  if (!playerIdentitySchema.safeParse(expected).success) return { status:"ADMIN_REVIEW_REQUIRED", missingFields:[...identityFields], mismatchedFields:[] };
  for (const field of identityFields) {
    const values = readings.filter(r => r.field === field).map(r => r.value);
    if (!values.length) { missingFields.push(field); continue; }
    const wanted = field === "curp" ? normalizeCurp(expected.curp) : field === "birthDate" ? expected.birthDate : name(expected[field] ?? "");
    let missing = false, different = false;
    for (const value of values) {
      if (field === "curp") {
        const received = normalizeCurp(value);
        if (!hasValidCurpStructure(received)) missing = true;
        else if (received !== wanted || !curpMatchesBirthDate(received,expected.birthDate)) different = true;
      } else if (field === "birthDate") {
        const received = birthDate(value);
        if (!received) missing = true; else if (received !== wanted) different = true;
      } else {
        const received = name(value);
        if (!received && !(field === "maternalSurname" && expected.maternalSurname === null)) missing = true;
        else if (received !== wanted) different = true;
      }
    }
    if (missing) missingFields.push(field);
    if (different) mismatchedFields.push(field);
  }
  return {status: missingFields.length || mismatchedFields.length ? "ADMIN_REVIEW_REQUIRED" : "IDENTITY_VERIFIED", missingFields, mismatchedFields};
}
