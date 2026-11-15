import { notFound } from "next/navigation";
import { requireOperationalUser } from "@/server/auth/session";
import { ReportDemoList } from "@/features/match-reports/components/report-demo-list";

export const metadata = { title: "Demo local · Cédula arbitral", robots: { index: false, follow: false } };

export default async function Page() {
  if (process.env.NODE_ENV !== "development") notFound();
  await requireOperationalUser();
  return <ReportDemoList />;
}
