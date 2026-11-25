import { getCaptureMatches } from "@/features/match-reports/server/service";
import { requireOperationalUser } from "@/server/auth/session";
import { MatchReportOfflineList } from "@/features/match-reports/components/match-report-offline-list";
export const metadata = { title: "Cédula arbitral" };
export default async function Page() {
  const actor = await requireOperationalUser();
  const matches = await getCaptureMatches(actor.id);
  return <MatchReportOfflineList matches={matches} actorId={actor.id} />;
}
