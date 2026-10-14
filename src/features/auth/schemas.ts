import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().max(254).pipe(z.email()).transform((value) => value.toLowerCase()),
  // La política de alta/cambio pertenece a PDGLD-49; no transformar contraseñas.
  password: z
    .string({ error: "Escribe tu contraseña." })
    .min(1, "Escribe tu contraseña.")
    .max(1024, "La contraseña no puede superar los 1024 caracteres."),
});

export type LoginInput = z.infer<typeof loginSchema>;
