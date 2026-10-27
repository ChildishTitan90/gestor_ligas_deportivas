import { ActionLink } from "@/components/ui/action-link";
import { getAffiliationReviewLeagueOptions } from "../server/affiliation-review-service";

export async function AffiliationReviewLink() {
  let allowed = false;
  try {
    const leagues = await getAffiliationReviewLeagueOptions();
    allowed = leagues.length > 0;
  } catch { /* La navegación no concede permisos ni bloquea el resto del panel. */ }
  return allowed ? <ActionLink href="/affiliations/review" variant="secondary" className="mt-3 w-full">Revisión de afiliaciones</ActionLink> : null;
}
