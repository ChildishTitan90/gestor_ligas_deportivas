import { emailChangeConfirmationSchema } from "./email-change-contract";

export type EmailConfirmationOutcome = "confirmed" | "invalid" | "uncertain";

/** Fragment only: never place the secret in a request URL, storage or rendered text. */
export function readEmailConfirmationFragment(fragment: string): string | null {
  const params = new URLSearchParams(fragment.replace(/^#/, ""));
  if (params.size !== 1 || !params.has("token")) return null;
  const parsed = emailChangeConfirmationSchema.safeParse({ token: params.get("token") });
  return parsed.success ? parsed.data.token : null;
}

export async function confirmEmailToken(token: string, request: typeof fetch = fetch): Promise<EmailConfirmationOutcome> {
  try {
    const response = await request("/api/account-maintenance/email-change/confirm", {
      method: "POST", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(20000),
    });
    if ([400, 403, 409].includes(response.status)) return "invalid";
    if (!response.ok) return "uncertain";
    const result: unknown = await response.json();
    if (result && typeof result === "object" && "status" in result && result.status === "CONFIRMED" &&
      "sessionsRevoked" in result && result.sessionsRevoked === true) return "confirmed";
  } catch { /* Never log errors from a request carrying a secret. */ }
  return "uncertain";
}
