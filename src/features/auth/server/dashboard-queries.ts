import "server-only";

import { z } from "zod";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";
import { getAffiliationReviewLeagueOptions } from "@/features/clubs/server/affiliation-review-service";
import { getTeamEnrollmentCatalogs } from "@/features/clubs/server/team-enrollment-queries";
import { getClubDashboardSummary } from "@/features/clubs/server/dashboard-queries";
import { parseDashboardContext, type DashboardSummary } from "@/features/clubs/dashboard";

export type DashboardActivity = {
  options: { value: string; label: string }[];
  selected: string;
  nextClubAfter: string | null;
  state: "ready" | "empty" | "invalid" | "denied" | "unavailable";
  summary: DashboardSummary | null;
};

/** Catálogos autorizados sin seleccionar el primer ámbito por el usuario. */
export async function getDashboardActivity(contextValue: unknown, clubAfterValue: unknown): Promise<DashboardActivity> {
  const result: DashboardActivity = { options: [], selected: "", nextClubAfter: null, state: "empty", summary: null };
  const context = parseDashboardContext(contextValue);
  const cursor = clubAfterValue === undefined ? undefined : z.uuid().safeParse(clubAfterValue).data;
  if ((contextValue !== undefined && contextValue !== "" && !context) || (clubAfterValue !== undefined && !cursor)) {
    result.state = "invalid";
  }
  try {
    const [leagues, clubs] = await Promise.all([
      getAffiliationReviewLeagueOptions(),
      getTeamEnrollmentCatalogs({ limit: 20, ...(cursor ? { clubAfter: cursor } : {}) })
        .catch(error => { if (error instanceof AuthorizationError) return null; throw error; }),
    ]);
    result.options = [
      ...leagues.map(league => ({ value: `league:${league.id}`, label: `Liga · ${league.name}` })),
      ...(clubs?.clubs.map(club => ({ value: `club:${club.id}`, label: `Club · ${club.name}` })) ?? []),
    ];
    result.nextClubAfter = clubs?.nextClubAfter ?? null;
    if (result.state === "invalid") return result;
    if (context) {
      result.summary = await getClubDashboardSummary(context);
      result.selected = `${context.kind}:${context.id}`;
      // Un enlace directo puede elegir otro club del catálogo, siempre autorizado de nuevo.
      if (!result.options.some(option => option.value === result.selected)) {
        result.options.push({ value: result.selected,
          label: `${context.kind === "club" ? "Club" : "Liga"} · ${result.summary.name}` });
      }
    }
    result.state = "ready";
  } catch (error) {
    if (error instanceof AuthAccessError) throw error;
    result.state = error instanceof AuthorizationError ? "denied" : "unavailable";
    if (result.state === "unavailable") console.error("[dashboard] ACTIVITY_UNAVAILABLE");
  }
  return result;
}
