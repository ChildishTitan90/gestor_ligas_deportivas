import { z } from "zod";
import { changePasswordSchema, emailSchema } from "@/features/auth/schemas";

// Alcance de HU22-01: cuentas administrativas y delegados, sin cuentas GUEST.
export const accountRoleCodes = [
  "SUPERADMIN", "EXECUTIVE_PRESIDENT", "SECRETARY", "TREASURER",
  "DISCIPLINARY_BOARD", "REFEREE_MANAGER", "SCHEDULER", "DATA_ENTRY", "CLUB_DELEGATE",
] as const;

const name = z.string().trim().min(1, "Este campo es obligatorio.").max(100);
const personSchema = z.union([
  z.strictObject({ id: z.uuid() }),
  z.strictObject({
    firstName: name,
    paternalSurname: name,
    maternalSurname: z.string().trim().max(100).optional(),
  }),
]);
const clubSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("existing"), id: z.uuid() }),
  z.strictObject({ kind: z.literal("new"), name: z.string().trim().min(1).max(150) }),
]);

export const createAccountSchema = z.strictObject({
  username: z.string().trim().min(1).max(64)
    .regex(/^[A-Za-z0-9._-]+$/, "Usa letras, números, punto, guion o guion bajo.")
    .transform((value) => value.toLowerCase()),
  email: emailSchema,
  temporaryPassword: changePasswordSchema.shape.newPassword,
  person: personSchema,
  roles: z.array(z.enum(accountRoleCodes)).min(1).max(accountRoleCodes.length),
  leagueId: z.uuid().optional(),
  club: clubSchema.optional(),
}).superRefine((data, context) => {
  if (new Set(data.roles).size !== data.roles.length)
    context.addIssue({ code: "custom", path: ["roles"], message: "No repitas roles." });
  if (data.roles.includes("SUPERADMIN")) {
    if (data.roles.length !== 1 || data.leagueId || data.club)
      context.addIssue({ code: "custom", path: ["roles"], message: "SUPERADMIN requiere una asignación global exclusiva." });
    return;
  }
  if (!data.leagueId)
    context.addIssue({ code: "custom", path: ["leagueId"], message: "Selecciona una liga." });
  if (data.roles.includes("CLUB_DELEGATE")) {
    if (!data.club)
      context.addIssue({ code: "custom", path: ["club"], message: "Selecciona un club o crea su registro inicial." });
  } else if (data.club) {
    context.addIssue({ code: "custom", path: ["club"], message: "El contexto de club corresponde al delegado." });
  }
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

