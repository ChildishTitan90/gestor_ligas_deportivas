import { z } from "zod";
import { teamEnrollmentSchema } from "./team-enrollment";
import type { TeamRegistrationFormOptions, TeamRegistrationItem, TeamRegistrationResult, TeamRegistrationSubmission } from "./team-registration-model";

const uuid = z.uuid();
const option = z.object({ id: uuid, name: z.string() });
const status = z.enum(["REGISTERED", "ACTIVE", "WITHDRAWN"]);
const optionsSchema = z.object({
  clubs: z.array(option.extend({ leagueId: uuid })),
  seasons: z.array(option.extend({ status: z.string() })),
  teams: z.array(option.extend({ clubId: uuid, referenceNumber: z.string(), enrolledSeasonIds: z.array(uuid) })),
  categories: z.array(option.extend({ seasonId: uuid, seasonCategoryId: uuid })),
  groups: z.array(option.extend({ categoryId: uuid, seasonId: uuid })),
});
export type EnrollmentOptions = z.infer<typeof optionsSchema>;
const receiptSchema = z.object({ id: uuid, teamId: uuid, clubId: uuid, seasonId: uuid,
  categoryId: uuid, groupId: uuid, status, replayed: z.boolean() });
const listSchema = z.object({ items: z.array(receiptSchema.omit({ replayed: true }).extend({
  teamName: z.string(), teamReferenceNumber: z.string(), categoryName: z.string(), groupName: z.string(),
})), nextAfter: uuid.nullable() });
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
    PAYLOAD_TOO_LARGE: "La captura excede el tamaño permitido.",
  };
  return messages[code] ?? "No se pudo completar la consulta. Intenta consultar nuevamente.";
}
export function registrationOptions(data: EnrollmentOptions, clubId = "", seasonId = ""): TeamRegistrationFormOptions {
  return { clubs: data.clubs.map(club => ({ ...club, seasons: club.id !== clubId ? [] : data.seasons.map(season => ({
    ...season,
    // El DTO real no expone una capacidad de creación: nunca inferirla del rol o de CREATE.
    canCreateTeam: false,
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
      const response = await fetcher(path, { credentials: "same-origin", cache: "no-store",
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
  return {
    pending, identity,
    start() { active = true; ++epoch; reads = new AbortController(); },
    stop() { active = false; ++epoch; reads.abort(); },
    unresolved: () => storage.getItem(discardedKey) !== null,
    async closePending() {
      await identity();
      if (!pending()) throw new Error("NO_PENDING");
      // Cerrar solo oculta la vista: cuerpo y clave permanecen sin cambios.
    },
    async options(clubId = "", seasonId = "", signal?: AbortSignal) {
      const query = new URLSearchParams();
      if (clubId) query.set("clubId", clubId);
      if (seasonId) query.set("seasonId", seasonId);
      try { return optionsSchema.parse(await read(`/api/team-enrollments/options${query.size ? `?${query}` : ""}`, signal)); }
      catch (error) { if (error instanceof EnrollmentReadError) throw error; throw new EnrollmentReadError("INVALID_RESPONSE"); }
    },
    async list(clubId: string, seasonId = "", after = "", seasons: readonly { id: string; name: string }[] = [], signal?: AbortSignal) {
      clubId = clubId.toLowerCase();
      seasonId = seasonId.toLowerCase();
      const query = new URLSearchParams({ clubId });
      if (seasonId) query.set("seasonId", seasonId);
      if (after) query.set("after", after);
      try {
        const data = listSchema.parse(await read(`/api/team-enrollments?${query}`, signal));
        if (data.items.some(item => item.clubId !== clubId || (seasonId && item.seasonId !== seasonId))) throw new Error();
        return { nextAfter: data.nextAfter, items: data.items.map(item => ({
          teamId: item.teamId, seasonTeamId: item.id, teamName: item.teamName,
          seasonName: seasons.find(season => season.id === item.seasonId)?.name ?? `Temporada (ID): ${item.seasonId}`,
          categoryName: item.categoryName, groupName: item.groupName, status: item.status,
        } satisfies TeamRegistrationItem)) };
      } catch (error) { if (error instanceof EnrollmentReadError) throw error; throw new EnrollmentReadError("INVALID_RESPONSE"); }
    },
    async submit(capture: TeamRegistrationSubmission): Promise<TeamRegistrationResult> {
      await identity();
      const version = epoch;
      if (storage.getItem(discardedKey) !== null) return { kind: "unconfirmed", message: "Existe un bloqueo de una versión anterior. El resultado sigue sin resolverse; no se permite otra inscripción." };
      let payload: Payload;
      let recovering = false;
      try {
        const previous = pending();
        recovering = previous !== null;
        payload = enrollmentPayload(capture, previous?.enrollmentKey ?? newKey());
        if (previous && JSON.stringify(previous) !== JSON.stringify(payload)) return { kind: "unconfirmed", message: enrollmentMessage("IDEMPOTENCY_CONFLICT") };
        // Persistir ANTES del POST. Si el almacenamiento falla, no enviar.
        storage.setItem(storageKey, JSON.stringify(payload));
      } catch { return { kind: "unconfirmed", message: "No se pudo conservar la clave de envío. Este intento no se envió; verifica el almacenamiento y cualquier envío anterior antes de continuar." }; }
      try {
        const response = await fetcher("/api/team-enrollments", { method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json", "X-Expected-Actor-Id": ownerId }, body: JSON.stringify(payload) });
        assertActive(version);
        if (response.status === 401 || response.status === 403) throw new EnrollmentReadError(response.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", response.status);
        const data = await response.json();
        assertActive(version);
        if (response.status === 201 || response.status === 200) {
          const receipt = receiptSchema.parse(data);
          if (receipt.replayed !== (response.status === 200) || (response.status === 201 && receipt.status !== "REGISTERED") ||
            (["clubId", "seasonId", "categoryId", "groupId"] as const).some(key => receipt[key] !== payload[key]) ||
            (payload.team.mode === "existing" && receipt.teamId !== payload.team.teamId)) throw new Error();
          storage.removeItem(storageKey);
          return { kind: "confirmed", teamId: receipt.teamId, seasonTeamId: receipt.id, status: receipt.status, replayed: receipt.replayed };
        }
        const confirmedCodes: Record<number, readonly string[]> = {
          400: ["INVALID_PAYLOAD", "VALIDATION_ERROR", "INVALID_CONTEXT"], 401: ["UNAUTHENTICATED"],
          403: ["PASSWORD_CHANGE_REQUIRED", "FORBIDDEN", "INVALID_ORIGIN"],
          409: ["AFFILIATION_NOT_APPROVED", "CATEGORY_NOT_AUTHORIZED", "SEASON_CLOSED", "TEAM_ALREADY_ENROLLED", "IDEMPOTENCY_CONFLICT"],
          413: ["PAYLOAD_TOO_LARGE"],
        };
        if (typeof data?.code === "string" && confirmedCodes[response.status]?.includes(data.code)) {
          if (data.code === "IDEMPOTENCY_CONFLICT") return { kind: "unconfirmed", message: enrollmentMessage(data.code) };
          if (recovering) return { kind: "unconfirmed", retryAllowed: true,
            message: `${enrollmentMessage(data.code)} El envío anterior sigue sin confirmarse; conservamos la captura y la clave para recuperarlo.` };
          storage.removeItem(storageKey);
          return { kind: "correctable", message: enrollmentMessage(data.code) };
        }
      } catch (error) {
        if (error instanceof EnrollmentReadError && [401, 403].includes(error.status)) throw error;
        /* Red, cambio de identidad o respuesta ilegible: conservar el pendiente. */
      }
      return { kind: "unconfirmed", retryAllowed: true };
    },
  };
}
export type EnrollmentApi = ReturnType<typeof createEnrollmentApi>;
export function pendingCapture(payload: Payload): TeamRegistrationSubmission {
  return { clubId: payload.clubId, seasonId: payload.seasonId, categoryId: payload.categoryId, groupId: payload.groupId,
    team: payload.team.mode === "existing" ? { kind: "existing", id: payload.team.teamId } : { kind: "new", name: payload.team.name } };
}
