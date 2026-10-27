import { z } from "zod";
import { teamEnrollmentSchema } from "./team-enrollment";
import type { TeamRegistrationFormOptions, TeamRegistrationItem, TeamRegistrationResult, TeamRegistrationSubmission } from "./team-registration-model";

const uuid = z.uuid().transform(value => value.toLowerCase());
const option = z.object({ id: uuid, name: z.string() });
const status = z.enum(["REGISTERED", "ACTIVE", "WITHDRAWN"]);
const optionsSchema = z.object({
  clubs: z.array(option.extend({ leagueId: uuid })),
  capabilities: z.object({ clubId: uuid.nullable(), canEnroll: z.boolean(), canCreateTeam: z.boolean() }).optional(),
  nextClubAfter: uuid.nullable(), nextSeasonAfter: uuid.nullable(), nextTeamAfter: uuid.nullable(),
  seasons: z.array(option.extend({ status: z.string() })),
  teams: z.array(option.extend({ clubId: uuid, referenceNumber: z.string(), enrolledSeasonIds: z.array(uuid) })),
  categories: z.array(option.extend({ seasonId: uuid, seasonCategoryId: uuid })),
  groups: z.array(option.extend({ categoryId: uuid, seasonId: uuid })),
});
export type EnrollmentOptions = z.infer<typeof optionsSchema>;
const receiptSchema = z.object({ id: uuid, teamId: uuid, clubId: uuid, seasonId: uuid,
  categoryId: uuid, groupId: uuid, status, replayed: z.boolean() });
const listSchema = z.object({ items: z.array(receiptSchema.omit({ replayed: true }).extend({
  seasonName: z.string(), teamName: z.string(), teamReferenceNumber: z.string(), categoryName: z.string(), groupName: z.string(),
})), nextAfter: uuid.nullable() });
const operationSchema = z.discriminatedUnion("outcome", [
  z.object({ enrollmentKey: uuid, clubId: uuid, outcome: z.literal("CONFIRMED"), enrollment: receiptSchema }),
  z.object({ enrollmentKey: uuid, clubId: uuid, outcome: z.literal("CANCELLED"), enrollment: z.null() }),
  z.object({ enrollmentKey: uuid, clubId: uuid, outcome: z.literal("UNRESOLVED"), enrollment: z.null() }),
]);
export class EnrollmentReadError extends Error {
  constructor(public readonly code: string, public readonly status = 0) { super(code); }
}
export function enrollmentMessage(code: string) {
  const messages: Record<string, string> = {
    UNAUTHENTICATED: "Tu sesión terminó. Inicia sesión nuevamente.",
    PASSWORD_CHANGE_REQUIRED: "Debes completar el cambio de contraseña.",
    FORBIDDEN: "Acceso denegado para esta operación o club.",
    INVALID_ORIGIN: "No se aceptó el origen del envío. Revisa el acceso a la aplicación.",
    INVALID_PAYLOAD: "Revisa el formato de la captura.", VALIDATION_ERROR: "Revisa los datos de la captura.",
    INVALID_CONTEXT: "El contexto cambió. Vuelve a consultar las opciones antes de corregir la captura.",
    AFFILIATION_NOT_APPROVED: "La afiliación aún no está aprobada.",
    CATEGORY_NOT_AUTHORIZED: "La categoría no está autorizada para esta temporada.",
    SEASON_CLOSED: "La temporada está cerrada para nuevas inscripciones.",
    TEAM_ALREADY_ENROLLED: "El equipo ya está inscrito. Consulta la inscripción existente; no cambies su grupo.",
    IDEMPOTENCY_CONFLICT: "La clave corresponde a otra captura. Verifica el resultado antes de continuar.",
    OPERATION_CANCELLED: "La clave tiene una cancelación registrada. Consulta el resultado para confirmarla.",
    PAYLOAD_TOO_LARGE: "La captura excede el tamaño permitido.",
  };
  return messages[code] ?? "No se pudo completar la consulta. Intenta consultar nuevamente.";
}
export function registrationOptions(data: EnrollmentOptions, clubId = "", seasonId = ""): TeamRegistrationFormOptions {
  return { clubs: data.clubs.map(club => ({ ...club, seasons: club.id !== clubId ? [] : data.seasons.map(season => ({
    ...season,
    canEnroll: data.capabilities?.clubId === clubId && data.capabilities.canEnroll === true,
    canCreateTeam: data.capabilities?.clubId === clubId && data.capabilities.canEnroll === true && data.capabilities.canCreateTeam === true,
    teams: data.teams.filter(team => team.clubId === clubId && !team.enrolledSeasonIds.includes(season.id)),
    categories: season.id !== seasonId ? [] : data.categories.filter(category => category.seasonId === season.id).map(category => ({
      ...category, groups: data.groups.filter(group => group.categoryId === category.id && group.seasonId === season.id),
    })),
  })) })) };
}
export function enrollmentPayload(capture: TeamRegistrationSubmission, enrollmentKey: string) {
  return teamEnrollmentSchema.parse({ enrollmentKey, clubId: capture.clubId, seasonId: capture.seasonId,
    categoryId: capture.categoryId, groupId: capture.groupId,
    team: capture.team.kind === "existing" ? { mode: "existing", teamId: capture.team.id } : { mode: "new", name: capture.team.name },
  });
}
type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
type Payload = ReturnType<typeof enrollmentPayload>;
export function createEnrollmentApi(fetcher: typeof fetch, storage: Storage, storageKey: string, ownerId: string, newKey = () => crypto.randomUUID()) {
  let active = true;
  let epoch = 0;
  let reads = new AbortController();
  // Compatibilidad: una marca antigua sin cuerpo nunca libera otra inscripción.
  const discardedKey = `${storageKey}:discarded`;
  function assertActive(version = epoch) { if (!active || version !== epoch) throw new EnrollmentReadError("INACTIVE"); }
  async function identity(signal?: AbortSignal) {
    assertActive();
    const version = epoch;
    const response = await fetcher("/api/auth/session", { credentials: "same-origin", cache: "no-store",
      signal: signal ? AbortSignal.any([reads.signal, signal]) : reads.signal });
    assertActive(version);
    if (!response.ok) throw new EnrollmentReadError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", response.status);
    const session = await response.json();
    assertActive(version);
    if (!session?.user?.id) throw new EnrollmentReadError("UNAUTHENTICATED", 401);
    if (session.user.id !== ownerId) throw new EnrollmentReadError("FORBIDDEN", 403);
    if (session.user.mustChangePassword) throw new EnrollmentReadError("PASSWORD_CHANGE_REQUIRED", 403);
  }
  function pending(): Payload | null {
    const value = storage.getItem(storageKey);
    return value === null ? null : teamEnrollmentSchema.parse(JSON.parse(value));
  }
  async function read(path: string, signal?: AbortSignal) {
    try {
      await identity(signal);
      const version = epoch;
      const response = await fetcher(path, { credentials: "same-origin", cache: "no-store", headers: { "X-Expected-Actor-Id": ownerId },
        signal: signal ? AbortSignal.any([reads.signal, signal]) : reads.signal });
      assertActive(version);
      if (response.status === 401 || response.status === 403) throw new EnrollmentReadError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", response.status);
      const data = await response.json();
      assertActive(version);
      if (!response.ok) throw new EnrollmentReadError(typeof data?.code === "string" ? data.code : "UNAVAILABLE");
      return data;
    } catch (error) {
      if (error instanceof EnrollmentReadError) throw error;
      throw new EnrollmentReadError("UNAVAILABLE");
    }
  }
  function matches(payload: Payload, receipt: z.infer<typeof receiptSchema>) {
    return (["clubId", "seasonId", "categoryId", "groupId"] as const).every(key => receipt[key] === payload[key]) &&
      (payload.team.mode !== "existing" || receipt.teamId === payload.team.teamId);
  }
  function finish(result: Extract<TeamRegistrationResult, { kind: "confirmed" | "cancelled" }>): TeamRegistrationResult {
    let pendingCleanup = false;
    try { storage.removeItem(storageKey); if (storage.getItem(storageKey) !== null) pendingCleanup = true; }
    catch { pendingCleanup = true; }
    return { ...result, pendingCleanup };
  }
  async function catalogs(path: "options" | "catalogs", clubId = "", seasonId = "", signal?: AbortSignal) {
    const query = new URLSearchParams();
    if (clubId) query.set("clubId", clubId);
    if (seasonId) query.set("seasonId", seasonId);
    const get = async () => optionsSchema.parse(await read(`/api/team-enrollments/${path}${query.size ? `?${query}` : ""}`, signal));
    try {
      const data = await get();
      // Cada cursor avanza su colección. Mantener las capacidades del contexto original.
      for (const [cursor, field] of [["nextClubAfter", "clubs"], ["nextSeasonAfter", "seasons"], ["nextTeamAfter", "teams"]] as const) {
        const parameter = { nextClubAfter: "clubAfter", nextSeasonAfter: "seasonAfter", nextTeamAfter: "teamAfter" }[cursor];
        let after = data[cursor];
        const seen = new Set<string>();
        while (after) {
          if (seen.has(after)) throw new Error("INVALID_CURSOR");
          seen.add(after); query.set(parameter, after);
          const page = await get();
          if (page.capabilities?.clubId !== data.capabilities?.clubId || page.capabilities?.canEnroll !== data.capabilities?.canEnroll ||
            page.capabilities?.canCreateTeam !== data.capabilities?.canCreateTeam) throw new Error("CONTEXT_CHANGED");
          if (field === "clubs") data.clubs.push(...page.clubs.filter(item => !data.clubs.some(old => old.id === item.id)));
          if (field === "seasons") data.seasons.push(...page.seasons.filter(item => !data.seasons.some(old => old.id === item.id)));
          if (field === "teams") data.teams.push(...page.teams.filter(item => !data.teams.some(old => old.id === item.id)));
          after = page[cursor];
        }
        query.delete(parameter); data[cursor] = null;
      }
      return data;
    } catch (error) { if (error instanceof EnrollmentReadError) throw error; throw new EnrollmentReadError("INVALID_RESPONSE"); }
  }
  async function operation(action: "check" | "cancel", signal?: AbortSignal): Promise<TeamRegistrationResult> {
    await identity(signal);
    const version = epoch;
    const payload = pending();
    if (!payload) return { kind: "unconfirmed", message: "No se encontró el cuerpo pendiente. No se habilita otra inscripción." };
    try {
      const path = `/api/team-enrollments/operations/${payload.enrollmentKey}`;
      const response = await fetcher(action === "check" ? `${path}?clubId=${payload.clubId}` : `${path}/cancel`, {
        method: action === "check" ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
        headers: { "X-Expected-Actor-Id": ownerId, ...(action === "cancel" ? { "Content-Type": "application/json" } : {}) },
        ...(action === "cancel" ? { body: JSON.stringify(payload) } : {}),
        signal: signal ? AbortSignal.any([reads.signal, signal]) : reads.signal,
      });
      assertActive(version);
      if (response.status === 401 || response.status === 403) throw new EnrollmentReadError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", response.status);
      const data = await response.json(); assertActive(version);
      if (!response.ok) return { kind: "unconfirmed", message: enrollmentMessage(typeof data?.code === "string" ? data.code : "UNAVAILABLE") };
      const result = operationSchema.parse(data);
      if (response.status !== 200 || result.enrollmentKey !== payload.enrollmentKey || result.clubId !== payload.clubId) throw new Error();
      if (result.outcome === "CONFIRMED") {
        if (!result.enrollment.replayed || !matches(payload, result.enrollment)) throw new Error();
        return finish({ kind: "confirmed", teamId: result.enrollment.teamId, seasonTeamId: result.enrollment.id,
          status: result.enrollment.status, replayed: true });
      }
      if (result.outcome === "CANCELLED") return finish({ kind: "cancelled" });
      return { kind: "unconfirmed", retryAllowed: true, message: "El servidor informa UNRESOLVED. Conservamos cuerpo y clave; todavía no hay un resultado definitivo." };
    } catch (error) {
      if (error instanceof EnrollmentReadError && [401, 403].includes(error.status)) throw error;
      return { kind: "unconfirmed", retryAllowed: true, message: "No se pudo confirmar el resultado. Conservamos el cuerpo y la clave; vuelve a consultar." };
    }
  }
  return {
    pending, identity,
    start() { reads.abort(); active = true; ++epoch; reads = new AbortController(); },
    stop() { active = false; ++epoch; reads.abort(); },
    unresolved: () => storage.getItem(discardedKey) !== null,
    async closePending() { await identity(); if (!pending()) throw new Error("NO_PENDING"); },
    options: (clubId = "", seasonId = "", signal?: AbortSignal) => catalogs("options", clubId, seasonId, signal),
    catalogs: (clubId = "", seasonId = "", signal?: AbortSignal) => catalogs("catalogs", clubId, seasonId, signal),
    check: (signal?: AbortSignal) => operation("check", signal),
    cancel: () => operation("cancel"),
    async list(clubId: string, seasonId = "", after = "", signal?: AbortSignal) {
      clubId = clubId.toLowerCase(); seasonId = seasonId.toLowerCase();
      const query = new URLSearchParams({ clubId });
      if (seasonId) query.set("seasonId", seasonId);
      if (after) query.set("after", after);
      try {
        const data = listSchema.parse(await read(`/api/team-enrollments?${query}`, signal));
        if (data.items.some(item => item.clubId !== clubId || (seasonId && item.seasonId !== seasonId))) throw new Error();
        return { nextAfter: data.nextAfter, items: data.items.map(item => ({
          teamId: item.teamId, seasonTeamId: item.id, teamName: item.teamName, seasonName: item.seasonName,
          categoryName: item.categoryName, groupName: item.groupName, status: item.status,
        } satisfies TeamRegistrationItem)) };
      } catch (error) { if (error instanceof EnrollmentReadError) throw error; throw new EnrollmentReadError("INVALID_RESPONSE"); }
    },
    async submit(capture: TeamRegistrationSubmission): Promise<TeamRegistrationResult> {
      await identity();
      const version = epoch;
      if (storage.getItem(discardedKey) !== null) return { kind: "unconfirmed", message: "Existe un bloqueo anterior sin resultado. No se permite otra inscripción." };
      let payload: Payload;
      try {
        const previous = pending();
        payload = enrollmentPayload(capture, previous?.enrollmentKey ?? newKey());
        if (previous && JSON.stringify(previous) !== JSON.stringify(payload)) return { kind: "unconfirmed", message: enrollmentMessage("IDEMPOTENCY_CONFLICT") };
        storage.setItem(storageKey, JSON.stringify(payload));
        if (storage.getItem(storageKey) !== JSON.stringify(payload)) throw new Error();
      } catch { return { kind: "unconfirmed", message: "No se pudo conservar la clave de envío. No se envió este intento; comprueba el almacenamiento." }; }
      try {
        const response = await fetcher("/api/team-enrollments", { method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json", "X-Expected-Actor-Id": ownerId }, body: JSON.stringify(payload) });
        assertActive(version);
        if (response.status === 401 || response.status === 403) throw new EnrollmentReadError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", response.status);
        const data = await response.json(); assertActive(version);
        if (response.status === 201 || response.status === 200) {
          const receipt = receiptSchema.parse(data);
          if (receipt.replayed !== (response.status === 200) || (response.status === 201 && receipt.status !== "REGISTERED") || !matches(payload, receipt)) throw new Error();
          return finish({ kind: "confirmed", teamId: receipt.teamId, seasonTeamId: receipt.id, status: receipt.status, replayed: receipt.replayed });
        }
        return { kind: "unconfirmed", retryAllowed: true,
          message: `${enrollmentMessage(typeof data?.code === "string" ? data.code : "UNAVAILABLE")} Conservamos cuerpo y clave; consulta o cancela la intención antes de iniciar otra.` };
      } catch (error) { if (error instanceof EnrollmentReadError && [401, 403].includes(error.status)) throw error; }
      return { kind: "unconfirmed", retryAllowed: true };
    },
  };
}
export type EnrollmentApi = ReturnType<typeof createEnrollmentApi>;
export function pendingCapture(payload: Payload): TeamRegistrationSubmission {
  return { clubId: payload.clubId, seasonId: payload.seasonId, categoryId: payload.categoryId, groupId: payload.groupId,
    team: payload.team.mode === "existing" ? { kind: "existing", id: payload.team.teamId } : { kind: "new", name: payload.team.name } };
}
