import { notFound } from "next/navigation";
import { ReportWorkspace } from "@/features/match-reports/components/report-workspace";
import { REPORT_DEMO_MATCH_ID } from "@/features/match-reports/demo-data";
import { captureCases, createOfflineCapturePreview } from "@/features/match-reports/offline-preview";

export const metadata = { title: "Vista previa offline de la cédula" };

export default async function Page({ params, searchParams }: {
  params: Promise<{ matchId: string }>;
  searchParams: Promise<{ case?: string }>;
}) {
  if (process.env.NODE_ENV !== "development" || (await params).matchId !== REPORT_DEMO_MATCH_ID) notFound();
  const query = await searchParams;
  const scenario = captureCases.find(item => item.value === query.case)?.value ?? "ready";
  return <ReportWorkspace key={scenario} data={createOfflineCapturePreview(scenario)} offlinePreview={scenario} />;
}
