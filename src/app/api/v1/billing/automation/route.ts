import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { BillingError, isChargeConstraintConflict } from "@/features/billing/server/access";
import { readAutomationWorkspace, saveAutomationPolicy } from "@/features/billing/server/automation-service";

export const runtime = "nodejs";
function failure(error: unknown) {
  const code = error instanceof ZodError || error instanceof SyntaxError ? "INVALID_INPUT"
    : error instanceof AuthorizationError || error instanceof AuthAccessError ? "FORBIDDEN"
    : error instanceof BillingError ? error.message
    : isChargeConstraintConflict(error) ? "DUPLICATE_CHARGE"
    : error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" ? "VERSION_CONFLICT" : null;
  return Response.json(code ? { status: "REJECTED", code } : { status: "UNCERTAIN" },
    { status: code === "FORBIDDEN" ? 403 : code ? 400 : 500, headers: { "Cache-Control": "no-store" } });
}
export async function GET() {
  try { return Response.json(await readAutomationWorkspace(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  // Es una escritura con cookie; el token de Cron no habilita esta entrada.
  if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL ?? request.url).origin
    || request.headers.get("sec-fetch-site") === "cross-site") return failure(new AuthorizationError());
  try { return Response.json({ status: "CONFIRMED", policy: await saveAutomationPolicy(await request.json()) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return failure(error); }
}
