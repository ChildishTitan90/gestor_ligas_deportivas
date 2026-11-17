import { z } from "zod";
import { changePasswordSchema, emailSchema } from "@/features/auth/schemas";

/** Credenciales compartidas por las altas generales y el acceso arbitral. */
export const accountCredentialsSchema = z.strictObject({
  username: z.string().trim().min(1).max(64)
    .regex(/^[A-Za-z0-9._-]+$/, "Usa letras, números, punto, guion o guion bajo.")
    .transform(value => value.toLowerCase()),
  email: emailSchema,
  temporaryPassword: changePasswordSchema.shape.newPassword,
});
