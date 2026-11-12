import "server-only";

import type { ManagementNavigationGroup } from "@/components/layout/management-navigation";
import { getAccountCreationOptions } from "@/features/accounts/server/service";
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
import { canReadVenues } from "@/features/venues/server/service";
import { canReadAccountMaintenance } from "@/features/accounts/server/maintenance-workspace";

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
  const [teams, capture, review, accounts, players, playerReview, seasons, leagues,participations,maintenance,accountMaintenance,venues] = await navigationCapabilities([
    async () => (await getTeamEnrollmentCatalogs({ limit: 1 })).clubs.length > 0,
    canAccessAffiliationCapture,
    async () => (await getAffiliationReviewLeagueOptions()).length > 0,
    async () => (await getAccountCreationOptions()).roles.length > 0,
    canAccessPlayerRegistration,
    canReviewPlayerIdentity,
    async () => (await getSeasonWorkspace()).leagues.length > 0,
    canCreateLeague,
    canAccessPlayerParticipations,
    canAccessClubMaintenance,
    canReadAccountMaintenance,
    canReadVenues,
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
  const competitions: ManagementNavigationGroup = { label: "Competencias", items: [] };
  if (leagues) competitions.items.push({ href: "/competitions/leagues/new", label: "Crear liga", icon: "overview" });
  if (seasons) competitions.items.push({ href: "/competitions/seasons", label: "Temporadas", icon: "overview" });
  if (venues) competitions.items.push({ href: "/venues", label: "Canchas y disponibilidad", icon: "overview" });
  if (competitions.items.length) groups.push(competitions);
  const administration: ManagementNavigationGroup = { label: "Administración", items: [] };
  if (accountMaintenance) administration.items.push({ href: "/accounts", label: "Administrar cuentas", icon: "accounts" });
  if (accounts) administration.items.push({ href: "/accounts/new", label: "Crear cuenta", icon: "accounts" });
  if (administration.items.length) groups.push(administration);
  return groups;
}
