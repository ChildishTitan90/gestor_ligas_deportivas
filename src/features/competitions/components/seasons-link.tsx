import { ActionLink } from "@/components/ui/action-link";
import { getSeasonWorkspace } from "../server/seasons";

export async function SeasonsLink() {
  let allowed = false;
  try {
    const data = await getSeasonWorkspace();
    allowed = data.leagues.length > 0;
  } catch { /* El servicio y la página conservan la autorización. */ }
  return allowed ? <ActionLink href="/competitions/seasons" variant="secondary" className="mt-3 w-full">Temporadas</ActionLink> : null;
}
