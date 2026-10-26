import { z } from "zod";
import { canonicalTeamEnrollment, teamEnrollmentOperationSchema, teamEnrollmentResultSchema, teamEnrollmentSchema,
  type TeamEnrollmentInput } from "./team-enrollment";

type PendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;
type Pending = z.infer<typeof teamEnrollmentSchema>;
export type EnrollmentRecoveryOutcome =
  | { outcome: "CONFIRMED"; enrollment: z.infer<typeof teamEnrollmentResultSchema>; pendingCleanup: boolean }
  | { outcome: "CANCELLED"; enrollment: null; pendingCleanup: boolean }
  | { outcome: "UNRESOLVED"; code: string };

const storedSchema = z.strictObject({ version: z.literal(1), input: teamEnrollmentSchema });

/** Adaptador para PDGLD-63; no crea otra pantalla ni ejecuta reintentos automáticos. */
export function createEnrollmentRecovery(actorId: string, storage: PendingStorage, fetcher: typeof fetch = fetch) {
  const actor = z.uuid().parse(actorId).toLowerCase();
  const prefix = `team-enrollment-pending:v1:${actor}:`;
  function key(input: Pending) { return `${prefix}${input.clubId}:${input.enrollmentKey}`; }
  function decode(raw: string) { return storedSchema.parse(JSON.parse(raw)).input; }

  function remember(value: unknown) {
    const input = teamEnrollmentSchema.parse(value);
    const prior = storage.getItem(key(input));
    if (prior) {
      const previous = decode(prior);
      if (previous.enrollmentKey !== input.enrollmentKey || canonicalTeamEnrollment(previous) !== canonicalTeamEnrollment(input))
        throw new Error("La clave pendiente ya tiene otro contenido. Recupérala antes de editar.");
      return previous;
    }
    storage.setItem(key(input), JSON.stringify({ version: 1, input }));
    // Si no se puede conservar el pendiente, no se envía ninguna petición.
    if (storage.getItem(key(input)) !== JSON.stringify({ version: 1, input })) throw new Error("No se pudo conservar el pendiente.");
    return input;
  }

  function pending(clubId: string) {
    const clubPrefix = `${prefix}${z.uuid().parse(clubId).toLowerCase()}:`;
    const inputs: Pending[] = [];
    for (let index = 0; index < storage.length; index++) {
      const name = storage.key(index);
      if (!name?.startsWith(clubPrefix)) continue;
      const raw = storage.getItem(name);
      if (raw === null) continue;
      const input = decode(raw);
      if (key(input) !== name) throw new Error("El pendiente no coincide con su contexto.");
      inputs.push(input);
    }
    return inputs;
  }

  function finish(input: Pending, outcome: "CONFIRMED" | "CANCELLED",
    enrollment: z.infer<typeof teamEnrollmentResultSchema> | null): EnrollmentRecoveryOutcome {
    let pendingCleanup = false;
    try { storage.removeItem(key(input)); } catch { pendingCleanup = true; }
    if (outcome === "CONFIRMED" && enrollment) return { outcome, enrollment, pendingCleanup };
    return { outcome: "CANCELLED", enrollment: null, pendingCleanup };
  }

  function matches(input: Pending, result: z.infer<typeof teamEnrollmentResultSchema>) {
    return result.clubId === input.clubId && result.seasonId === input.seasonId && result.categoryId === input.categoryId &&
      result.groupId === input.groupId && (input.team.mode !== "existing" || input.team.teamId === result.teamId);
  }

  async function request(inputValue: TeamEnrollmentInput, action: "check" | "retry" | "cancel"): Promise<EnrollmentRecoveryOutcome> {
    const input = remember(inputValue);
    const operationPath = `/api/team-enrollments/operations/${input.enrollmentKey}`;
    const url = action === "check" ? `${operationPath}?clubId=${input.clubId}`
      : action === "cancel" ? `${operationPath}/cancel` : "/api/team-enrollments";
    let response: Response;
    let body: unknown;
    try {
      response = await fetcher(url, { method: action === "check" ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
        ...(action === "check" ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }),
        signal: AbortSignal.timeout(30_000) });
      body = await response.json();
    } catch { return { outcome: "UNRESOLVED", code: "UNCONFIRMED" }; }
    if (!response.ok) {
      // Un 404/409/503 no confirma cancelación. Tampoco se pierde el pendiente en 401/403.
      const code = z.object({ code: z.string().regex(/^[A-Z_]{1,80}$/) }).safeParse(body);
      return { outcome: "UNRESOLVED", code: code.success ? code.data.code : "INVALID_RESPONSE" };
    }
    if (action === "retry") {
      const receipt = teamEnrollmentResultSchema.safeParse(body);
      if (!receipt.success || !matches(input, receipt.data) || ![200, 201].includes(response.status) ||
        receipt.data.replayed !== (response.status === 200) || (response.status === 201 && receipt.data.status !== "REGISTERED"))
        return { outcome: "UNRESOLVED", code: "INVALID_RESPONSE" };
      return finish(input, "CONFIRMED", receipt.data);
    }
    const operation = teamEnrollmentOperationSchema.safeParse(body);
    if (!operation.success || operation.data.enrollmentKey !== input.enrollmentKey || operation.data.clubId !== input.clubId)
      return { outcome: "UNRESOLVED", code: "INVALID_RESPONSE" };
    if (operation.data.outcome === "CONFIRMED") {
      if (!matches(input, operation.data.enrollment)) return { outcome: "UNRESOLVED", code: "INVALID_RESPONSE" };
      return finish(input, "CONFIRMED", operation.data.enrollment);
    }
    if (operation.data.outcome === "CANCELLED") return finish(input, "CANCELLED", null);
    return { outcome: "UNRESOLVED", code: "UNCONFIRMED" };
  }

  return { remember, pending,
    load(clubId: string, enrollmentKey: string) {
      const reference = { clubId: z.uuid().parse(clubId).toLowerCase(), enrollmentKey: z.uuid().parse(enrollmentKey).toLowerCase() };
      const raw = storage.getItem(`${prefix}${reference.clubId}:${reference.enrollmentKey}`);
      if (raw === null) return null;
      const input = decode(raw);
      if (input.clubId !== reference.clubId || input.enrollmentKey !== reference.enrollmentKey) throw new Error("El pendiente no coincide con su contexto.");
      return input;
    },
    check: (input: Pending) => request(input, "check"),
    retry: (input: Pending) => request(input, "retry"),
    cancel: (input: Pending) => request(input, "cancel"),
    // Abandonar la edición no cancela una petición enviada ni elimina su recibo.
    abandon: (input: Pending) => remember(input),
  };
}
