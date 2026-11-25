import { z } from "zod";

export const chargeConceptLabels = {
  REGISTRATION: "Inscripción",
  REFEREE_FEE: "Arbitraje",
  VENUE: "Cancha",
  FINE: "Multa",
} as const;

export const chargeConcept = z.enum(["REGISTRATION", "REFEREE_FEE", "VENUE", "FINE"], { error: "Selecciona un concepto." });
const manualConcept = chargeConcept.exclude(["FINE"]);
const frequency = z.enum(["ONCE", "WEEKLY"], { error: "Selecciona una modalidad." });
const date = z.iso.date({ error: "Indica una fecha válida." });
const amount = z.string().trim().transform(value => value.replace(",", "."))
  .pipe(z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "Captura hasta 10 enteros y 2 decimales, sin separadores de miles."))
  .refine(value => /[1-9]/.test(value), "El importe debe ser mayor que cero.")
  .transform(value => {
    const [whole, decimals = ""] = value.split(".");
    return `${BigInt(whole)}.${decimals.padEnd(2, "0")}`;
  });
const reason = z.string().trim().min(1, "Indica el motivo del cargo.");
const periodOrder = (value: { periodStart: string; periodEnd: string }) => value.periodEnd >= value.periodStart;
const periodError = { path: ["periodEnd"], message: "El fin debe ser igual o posterior al inicio." };

const terms = {
  seasonId: z.uuid({ error: "Selecciona una temporada." }),
  amount,
  dueOn: date,
  periodStart: date,
  periodEnd: date,
  reason,
};

const recipient = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("CLUB"), clubId: z.uuid() }),
  z.strictObject({ kind: z.literal("TEAM"), seasonTeamId: z.uuid() }),
]);

/** Contrato propuesto. La liga, la categoría, el actor y la fecha de emisión se resuelven en servidor. */
export const createChargeSchema = z.discriminatedUnion("concept", [
  z.strictObject({ ...terms, operationId: z.uuid(), recipient, concept: manualConcept, frequency }),
  z.strictObject({
    ...terms, operationId: z.uuid(), recipient, concept: z.literal("FINE"), frequency: z.literal("ONCE"),
    resolutionId: z.uuid(),
  }),
]).refine(periodOrder, periodError);

export const chargeCaptureSchema = z.strictObject({
  ...terms,
  recipientKind: z.enum(["CLUB", "TEAM"], { error: "Selecciona el tipo de destinatario." }),
  recipientId: z.uuid({ error: "Selecciona un destinatario." }),
  concept: chargeConcept.refine(code => code !== "FINE", "La multa requiere una resolución oficial de PDGLD-27."),
  frequency,
}).refine(periodOrder, periodError);

export type ChargeCapture = z.output<typeof chargeCaptureSchema>;
export type CreateCharge = z.output<typeof createChargeSchema>;
