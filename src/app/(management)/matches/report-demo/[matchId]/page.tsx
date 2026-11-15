import { notFound } from "next/navigation";
import { requireOperationalUser } from "@/server/auth/session";
import { createReportDemo, REPORT_DEMO_MATCH_ID, reportDemoCases } from "@/features/match-reports/demo-data";
import { ReportWorkspace } from "@/features/match-reports/components/report-workspace";

export const metadata = { title: "Demo local · Capturar cédula", robots: { index: false, follow: false } };

export default async function Page({ params, searchParams }: {
  params: Promise<{ matchId: string }>;
  searchParams: Promise<{ case?: string | string[] }>;
}) {
  if (process.env.NODE_ENV !== "development") notFound();
  await requireOperationalUser();
  if ((await params).matchId !== REPORT_DEMO_MATCH_ID) notFound();
  const requested = (await searchParams).case;
  const scenario = reportDemoCases.find(item => item.value === requested)?.value ?? "draft";
  return <ReportWorkspace key={scenario} data={createReportDemo(scenario)} />;
}
