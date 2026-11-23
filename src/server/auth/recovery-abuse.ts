import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { getPrisma } from "@/server/db/prisma";

export function recoveryAbusePolicy(env: Record<string, string | undefined>) {
  const integer = (key: string, min = 1, max = 10000) => {
    const raw = env[key] ?? "";
    const n = Number(raw);
    return /^[1-9][0-9]*$/.test(raw) && Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
  };
  const windowSeconds = integer("PASSWORD_RECOVERY_RATE_WINDOW_SECONDS", 60, 3600);
  const requestIp = integer("PASSWORD_RECOVERY_REQUESTS_PER_IP");
  const completeIp = integer("PASSWORD_RECOVERY_COMPLETIONS_PER_IP");
  const requestGlobal = integer("PASSWORD_RECOVERY_REQUESTS_GLOBAL");
  const completeGlobal = integer("PASSWORD_RECOVERY_COMPLETIONS_GLOBAL");
  const secret = env.PASSWORD_RECOVERY_RATE_SECRET ?? "";
  const mode = env.PASSWORD_RECOVERY_CLIENT_IP_MODE;
  let local = false;
  try { local = ["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.NEXTAUTH_URL ?? "").hostname); } catch { /* Configuración no válida: deshabilitar. */ }
  if (!windowSeconds || !requestIp || !completeIp || !requestGlobal || !completeGlobal ||
      requestGlobal < requestIp || completeGlobal < completeIp || secret.length < 32 ||
      !((mode === "vercel" && env.VERCEL === "1") || (mode === "local" && local && env.NODE_ENV !== "production" && env.VERCEL !== "1"))) return null;
  return { windowSeconds, requestIp, completeIp, requestGlobal, completeGlobal, secret, mode: mode as "vercel" | "local" };
}
export type RecoveryAbusePolicy = NonNullable<ReturnType<typeof recoveryAbusePolicy>>;

/** Solo Vercel fija esta cabecera. En localhost ignorar todas las cabeceras de IP. */
export function recoveryClientKey(request: Request, policy: RecoveryAbusePolicy): string | null {
  if (policy.mode === "local") return "local";
  const ip = request.headers.get("x-vercel-forwarded-for")?.trim() ?? "";
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return null;
  // Canonicalizar IPv6 y agrupar /64 para que variar el sufijo no renueve cuota.
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split("::");
  const head = left ? left.split(":") : [], tail = right ? right.split(":") : [];
  const blocks = right === undefined ? head : [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail];
  return `v6:${blocks.slice(0, 4).map(b => b.padStart(4, "0")).join(":")}`;
}

/** Cuotas compartidas entre instancias. No guarda IP, correo, token ni contraseña. */
export async function consumeRecoveryBudget(endpoint: "request" | "complete", client: string, identity: string,
  policy: RecoveryAbusePolicy, identityLimit: number): Promise<boolean> {
  const buckets = [
    { key: `${endpoint}:global`, limit: endpoint === "request" ? policy.requestGlobal : policy.completeGlobal, seconds: policy.windowSeconds },
    { key: `${endpoint}:ip:${client}`, limit: endpoint === "request" ? policy.requestIp : policy.completeIp, seconds: policy.windowSeconds },
    { key: `${endpoint}:identity:${identity}`, limit: identityLimit, seconds: endpoint === "request" ? 3600 : policy.windowSeconds },
  ];
  return getPrisma().$transaction(async tx => {
    for (const bucket of buckets) {
      const key = createHmac("sha256", policy.secret).update("PDGLD-32-rate:").update(bucket.key).digest("hex");
      const changed = await tx.$queryRaw<{ allowed: boolean }[]>`
        INSERT INTO sports_management.password_recovery_budgets AS b(bucket_key,window_start,hits)
        VALUES (${key},to_timestamp(floor(extract(epoch FROM transaction_timestamp()) / ${bucket.seconds}) * ${bucket.seconds}),1)
        ON CONFLICT(bucket_key) DO UPDATE SET
          hits=CASE WHEN b.window_start < EXCLUDED.window_start THEN 1 ELSE b.hits+1 END,
          window_start=EXCLUDED.window_start
        WHERE b.window_start < EXCLUDED.window_start OR (b.window_start=EXCLUDED.window_start AND b.hits < ${bucket.limit})
        RETURNING true AS allowed`;
      if (!changed.length) return false;
    }
    // Retención acotada: limpiar solo contadores vencidos, sin tocar solicitudes.
    await tx.$executeRaw`DELETE FROM sports_management.password_recovery_budgets WHERE bucket_key IN (
      SELECT bucket_key FROM sports_management.password_recovery_budgets
      WHERE window_start < transaction_timestamp()-interval '2 hours'
      ORDER BY window_start LIMIT 200 FOR UPDATE SKIP LOCKED)`;
    return true;
  }, { timeout: 5000 });
}
