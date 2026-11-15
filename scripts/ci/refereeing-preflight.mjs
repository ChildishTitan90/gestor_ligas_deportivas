export const REFEREE_SLOT_MIGRATION = '20261114010000_pdgld141_refereeing';

/** Lectura sobre el esquema anterior, antes de ejecutar cualquier migración.
 * Diagnóstico acotado: UUID y contexto cerrado; nunca nombres ni texto libre. */
export async function assertNoLegacyRefereeSlotConflicts(client, migrations, applied) {
  if (!migrations.has(REFEREE_SLOT_MIGRATION) || applied.has(REFEREE_SLOT_MIGRATION)) return;
  const {rows} = await client.query(`
    SELECT a.match_id, m.season_id,
      CASE WHEN a.assignment_role='MAIN' THEN 'MAIN' ELSE '[rol legado]' END AS role,
      (s.status='CLOSED' OR ms.code IN ('FINISHED','NO_SHOW','ADMINISTRATIVELY_RESOLVED')) AS closed_context,
      count(*)::int AS approved_count,
      (array_agg(a.id ORDER BY a.id))[1:10] AS assignment_ids,
      count(*) OVER()::int AS conflicting_slots
    FROM sports_management.referee_assignments a
    JOIN sports_management.matches m ON m.id=a.match_id
    JOIN sports_management.seasons s ON s.id=m.season_id
    JOIN sports_management.match_statuses ms ON ms.id=m.status_id
    WHERE a.status='APPROVED'
    GROUP BY a.match_id, a.assignment_role, m.season_id, s.status, ms.code
    HAVING count(*)>1
    ORDER BY a.match_id, a.assignment_role LIMIT 20
  `);
  if (rows.length) throw new Error(
    `LEGACY_REFEREE_SLOT_CONFLICT: ${rows[0].conflicting_slots} grupos de partido/rol con más de una aprobación. ` +
    'Migraciones bloqueadas; revisar docs/architecture/refereeing.md. ' +
    'No se modificaron designaciones. Muestra de hasta 20 grupos y 10 UUID por grupo: ' + JSON.stringify(rows));
}
