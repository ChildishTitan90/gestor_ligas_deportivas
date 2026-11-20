import { OfflineReportApp } from "@/features/match-reports/components/offline-report-app";
export const metadata = { title: "Cédulas en este dispositivo" };
export const dynamic = "force-static";
export default function Page() {
  return <OfflineReportApp />;
}
