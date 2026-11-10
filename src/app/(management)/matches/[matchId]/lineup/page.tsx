import { getMatchLineup } from "@/features/matches/server/eligibility";
import { LineupEvaluationView } from "@/features/matches/components/lineup-evaluation";
import { AuthorizationError } from "@/server/auth/authorization";
export const metadata = { title: "Elegibilidad de alineación" };
export default async function Page({ params }: { params: Promise<{ matchId: string }> }) {
  let data;
  try { data = await getMatchLineup((await params).matchId); }
  catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    return <section><h1 className="text-2xl font-semibold">Acceso denegado</h1><p>Necesitas una designación arbitral aprobada y permiso vigente para este partido.</p></section>;
  }
  return <LineupEvaluationView data={data} />;
}
