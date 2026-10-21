import { z } from "zod";

const roleCode = z.string().min(1).max(64).regex(/^[A-Z][A-Z_]*$/);
const reason = z.string().trim().min(10).max(500);

/** Se modifica un vínculo existente del catálogo, nunca un permiso arbitrario. */
export const permissionAssignmentSchema = z.discriminatedUnion("granted", [
  z.object({ roleCode, permissionId: z.uuid(), granted: z.literal(true), contextOnly: z.boolean(), reason }).strict(),
  z.object({ roleCode, permissionId: z.uuid(), granted: z.literal(false), reason }).strict(),
]);

export const permissionRoleFilterSchema = roleCode.optional();
