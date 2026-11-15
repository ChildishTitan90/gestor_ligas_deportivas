import "server-only";
import type { Prisma } from "@prisma/client";
/** Contrato PDGLD-117: llamar dentro de APPLY, después de autorizar TODAS las
 * referencias y actualizar la misma Persona. No cambia partidos ni designaciones.
 * Las comprobaciones de acceso usan la versión y evaluación SQL en cada lectura. */
export async function recordRefereeIdentityReassessment(tx: Prisma.TransactionClient, personId: string, actorId: string, correctionId: string) {
  const rows = await tx.$queryRaw<{id:string;referee_id:string;effective:boolean}[]>`SELECT a.id,a.referee_id,sports_management.referee_assignment_effective(a.id) AS effective
    FROM sports_management.referee_assignments a JOIN sports_management.referees r ON r.id=a.referee_id
    JOIN sports_management.matches m ON m.id=a.match_id JOIN sports_management.seasons s ON s.id=m.season_id
    JOIN sports_management.match_statuses st ON st.id=m.status_id
    WHERE r.person_id=${personId}::uuid AND s.status<>'CLOSED' AND st.code NOT IN ('FINISHED','NO_SHOW','ADMINISTRATIVELY_RESOLVED') AND a.status<>'REVOKED'`;
  for (const row of rows) await tx.audit_logs.create({data:{user_id:actorId,table_name:"referee_assignments",entity_id:row.id,action:"REFEREE_IDENTITY_REASSESSED",reason:"Identidad corregida: evaluación del contexto abierto; sin reescribir la designación",new_data:{correctionId,effective:row.effective,requiresReview:!row.effective}}});
}
