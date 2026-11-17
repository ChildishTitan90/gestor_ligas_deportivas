import { getCaptureMatches } from "@/features/match-reports/server/service";
import { requireOperationalUser } from "@/server/auth/session";
import { MatchReportList } from "@/features/match-reports/components/match-report-list";
export const metadata = { title: "Cédula arbitral" };
export default async function Page() {
  const matches = await getCaptureMatches((await requireOperationalUser()).id);
  return <MatchReportList matches={matches} />;
}
