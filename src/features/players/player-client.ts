import { z } from "zod";
import { curpCheckOutcomes, identityFields } from "./curp-verification";

export class PlayerRequestError extends Error {
  constructor(public readonly code: string, public readonly uncertain = false) { super(code); }
}
export async function playerRequest(actorId: string, path: string, body?: unknown, fetcher: typeof fetch = fetch) {
  let response: Response;
  try {
    response = await fetcher(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Expected-Actor-Id": actorId },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000) });
  } catch { throw new PlayerRequestError("UNCONFIRMED", true); }
  let value: unknown;
  try { value = await response.json(); } catch { throw new PlayerRequestError("UNCONFIRMED", true); }
  if (!response.ok) {
    const code = z.object({ code: z.string() }).safeParse(value).data?.code ?? "SERVICE_UNAVAILABLE";
    throw new PlayerRequestError(code, response.status >= 500 || code === "RETRY_REQUIRED");
  }
  return value;
}
export const playerResultSchema = z.object({ registrationId: z.uuid(), status: z.string(), identityReviewStatus: z.string().nullable() });
export const playerListSchema = z.array(playerResultSchema.extend({ displayName: z.string() }));
export const curpStateSchema = z.object({ registrationId: z.uuid(), identityVersion: z.number().int().positive(), checkId: z.uuid().nullable(),
  registrationStatus:z.string().optional(),identityReviewStatus:z.string().nullable().optional(),
  status: z.enum([...curpCheckOutcomes, "PENDING", "NOT_PERFORMED", "NOT_CONFIGURED"]),
  mismatchedFields: z.array(z.enum(identityFields)), checkedAt: z.string().nullable(), replayed: z.boolean() });
