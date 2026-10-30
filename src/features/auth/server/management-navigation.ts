import "server-only";

import type { ManagementNavigationGroup } from "@/components/layout/management-navigation";
import { getAccountCreationOptions } from "@/features/accounts/server/service";
import { canAccessAffiliationCapture } from "@/features/clubs/server/affiliation-form-queries";
import { getAffiliationReviewLeagueOptions } from "@/features/clubs/server/affiliation-review-service";
import { getTeamEnrollmentCatalogs } from "@/features/clubs/server/team-enrollment-queries";
import { AuthorizationError } from "@/server/auth/authorization";
import { requireOperationalUser } from "@/server/auth/session";

/** Solo una denegación esperada oculta el enlace; los fallos de sesión o servicio se propagan. */
async function allowed(check: () => Promise<boolean>): Promise<boolean> {
  try {
    return await check();
  } catch (error) {
    if (error instanceof AuthorizationError) return false;
    throw error;
  }
}

/** Presentación de rutas implementadas. Cada destino conserva su propia autorización. */
export async function getManagementNavigation(): Promise<ManagementNavigationGroup[]> {
  await requireOperationalUser();
  const [teams, capture, review, accounts] = await Promise.all([
    allowed(async () => (await getTeamEnrollmentCatalogs({ limit: 1 })).clubs.length > 0),
    allowed(canAccessAffiliationCapture),
    allowed(async () => (await getAffiliationReviewLeagueOptions()).length > 0),
    allowed(async () => (await getAccountCreationOptions()).roles.length > 0),
  ]);

  const groups: ManagementNavigationGroup[] = [
    { label: "General", items: [{ href: "/access", label: "Mi panel", icon: "overview" }] },
  ];
  const clubs: ManagementNavigationGroup = { label: "Clubes y equipos", items: [] };
  if (capture) clubs.items.push({ href: "/affiliations/new", label: "Mis solicitudes de afiliación", icon: "affiliations" });
  if (review) clubs.items.push({ href: "/affiliations/review", label: "Revisión de afiliaciones", icon: "review" });
  if (teams) clubs.items.push({ href: "/teams/registrations", label: "Inscripción y consulta de equipos", icon: "teams" });
  if (clubs.items.length) groups.push(clubs);
  if (accounts) groups.push({ label: "Administración", items: [{ href: "/accounts/new", label: "Crear cuenta", icon: "accounts" }] });
  return groups;
}
