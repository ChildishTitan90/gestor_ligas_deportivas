/** Excepción exacta de desarrollo; nunca omite sesiones en producción o en otras rutas. */
export const TEAM_REGISTRATION_PREVIEW_PATH = "/dev/team-registration";
export function isTeamRegistrationPreview(pathname: string | null, environment: string | undefined) {
  return environment === "development" && pathname === TEAM_REGISTRATION_PREVIEW_PATH;
}
