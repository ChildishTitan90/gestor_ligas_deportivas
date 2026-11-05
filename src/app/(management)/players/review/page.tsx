import { getPlayerReviewWorkspace } from "@/features/players/server/review-workspace-queries";
import { PlayerReviewWorkspace } from "@/features/players/components/player-review-workspace";

export const metadata = { title: "Revisión de identidad" };

export default async function Page() {
  const items = await getPlayerReviewWorkspace();
  return <section className="mx-auto w-full max-w-6xl"><PlayerReviewWorkspace items={items} /></section>;
}
