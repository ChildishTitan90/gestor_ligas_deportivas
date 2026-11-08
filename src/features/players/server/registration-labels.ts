import "server-only";
import type { Prisma } from "@prisma/client";
import type { PlayerReviewLabels } from "../review-workspace";

/** Llamar después de autorizar READ; una bandeja exige además APPROVE del caso. */
export async function readRegistrationLabels(tx: Prisma.TransactionClient, registrationId: string): Promise<PlayerReviewLabels> {
  const [row] = await tx.$queryRaw<(Omit<PlayerReviewLabels, "registeredAt"> & { registeredAt: Date })[]>`
    SELECT pr.id, CASE WHEN s.status='CLOSED' THEN
        CASE WHEN h.person_id IS NULL THEN 'Información histórica no disponible'
          ELSE concat_ws(' ',h.first_name,h.paternal_surname,h.maternal_surname) END
        ELSE concat_ws(' ',p.first_name,p.paternal_surname,p.maternal_surname) END AS name,
      t.name AS team, c.id AS "clubId", c.name AS club, s.id AS "seasonId", s.name AS season,
      cat.name AS category, pr.registered_at AS "registeredAt"
    FROM sports_management.player_registrations pr
    JOIN sports_management.people p ON p.id=pr.person_id
    JOIN sports_management.season_teams st ON st.id=pr.season_team_id
    JOIN sports_management.teams t ON t.id=st.team_id
    JOIN sports_management.clubs c ON c.id=t.club_id
    JOIN sports_management.seasons s ON s.id=st.season_id
      LEFT JOIN sports_management.season_person_identity_snapshots h
        ON h.season_id=s.id AND h.person_id=pr.person_id
    JOIN sports_management.groups g ON g.id=st.group_id
    JOIN sports_management.season_categories sc ON sc.id=g.season_category_id
    JOIN sports_management.categories cat ON cat.id=sc.category_id
    WHERE pr.id=${registrationId}::uuid
  `;
  if (!row) throw new Error("PLAYER_REVIEW_CONTEXT_UNAVAILABLE");
  return { ...row, registeredAt: row.registeredAt.toISOString() };
}
