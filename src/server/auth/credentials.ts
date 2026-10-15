import "server-only";

import { loginSchema } from "@/features/auth/schemas";
import { getPrisma } from "@/server/db/prisma";
import { verifyPassword } from "./password";



//Para la politica de bloqueo de las 8 horas
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15* 60 * 1000;

export async function authorizeCredentials(input: unknown) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return null;

  try {

    const prisma = getPrisma();
    const now = new Date();


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
        failed_login_attempts: true,
        locked_until: true,
        version: true,
      },
    });

    if (!user || !user.is_active){
      await verifyPassword(null, parsed.data.password);
      return null;
    }

    if (user.locked_until && user.locked_until > now){
      await verifyPassword(null, parsed.data.password);
      return null;
    }

    const baseAttempts =
      user.locked_until && user.locked_until <= now ? 0 : user.failed_login_attempts;

    const valid = await verifyPassword(user.password_hash, parsed.data.password);

    if (!valid){
        const nextAttempts = baseAttempts + 1;
        const shouldLock = nextAttempts >= MAX_FAILED_ATTEMPTS;

        await prisma.users.update({
          where: {id: user.id},
          data: {
            failed_login_attempts: nextAttempts,
            locked_until: shouldLock ? new Date(now.getTime() + LOCK_DURATION_MS) : null,
          },
        });
        return null;
    }

    if (user.failed_login_attempts > 0 || user.locked_until !== null){
      await prisma.users.update({
        where: { id: user.id},
        data: {
          failed_login_attempts : 0,
          locked_until: null,
        }
      });
    }



    return { id: user.id, mustChangePassword: user.must_change_password, userVersion: user.version };
  } catch {
    // No propagar errores Prisma: NextAuth puede incluir el mensaje en la URL.
    console.error("[auth] CREDENTIALS_UNAVAILABLE");
    return null;
  }
}
