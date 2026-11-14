import { redirect } from "next/navigation";
import { RefereeWorkspace } from "@/features/referees/components/referee-workspace";
import { getRefereePreview } from "@/features/referees/server/preview";
import { canAccessMatchEligibility } from "@/features/matches/server/eligibility";
import { viewLabels } from "@/features/referees/preview-model";
import type { RefereeView } from "@/features/referees/types";
import { AuthAccessError } from "@/server/auth/session";

export const metadata = { title: "Árbitros y designaciones · Demostración", robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: requestedView } = await searchParams;
  const view: RefereeView = requestedView && Object.hasOwn(viewLabels, requestedView) ? requestedView as RefereeView : "register";
  let data;
  let matchesHref;
  try {
    data = await getRefereePreview();
    matchesHref = await canAccessMatchEligibility() ? "/matches" : null;
  } catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    throw error;
  }
  return <RefereeWorkspace initialData={data} view={view} matchesHref={matchesHref} />;
}
