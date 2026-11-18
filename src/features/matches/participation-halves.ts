/** RF02.7: una reserva por mitad no acredita minutos jugados ni cambia la inscripción. */
export type ParticipationHalf = 1 | 2;
export type HalfBoundaries = { firstStartedAt?: string; firstEndedAt?: string; secondStartedAt?: string; secondEndedAt?: string };
export type HalfContext = {
  seasonId: string; clubId: string; categoryId: string; half?: ParticipationHalf;
  startsAt: Date | null; endsAt: Date | null;
  boundaries?: HalfBoundaries; hasParticipation: boolean;
};
export function halfCrossingProblem(a: HalfContext, b: HalfContext): string | null {
  const complete = a.startsAt && a.endsAt && b.startsAt && b.endsAt;
  const scheduledCross = !complete || a.startsAt! < b.endsAt! && b.startsAt! < a.endsAt!;
  // Las marcas reales pueden revelar un cruce aunque la programación esté separada.
  const interval = (c: HalfContext) => {
    if (!c.hasParticipation) return null;
    const start = c.half === 2 ? c.boundaries?.secondStartedAt : c.boundaries?.firstStartedAt;
    const end = c.half === 1 ? c.boundaries?.firstEndedAt : c.boundaries?.secondEndedAt;
    return start ? [Date.parse(start), end ? Date.parse(end) : Infinity] : null;
  };
  const left = interval(a), right = interval(b);
  const actualCross = !!left && !!right && left[0] < right[1] && right[0] < left[1];
  if (!scheduledCross && !actualCross) return null;
  if (a.seasonId !== b.seasonId || a.clubId !== b.clubId || a.categoryId === b.categoryId) return "PARTICIPATION_CONTEXT_CONFLICT";
  if (!a.half || !b.half) return "PARTICIPATION_HALF_REQUIRED";
  if (a.half === b.half) return "PARTICIPATION_HALF_CONFLICT";
  const first = a.half === 1 ? a : b, second = a.half === 2 ? a : b;
  if (!second.hasParticipation) return null;
  const end = first.boundaries?.firstEndedAt, start = second.boundaries?.secondStartedAt;
  if (!end || !start) return "PARTICIPATION_CLOCK_REQUIRED";
  if (Date.parse(end) > Date.parse(start)) return "PARTICIPATION_REAL_TIME_CONFLICT";
  return null;
}
export const halfBlockerMessages: Record<string, string> = {
  PARTICIPATION_CONTEXT_CONFLICT: "El cruce solo permite categorías distintas del mismo club y temporada.",
  PARTICIPATION_HALF_REQUIRED: "Para compartir horarios indica una mitad distinta en cada cédula. La reserva no autoriza entrar antes del medio tiempo.",
  PARTICIPATION_HALF_CONFLICT: "El jugador ya está reservado para la misma mitad en otro partido coincidente.",
  PARTICIPATION_CLOCK_REQUIRED: "Faltan marcas reales del descanso y del segundo tiempo para comprobar el traslado.",
  PARTICIPATION_REAL_TIME_CONFLICT: "El segundo tiempo comenzó antes de terminar el primero del otro partido; no se autoriza este traslado.",
};
