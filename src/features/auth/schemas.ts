import { z } from "zod";

export const emailSchema = z.string().trim().max(254).pipe(z.email()).transform(value => value.toLowerCase());
export const usernameSchema = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9._-]+$/).transform(value => value.toLowerCase());

export const loginSchema = z.object({
  // Se conserva el nombre del parámetro de NextAuth 4 para los clientes existentes.
  email: z.union([emailSchema, usernameSchema]),
  // La política de alta/cambio pertenece a PDGLD-49; no transformar contraseñas.
  password: z
    .string({ error: "Escribe tu contraseña." })
    .min(1, "Escribe tu contraseña.")
    .max(1024, "La contraseña no puede superar los 1024 caracteres."),
});

export type LoginInput = z.infer<typeof loginSchema>;

// --- Esquema para PDGLD-49: Cambio obligatorio de contraseña ---
export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ error: "Escribe tu contraseña actual." })
      .min(1, "Escribe tu contraseña actual.")
      .max(1024, "La contraseña no puede superar los 1024 caracteres."),
    newPassword: z
      .string({ error: "Escribe tu nueva contraseña." })
      .min(8, "La nueva contraseña debe tener al menos 8 caracteres.")
      .max(128, "La nueva contraseña no puede superar los 128 caracteres.")
      .regex(/[A-Z]/, "Debe incluir al menos una letra mayúscula.")
      .regex(/[a-z]/, "Debe incluir al menos una letra minúscula.")
      .regex(/[0-9]/, "Debe incluir al menos un número.")
      .regex(/[^A-Za-z0-9]/, "Debe incluir al menos un carácter especial."),
    confirmPassword: z
      .string({ error: "Confirma tu nueva contraseña." })
      .min(1, "Confirma tu nueva contraseña."),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "La confirmación no coincide con la nueva contraseña.",
    path: ["confirmPassword"],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "La nueva contraseña debe ser diferente a la contraseña temporal.",
    path: ["newPassword"],
  });


export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
