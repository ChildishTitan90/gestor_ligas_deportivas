import { z } from "zod";
import { delegateOptionsSchema, delegatePeriodSchema } from "./schemas";
import type { DelegateAssignmentOptions } from "./types";

export function localDateTimeToIso(value: string): string {
  const date = new Date(value);
  return value && Number.isFinite(date.getTime()) ? date.toISOString() : value;
}

export function formDelegatePeriod(mode: string, startsAt: string, endsAt: string) {
  return mode === "scheduled" ? {
    startsAt: localDateTimeToIso(startsAt), endsAt: endsAt ? localDateTimeToIso(endsAt) : null,
  } : undefined;
}

const responseSchema = z.object({
  period: delegatePeriodSchema,
  positions: z.array(z.object({ value: z.enum(["PRIMARY", "DEPUTY"]), label: z.string(),
    available: z.boolean(), reason: z.enum(["OCCUPIED", "LEGACY"]).nullable() })).length(2),
}).refine(data => new Set(data.positions.map(position => position.value)).size === 2 &&
  data.positions.every(position => position.available === (position.reason === null)));

export type DelegateLoadResult = { kind: "ready"; options: DelegateAssignmentOptions } |
  { kind: "idle" | "stale" } | { kind: "error"; code: string };

export function createDelegateOptionsLoader(request: typeof fetch = fetch) {
  let sequence = 0;
  let controller: AbortController | undefined;
  const cancel = () => { sequence++; controller?.abort(); };
  return { cancel, async load(input: unknown): Promise<DelegateLoadResult> {
    cancel();
    const current = sequence;
    const parsed = delegateOptionsSchema.safeParse(input);
    if (!parsed.success) return { kind: "idle" };
    controller = new AbortController();
    const data = parsed.data;
    const params = new URLSearchParams({ leagueId: data.leagueId, clubKind: data.club.kind });
    if (data.club.kind === "existing") params.set("clubId", data.club.id);
    if (data.period) {
      params.set("startsAt", data.period.startsAt);
      if (data.period.endsAt) params.set("endsAt", data.period.endsAt);
    }
    try {
      const response = await request(`/api/accounts/delegate-options?${params}`, {
        cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]),
      });
      const body = await response.json();
      if (current !== sequence) return { kind: "stale" };
      if (!response.ok) return { kind: "error", code: typeof body.code === "string" ? body.code : "SERVICE_UNAVAILABLE" };
      const options = responseSchema.safeParse(body);
      return options.success ? { kind: "ready", options: options.data } : { kind: "error", code: "SERVICE_UNAVAILABLE" };
    } catch {
      return current === sequence ? { kind: "error", code: "SERVICE_UNAVAILABLE" } : { kind: "stale" };
    }
  } };
}
