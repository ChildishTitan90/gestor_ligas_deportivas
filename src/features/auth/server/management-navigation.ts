import "server-only";
import { canReadStandings } from "@/features/standings/server/queries";
import { canReadCatalog } from "@/features/discipline/server/catalog";

import type { ManagementNavigationGroup } from "@/components/layout/management-navigation";
import { canCreateAccounts } from "@/features/accounts/server/queries";
import { canAccessAffiliationCapture } from "@/features/clubs/server/affiliation-form-queries";
import { getAffiliationReviewLeagueOptions } from "@/features/clubs/server/affiliation-review-service";
import { getTeamEnrollmentCatalogs } from "@/features/clubs/server/team-enrollment-queries";
import { getSeasonWorkspace } from "@/features/competitions/server/seasons";
import { canCreateLeague } from "@/features/competitions/server/leagues";
import { canAccessClubMaintenance } from "@/features/clubs/server/maintenance";
import { AuthorizationError } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";
import { canAccessPlayerRegistration } from "@/features/players/server/workspace-queries";
import { canReviewPlayerIdentity } from "@/features/players/server/identity-review";
import {canAccessPlayerParticipations} from "@/features/players/server/participation-workspace-queries";
import { canReadGovernance } from "@/features/governance/server/service";
import { canAccessVenueLoans } from "@/features/venues/server/loan-workspace";
import { canReadScheduleProposals } from "@/features/scheduling/server/proposals";
import { canReadVenues } from "@/features/venues/server/service";
import { canGenerateSchedule } from "@/features/scheduling/server/workspace";
import { canReadAccountMaintenance } from "@/features/accounts/server/maintenance-workspace";
import { canAccessRecorderWorkspace } from "@/features/matches/server/recorder-workspace";
import { canUseReportWorkspace } from "@/features/match-reports/server/service";
import { canReadRefereeing } from "@/features/referees/server/service";
import { canAccessRefereePresentations } from "@/features/referees/server/presentations";
import { canReadOwnRefereeAvailability } from "@/features/referees/server/own-availability";
import { canReadCharges } from "@/features/billing/server/queries";
const canAccessMatchEligibility = async () => canUseReportWorkspace((await requireOperationalUser()).id);

/** Solo una denegación esperada oculta el enlace; los fallos de sesión o servicio se propagan. */
async function allowed(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch (error) {
    if (error instanceof AuthorizationError) return false;
    throw error;
  }
}

/** Cada comprobación abre sus propias lecturas/transacciones. Mantener dos en
 * vuelo evita agotar el pool al cargar a la vez el menú y el panel privado. */
async function navigationCapabilities(checks: (() => Promise<boolean>)[]) {
  const results: boolean[] = [];
  let next = 0;
  await Promise.all(Array.from({length: Math.min(2, checks.length)}, async () => {
    for (;;) {
      const index = next++;
      if (index >= checks.length) return;
      results[index] = await allowed(checks[index]);
    }
  }));
  return results;
}

/** Presentación de rutas implementadas. Cada destino conserva su propia autorización. */
export async function getManagementNavigation(): Promise<ManagementNavigationGroup[]> {
  await requireOperationalUser();
  const [teams, capture, review, accounts, players, playerReview, seasons, leagues, participations, maintenance, accountMaintenance, matchEligibility, venues, recorder, governance, catalog, venueLoans, scheduling, standings] = await navigationCapabilities([
    async () => (await getTeamEnrollmentCatalogs({ limit: 1 })).clubs.length > 0,
    canAccessAffiliationCapture,
    async () => (await getAffiliationReviewLeagueOptions()).length > 0,
    canCreateAccounts,
    canAccessPlayerRegistration,
    canReviewPlayerIdentity,
    async () => (await getSeasonWorkspace()).leagues.length > 0,
    canCreateLeague,
    canAccessPlayerParticipations,
    canAccessClubMaintenance,
    canReadAccountMaintenance,
    canAccessMatchEligibility,
    canReadVenues,
    canAccessRecorderWorkspace,
    canReadGovernance,
    canReadCatalog,
    canAccessVenueLoans,
    canReadScheduleProposals,
    canReadStandings,
  ]);

  const groups: ManagementNavigationGroup[] = [
    { label: "General", items: [{ href: "/access", label: "Mi panel", icon: "overview" }] },
  ];
  const clubs: ManagementNavigationGroup = { label: "Clubes y equipos", items: [] };
  if (maintenance) clubs.items.push({ href: "/clubs", label: "Administrar clubes y equipos", icon: "teams" });
  if (capture) clubs.items.push({ href: "/affiliations/new", label: "Mis solicitudes de afiliación", icon: "affiliations" });
  if (review) clubs.items.push({ href: "/affiliations/review", label: "Revisión de afiliaciones", icon: "review" });
  if (teams) clubs.items.push({ href: "/teams/registrations", label: "Inscripción y consulta de equipos", icon: "teams" });
  if (clubs.items.length) groups.push(clubs);
  const playerLinks: ManagementNavigationGroup = {label:"Jugadores",items:[]};
  if(players) playerLinks.items.push({href:"/players/registrations",label:"Jugadores",icon:"players"});
  if(playerReview) playerLinks.items.push({href:"/players/review",label:"Revisión de identidad",icon:"review"});
  if(participations)playerLinks.items.push({href:"/players/participations",label:"Participaciones superiores",icon:"players"});
  if(playerLinks.items.length) groups.push(playerLinks);
  const arbitration: ManagementNavigationGroup = { label: "Arbitraje", items: [] };
  if (await allowed(canReadRefereeing)) arbitration.items.push({ href: "/referees", label: "Árbitros y designaciones", icon: "players" });
  if (await allowed(canAccessRefereePresentations)) arbitration.items.push({href:"/referees/presentations",label:"Presentación de árbitros por club",icon:"players"});
  if (await allowed(canReadOwnRefereeAvailability)) arbitration.items.push({href:"/referees/my-availability",label:"Mi disponibilidad",icon:"players"});
  if(matchEligibility) arbitration.items.push({href:"/matches",label:"Cédula arbitral",icon:"players"});
  if (arbitration.items.length) groups.push(arbitration);
  if(recorder) groups.push({label:"Partidos",items:[{href:"/matches/recording",label:"Registro de partidos",icon:"overview"}]});
  const competitions: ManagementNavigationGroup = { label: "Competencias", items: [] };
  if (leagues) competitions.items.push({ href: "/competitions/leagues/new", label: "Crear liga", icon: "overview" });
  if (seasons) competitions.items.push({ href: "/competitions/seasons", label: "Temporadas", icon: "overview" });
  if (venueLoans) competitions.items.push({ href: "/venues/loans", label: "Préstamos de canchas", icon: "overview" });
  if (venues) competitions.items.push({ href: "/venues", label: "Canchas y disponibilidad", icon: "overview" });
  if (await allowed(canGenerateSchedule)) competitions.items.push({ href: "/competitions/scheduling", label: "Generar calendario", icon: "overview" });
  if (scheduling) competitions.items.push({ href: "/scheduling/proposals", label: "Propuestas de programación", icon: "overview" });
  if (standings) competitions.items.push({ href: "/standings", label: "Clasificación", icon: "overview" });
  if (competitions.items.length) groups.push(competitions);
  const administration: ManagementNavigationGroup = { label: "Administración", items: [] };
  if (accountMaintenance || accounts) administration.items.push({ href: "/accounts", label: "Administrar cuentas", icon: "accounts" });
  if (governance) administration.items.push({ href: "/governance", label: "Órganos y cargos", icon: "overview" });
  if (administration.items.length) groups.push(administration);
  if (catalog) groups.push({ label: "Disciplina", items: [{ href: "/discipline/catalog", label: "Catálogo disciplinario", icon: "review" }] });
  if (await allowed(canReadCharges)) groups.push({ label: "Tesorería", items: [{ href: "/treasury/charges", label: "Cargos", icon: "overview" }] });
  return groups;
}
