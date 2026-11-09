import "server-only";
import type { Prisma } from "@prisma/client";

/** Antes de bloquear people/seasons; se mantiene hasta commit/rollback.
 * No concede permisos: el llamador autentica y autoriza todas las referencias.
 */
export async function lockSeasonIdentityHistory(tx: Prisma.TransactionClient) {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(117,20261108)::text`;
}

/** Acuse del cierre futuro, después de autorizar READ. No acredita elegibilidad. */
export async function readSeasonIdentityCapture(tx: Prisma.TransactionClient, seasonId: string) {
  const [row] = await tx.$queryRaw<{season_version:number;closed_at:Date;captured_at:Date;person_count:number}[]>`
    SELECT h.season_version,h.closed_at,h.captured_at,h.person_count
    FROM sports_management.season_identity_closures h
    JOIN sports_management.seasons s ON s.id=h.season_id
    WHERE h.season_id=${seasonId}::uuid AND s.status='CLOSED' AND h.format_version=1`;
  return row ? {status:"CAPTURED" as const,seasonVersion:row.season_version,
    closedAt:row.closed_at.toISOString(),capturedAt:row.captured_at.toISOString(),personCount:row.person_count,formatVersion:1 as const}
    : {status:"UNAVAILABLE" as const};
}

export type HistoricalIdentity = {
  status: "CAPTURED";
  firstName: string;
  paternalSurname: string;
  maternalSurname: string | null;
  identityVersion: number;
  seasonVersion: number;
  capturedAt: string;
  source: "SEASON_CLOSURE_V1";
} | { status: "UNAVAILABLE" };

/** Solo después de autorizar READ sobre persona y temporada. Nunca usa people
 * como respaldo. CAPTURED acredita nombres, no CURP, edad ni decisiones.
 */
export async function readSeasonIdentityHistory(
  tx: Prisma.TransactionClient, personId: string, seasonId: string,
): Promise<HistoricalIdentity> {
  const [row] = await tx.$queryRaw<{
    first_name: string; paternal_surname: string; maternal_surname: string | null;
    identity_version: number; season_version: number; captured_at: Date;
  }[]>`
    SELECT h.first_name,h.paternal_surname,h.maternal_surname,
      h.identity_version,h.season_version,h.captured_at
    FROM sports_management.season_person_identity_snapshots h
    JOIN sports_management.seasons s ON s.id=h.season_id
    WHERE h.person_id=${personId}::uuid AND h.season_id=${seasonId}::uuid
      AND s.status='CLOSED' AND h.source='SEASON_CLOSURE_V1'
  `;
  if (!row) return { status: "UNAVAILABLE" };
  return { status: "CAPTURED", firstName: row.first_name, paternalSurname: row.paternal_surname,
    maternalSurname: row.maternal_surname, identityVersion: row.identity_version,
    seasonVersion: row.season_version, capturedAt: row.captured_at.toISOString(), source: "SEASON_CLOSURE_V1" };
}

/** El llamador ya autorizó READ del expediente. Datos capturados, nunca people.
 * Las referencias privadas a archivos/decisiones se quedan en servidor.
 */
export async function readHistoricalRegistrationFacts(tx: Prisma.TransactionClient, registrationId: string) {
  const [row] = await tx.$queryRaw<{birth_date:Date|null;reference_year:number|null;identity_version:number;
    rule_version:number;registration_status:string;captured_at:Date}[]>`
    SELECT h.birth_date,h.reference_year,h.identity_version,h.rule_version,h.registration_status,h.captured_at
    FROM sports_management.season_registration_history h
    JOIN sports_management.seasons s ON s.id=h.season_id
    WHERE h.registration_id=${registrationId}::uuid AND s.status='CLOSED'`;
  return row ? {status:"CAPTURED" as const,birthDate:row.birth_date?.toISOString().slice(0,10) ?? null,
    referenceYear:row.reference_year,identityVersion:row.identity_version,ruleVersion:row.rule_version,
    registrationStatus:row.registration_status,capturedAt:row.captured_at.toISOString()}
    : {status:"UNAVAILABLE" as const};
}
