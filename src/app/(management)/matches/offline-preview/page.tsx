import { notFound } from "next/navigation";
import { OfflinePreviewList } from "@/features/match-reports/components/offline-preview-list";
import { downloadCases } from "@/features/match-reports/offline-preview";

export const metadata = { title: "Vista previa offline de cédulas" };

export default async function Page({ searchParams }: { searchParams: Promise<{ case?: string }> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const query = await searchParams;
  const scenario = downloadCases.find(item => item.value === query.case)?.value ?? "prepare";
  return <OfflinePreviewList key={scenario} scenario={scenario} />;
}
