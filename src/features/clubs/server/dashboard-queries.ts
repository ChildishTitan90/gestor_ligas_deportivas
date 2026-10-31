import "server-only";

import { Prisma } from "@prisma/client";
import { getPrisma } from "@/server/db/prisma";
import { assertPermission } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { dashboardContextSchema, type DashboardSummary } from "../dashboard";

export async function getClubDashboardSummary(input: unknown): Promise<DashboardSummary> {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(tx => readClubDashboardSummary(tx, actor.id, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

/** actorId procede exclusivamente de la sesión o de pruebas aisladas del servidor. */
export async function readClubDashboardSummary(
  tx: Prisma.TransactionClient, actorId: string, input: unknown,
): Promise<DashboardSummary> {
  const context = dashboardContextSchema.parse(input);
  const scope = context.kind === "league" ? { leagueId: context.id } : { clubId: context.id };
  // Mismo límite de lectura que los listados: una concesión por club no abre su liga.
  await assertPermission(tx, actorId, { module: "clubs", action: "READ", context: scope });
  const resource = context.kind === "league"
    ? await tx.leagues.findUniqueOrThrow({ where: { id: context.id }, select: { name: true } })
    : await tx.clubs.findUniqueOrThrow({ where: { id: context.id }, select: { name: true } });
  const where = context.kind === "league" ? { league_id: context.id } : { club_id: context.id };
  // Agregados completos, nunca tamaños de páginas. Las fases coinciden con affiliationReviewPhase.
  const awaitingReview = await tx.club_affiliations.count({ where: {
    ...where, status: "PENDING", OR: [{ review_reason: null }, { review_reason: "" }],
  } });
  const correctionsRequested = await tx.club_affiliations.count({ where: {
    ...where, status: "PENDING", NOT: [{ review_reason: null }, { review_reason: "" }],
  } });
  const approved = await tx.club_affiliations.count({ where: { ...where, status: "APPROVED" } });
  // Registros de todas las temporadas, incluidos retirados; no equipos únicos.
  const enrollments = context.kind === "club"
    ? await tx.season_teams.count({ where: { club_id: context.id } }) : null;
  return { context, name: resource.name, awaitingReview, correctionsRequested, approved, enrollments };
}
