import { createHash, timingSafeEqual } from "node:crypto";
import { reconcileBillingAutomation } from "@/features/billing/server/automation-service";

export const runtime = "nodejs";
export const maxDuration = 60;
function authorized(request: Request) {
  const secret = process.env.BILLING_CRON_SECRET;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const environment = process.env.BILLING_CRON_ENVIRONMENT;
  const project = process.env.BILLING_CRON_PROJECT_REF;
  if (!secret || secret.length < 32 || !environment || !project
    || request.headers.get("x-billing-environment") !== environment || request.headers.get("x-billing-project") !== project
    || !timingSafeEqual(digest(request.headers.get("authorization") ?? ""), digest(`Bearer ${secret}`))) return false;
  try {
    const url = new URL(process.env.DATABASE_URL!);
    return environment === "LOCAL" ? ["127.0.0.1", "localhost"].includes(url.hostname)
      : ["TEST", "PRODUCTION"].includes(environment) && /^[a-z0-9]{20}$/.test(project)
        && (url.hostname === `db.${project}.supabase.co`
          || (/\.pooler\.supabase\.(com|co)$/.test(url.hostname) && decodeURIComponent(url.username).endsWith(`.${project}`)));
  } catch { return false; }
}
export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ status: "REJECTED" }, { status: 401 });
  return Response.json({ contract: "billing-automation-v1", environment: process.env.BILLING_CRON_ENVIRONMENT,
    projectRef: process.env.BILLING_CRON_PROJECT_REF }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  if (!authorized(request))
    return Response.json({ status: "REJECTED" }, { status: 401 });
  // No acepta actor, ámbito ni importes del programador. Solo mandatos persistidos.
  const result = await reconcileBillingAutomation();
  return Response.json(result, { status: result.failed ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
