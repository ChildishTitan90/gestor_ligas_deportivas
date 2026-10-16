import { NextResponse } from "next/server";
import { changePasswordSchema } from "@/features/auth/schemas";
import { getPrisma } from "@/server/db/prisma";
import { getAuthSession } from "@/server/auth/session";
import { verifyPassword, hashPassword } from "@/server/auth/password";
import { lockAuthUser } from "@/server/auth/lock-user";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getAuthSession();
  if (!session?.user?.id) {
    return NextResponse.json({ code: "UNAUTHORIZED" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ code: "INVALID_PAYLOAD" }, { status: 400 });
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ code: "VALIDATION_ERROR" }, { status: 400 });
  }

  try {
    const prisma = getPrisma();

    // Transacción ACID para verificar y actualizar la contraseña de forma segura
    const result = await prisma.$transaction(async (tx) => {
      const user = await lockAuthUser(tx, session.user!.id);

      if (!user || !user.is_active || (user.locked_until && user.locked_until > new Date())) {
        return { ok: false as const, status: 403, code: "FORBIDDEN" };
      }

      const isCurrentValid = await verifyPassword(user.password_hash, parsed.data.currentPassword);
      if (!isCurrentValid) {
        return { ok: false as const, status: 400, code: "INVALID_CURRENT_PASSWORD" };
      }

      const newPasswordHash = await hashPassword(parsed.data.newPassword);

      await tx.users.update({
        where: { id: user.id },
        data: {
          password_hash: newPasswordHash,
          must_change_password: false,
          version: { increment: 1 },
          failed_login_attempts: 0,
          locked_until: null,
        },
      });

      return { ok: true as const };
    });

    if (!result.ok) {
      return NextResponse.json({ code: result.code }, { status: result.status });
    }

    return NextResponse.json({ ok: true });
  } catch {
    console.error("[auth] CHANGE_PASSWORD_ERROR");
    return NextResponse.json({ code: "SERVICE_UNAVAILABLE" }, { status: 500 });
  }
}
