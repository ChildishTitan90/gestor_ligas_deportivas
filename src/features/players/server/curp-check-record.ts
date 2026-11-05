import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { AuthorizationError } from "@/server/auth/authorization";
import { playerIdentitySchema, type PlayerIdentityInput } from "../schemas";
import { type CurpMismatch, type CurpVerificationStatus, type CurpCheckStatus } from "../curp-verification";
import { lockPlayerTeamContext } from "./access";

export class CurpVerificationError extends Error {
  constructor(public readonly code: "VALIDATION_ERROR" | "IDENTITY_CHANGED" | "LOCAL_IDENTITY_INVALID" |
    "CONTEXT_NOT_AVAILABLE" | "OPERATION_CONFLICT" | "USAGE_LIMIT_REACHED" | "RETRY_CONFIRMATION_REQUIRED" |
    "SERVICE_UNAVAILABLE", public readonly status = 409) { super(code); }
}

export type CurpSnapshot = { personId: string; registrationId: string; version: number;
  fingerprint: string; identity: PlayerIdentityInput; available: boolean };

export async function lockCurpSnapshot(tx: Prisma.TransactionClient, actorId: string, registrationId: string,
  action: "READ" | "UPDATE"): Promise<CurpSnapshot> {
  const registration = await tx.player_registrations.findUnique({ where: { id: registrationId },
    select: { season_team_id: true } });
  if (!registration) throw new AuthorizationError();
  const { row } = await lockPlayerTeamContext(tx, actorId, registration.season_team_id, action);
  // UPDATE protege el gasto; READ protege los datos contrastados. PLAYER:R* no da acceso al gasto.
  if (action === "UPDATE") await lockPlayerTeamContext(tx, actorId, registration.season_team_id, "READ");
  else {
    // El estado de una comprobación es parte del expediente, no una lectura pública de jugador.
    await lockPlayerTeamContext(tx, actorId, registration.season_team_id, "UPDATE");
  }
  const people = await tx.$queryRaw<{ personId: string; curp: string | null; firstName: string;
    paternalSurname: string; maternalSurname: string | null; birthDate: Date | null; version: number; withdrawn: boolean }[]>`
    SELECT p.id AS "personId", p.curp, p.first_name AS "firstName", p.paternal_surname AS "paternalSurname",
      p.maternal_surname AS "maternalSurname", p.birth_date AS "birthDate", p.identity_version AS version,
      pr.withdrawn_at IS NOT NULL AS withdrawn
    FROM sports_management.player_registrations pr JOIN sports_management.people p ON p.id=pr.person_id
    WHERE pr.id=${registrationId}::uuid FOR UPDATE OF pr, p
  `;
  const person = people[0];
  if (!person) throw new AuthorizationError();
  const rawIdentity = { curp: person.curp, firstName: person.firstName, paternalSurname: person.paternalSurname,
    maternalSurname: person.maternalSurname ?? "", birthDate: person.birthDate?.toISOString().slice(0, 10) };
  const parsed = playerIdentitySchema.safeParse(rawIdentity);
  if (!parsed.success) throw new CurpVerificationError("LOCAL_IDENTITY_INVALID");
  const fingerprint = createHash("sha256").update(JSON.stringify([person.version, rawIdentity])).digest("hex");
  return { personId: person.personId, registrationId, identity: parsed.data, fingerprint, version: person.version,
    available: !person.withdrawn && row.teamStatus !== "WITHDRAWN" && row.seasonStatus !== "CLOSED" &&
      row.affiliationStatus === "APPROVED" && (row.categoryAuthorized && row.operational) };
}

export const curpCheckSelect = { id: true, actor_id: true, operation_key: true, registration_id: true, identity_version: true,
  fingerprint: true, status: true, mismatched_fields: true, created_at: true, finished_at: true } satisfies Prisma.player_curp_checksSelect;
export type CurpCheckRow = Prisma.player_curp_checksGetPayload<{ select: typeof curpCheckSelect }>;

export function curpStatus(snapshot: CurpSnapshot, row: CurpCheckRow | null, replayed: boolean, now = new Date()): CurpVerificationStatus {
  let status: CurpCheckStatus = row?.status as CurpCheckStatus ?? "NOT_PERFORMED";
  if (row && (row.identity_version !== snapshot.version || row.fingerprint !== snapshot.fingerprint)) status = "STALE";
  else if (row?.status === "PENDING" && now.getTime() - row.created_at.getTime() > 30_000) status = "UNCERTAIN";
  return { registrationId: snapshot.registrationId, identityVersion: snapshot.version, checkId: row?.id ?? null, status,
    mismatchedFields: status === "DISCREPANCY" ? row!.mismatched_fields as CurpMismatch[] : [],
    checkedAt: row?.finished_at?.toISOString() ?? null, replayed };
}
