import "server-only";

import { loginSchema } from "@/features/auth/schemas";
import { getPrisma } from "@/server/db/prisma";
import { verifyPassword } from "./password";

export async function authorizeCredentials(input: unknown) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return null;

  try {
    const user = await getPrisma().users.findFirst({
      where: {
        // En Prisma 7.10, in + insensitive compara lower(email) literalmente;
        // equals + insensitive usa ILIKE e interpreta _ y % como comodines.
        email: { in: [parsed.data.email], mode: "insensitive" },
      },
      select: {
        id: true,
        password_hash: true,
        is_active: true,
        must_change_password: true,
        locked_until: true,
        version: true,
      },
    });
    const valid = await verifyPassword(user?.password_hash ?? null, parsed.data.password);
    if (!valid || !user || !user.is_active || (user.locked_until && user.locked_until > new Date())) {
      return null;
    }
    return { id: user.id, mustChangePassword: user.must_change_password, userVersion: user.version };
  } catch {
    // No propagar errores Prisma: NextAuth puede incluir el mensaje en la URL.
    console.error("[auth] CREDENTIALS_UNAVAILABLE");
    return null;
  }
}
