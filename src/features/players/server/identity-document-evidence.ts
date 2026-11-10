import "server-only";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { readLockedPlayerTeamContext } from "./access";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function ineSnapshotHash(context: unknown, identityVersion: number, withdrawnAt: Date | null, categoryType: string) {
  return hash([context, identityVersion, withdrawnAt, categoryType]);
}

/** El consumidor ya autorizó la inscripción. No consulta proveedores ni modifica documentos.
 * Un acuse favorable solo vale para la identidad y el contexto que se cotejaron. */
export async function readIdentityDocumentEvidence(tx: Prisma.TransactionClient, registrationId: string) {
  const reg = await tx.player_registrations.findUniqueOrThrow({ where: { id: registrationId }, select: {
    person_id: true, season_team_id: true, status: true, withdrawn_at: true,
    people: { select: { curp: true, first_name: true, paternal_surname: true, maternal_surname: true, birth_date: true, identity_version: true } },
  } });
  const person = reg.people;
  const identity = { curp: person.curp, firstName: person.first_name, paternalSurname: person.paternal_surname,
    maternalSurname: person.maternal_surname ?? "", birthDate: person.birth_date?.toISOString().slice(0, 10) };
  const check = await tx.player_curp_checks.findFirst({ where: { person_id: reg.person_id },
    orderBy: [{ created_at: "desc" }, { id: "desc" }], select: { id: true, status: true, identity_version: true, fingerprint: true } });
  const curp = check?.status === "VERIFIED" && check.identity_version === person.identity_version &&
    check.fingerprint === hash([person.identity_version, identity]) ? { checkId: check.id } : null;
  const prepared = await tx.audit_logs.findFirst({ where: { entity_id: registrationId, action: "PLAYER_INE_PREPARED" },
    orderBy: [{ occurred_at: "desc" }, { id: "desc" }], select: { id: true, new_data: true } });
  let ine: { attemptId: string } | null = null;
  if (prepared && !reg.withdrawn_at && ["INELIGIBLE", "ACTIVE"].includes(reg.status)) {
    const context = await readLockedPlayerTeamContext(tx, reg.season_team_id);
    const category = await tx.season_categories.findUniqueOrThrow({ where: { id: context.seasonCategoryId }, select: { type: true } });
    const intent = prepared.new_data as { snapshotVersion?: number; snapshotHash?: string } | null;
    // v1 incluía INELIGIBLE en su huella. La activación posterior no cambia la identidad.
    const expected = intent?.snapshotVersion === 2 ? ineSnapshotHash(context, person.identity_version, reg.withdrawn_at, category.type)
      : hash([context, person.identity_version, "INELIGIBLE", reg.withdrawn_at, category.type]);
    if (intent?.snapshotHash === expected) {
      const result = await tx.audit_logs.findFirst({ where: { entity_id: registrationId, action: "PLAYER_INE_RESULT",
        new_data: { path: ["attemptId"], equals: prepared.id } }, select: { new_data: true } });
      const verdict = result?.new_data as { outcome?: string; matchingVersion?: number } | undefined;
      if (verdict?.outcome === "IDENTITY_VERIFIED" && verdict.matchingVersion === 1) ine = { attemptId: prepared.id };
    }
  }
  return { curp, ine };
}
