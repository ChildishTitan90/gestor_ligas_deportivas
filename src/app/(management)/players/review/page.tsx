import { getPlayerReviewWorkspace } from "@/features/players/server/review-workspace-queries";
import { PlayerReviewWorkspace } from "@/features/players/components/player-review-workspace";
import { parsePlayerReviewFilters, playerReviewFilterQuery } from "@/features/players/review-workspace";

export const metadata = { title: "Revisión de identidad y expedientes" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const items = await getPlayerReviewWorkspace();
  const filters = parsePlayerReviewFilters(await searchParams);
  return <section className="mx-auto w-full max-w-6xl">
    <PlayerReviewWorkspace key={playerReviewFilterQuery(filters)} items={items} initialFilters={filters} />
  </section>;
}
