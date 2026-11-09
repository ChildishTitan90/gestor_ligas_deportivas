import "server-only";
import type { AccountEmail, EmailTransport } from "./transport";

type Configuration = { apiKey: string; from: string; origin: string };
const address = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;

/** Configuración explícita del servidor. Ningún endpoint o remitente viene del cliente. */
export function resendConfiguration(env: Record<string, string | undefined>): Configuration | null {
  if (env.ACCOUNT_EMAIL_ENABLED !== "true" || env.ACCOUNT_EMAIL_PROVIDER !== "resend") return null;
  const apiKey = env.RESEND_API_KEY, from = env.ACCOUNT_EMAIL_FROM;
  if (!apiKey?.trim() || /[\r\n]/.test(apiKey) || !from || !address.test(from)) return null;
  try {
    const url = new URL(env.NEXTAUTH_URL ?? "");
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return { apiKey, from, origin: url.origin };
  } catch { return null; }
}

function content(message: AccountEmail, origin: string) {
  switch (message.kind) {
    case "ADMINISTRATIVE_RESET":
      return { subject: "Restablecimiento de acceso — Liga Municipal", text:
        `Se verificó tu identidad para restablecer el acceso.\nCredencial temporal: ${message.temporaryPassword}\nVence: ${message.expiresAt.toISOString()}\nEntra en ${origin}/login y cambia la contraseña. La credencial admite un solo uso.\nSi no reconoces esta solicitud, contacta a la administración.` };
    case "EMAIL_CHANGE_CONFIRMATION":
      return { subject: "Confirma tu nuevo correo — Liga Municipal", text:
        `Confirma el cambio solicitado en ${origin}/email-change/confirm#token=${encodeURIComponent(message.token)}\nVence: ${message.expiresAt.toISOString()}\nAbrir el enlace no cambia la cuenta; requiere confirmación. Si no lo solicitaste, no lo confirmes.` };
    case "EMAIL_CHANGE_REQUESTED":
      return { subject: "Cambio de correo solicitado — Liga Municipal", text: "Se solicitó cambiar el correo de acceso. El correo actual permanece vigente hasta confirmar el nuevo destino. Si no lo reconoces, contacta a la administración." };
    case "EMAIL_CHANGE_COMPLETED":
      return { subject: "Correo de acceso actualizado — Liga Municipal", text: "Se confirmó el cambio de correo de acceso y se revocaron las sesiones anteriores. Si no lo reconoces, contacta a la administración." };
  }
}

/** Una llamada, sin reintentos. El cuerpo y las excepciones nunca se registran. */
export function createResendEmailTransport(config: Configuration, request: typeof fetch = fetch): EmailTransport {
  return { async send(message) {
    if (!address.test(message.to) || !message.idempotencyKey || message.idempotencyKey.length > 256 || /[\r\n]/.test(message.idempotencyKey)) return "FAILED";
    try {
      const response = await request("https://api.resend.com/emails", {
        method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": message.idempotencyKey },
        body: JSON.stringify({ from: config.from, to: [message.to], ...content(message, config.origin) }),
      });
      // Un rechazo explícito no acredita aceptación. 408/409/429/5xx pueden ser inciertos.
      if ([400, 401, 403, 404, 405, 413, 422].includes(response.status)) return "FAILED";
      if (!response.ok) return "UNKNOWN";
      const body: unknown = await response.json();
      return body && typeof body === "object" && "id" in body && typeof body.id === "string" && body.id.length > 0 ? "ACCEPTED" : "UNKNOWN";
    } catch { return "UNKNOWN"; }
  } };
}
