import { z } from "zod";
import { accountCredentialsSchema } from "./credentials";

const context = { operationKey: z.uuid(), refereeId: z.uuid(), seasonId: z.uuid(),
  expectedRefereeVersion: z.number().int().positive(), expectedIdentityVersion: z.number().int().positive(),
  reason: z.string().trim().min(5).max(500) };
const create = z.strictObject({ ...context, kind: z.literal("create"),
  username: accountCredentialsSchema.shape.username, email: accountCredentialsSchema.shape.email });
const enable = z.strictObject({ ...context, kind: z.literal("enable"), userId: z.uuid(), expectedUserVersion: z.number().int().positive() });
/** Solo estos metadatos se conservan en navegador; nunca la contraseña. */
export const refereeAccessOperation = z.discriminatedUnion("kind", [create, enable]);
export const refereeAccessMutation = z.discriminatedUnion("kind", [
  create.extend({ temporaryPassword: accountCredentialsSchema.shape.temporaryPassword }), enable,
]);
export type RefereeAccessMutation = z.infer<typeof refereeAccessMutation>;
export type RefereeAccessWorkspace = {
  actorId: string; refereeId: string; seasonId: string; leagueId: string;
  name: string; club: string; season: string; league: string; refereeVersion: number; identityVersion: number;
  blockedCode: string | null; account: { id: string; version: number; hasAccess: boolean } | null;
};
export const refereeAccessMessages: Record<string, string> = {
  INVALID_PAYLOAD: "Revisa el usuario, correo, contraseña temporal y motivo.",
  FORBIDDEN: "No tienes permiso para crear acceso arbitral en este contexto.",
  CLOSED_CONTEXT: "La temporada está cerrada. Utiliza una incorporación vigente.",
  REFEREE_INACTIVE: "El árbitro está inactivo. Revisa su incorporación antes de crear el acceso.",
  ACCOUNT_REVIEW_REQUIRED: "La cuenta está inactiva o su asignación requiere revisión de Administración. No se modificaron sus credenciales ni su vigencia.",
  ACCOUNT_CHANGED: "La Persona ya tiene cuenta o su cuenta cambió. Consulta la información actual para conservarla.",
  STALE_VERSION: "La identidad o el padrón cambiaron. Consulta los datos actuales antes de continuar.",
  DUPLICATE_ACCOUNT: "El usuario o correo ya está en uso. No se creó otra cuenta.",
  OPERATION_KEY_REUSED: "La clave corresponde a otra solicitud. Consulta el acuse original.",
};
