type Interval = { startsAt: Date; endsAt: Date };
type Loan = {
  status: "PENDING" | "APPROVED" | "REJECTED";
  seasonId: string;
  clubId: string;
  windows: readonly Interval[];
};

export type HomeVenueCandidate = {
  id: string;
  leagueId: string;
  active: boolean;
  kind: "complex" | "private";
  ownerClubId?: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  openings: readonly Interval[];
  closures: readonly Interval[];
  loans: readonly Loan[];
};

type HomeVenueContext = {
  leagueId: string;
  seasonId: string;
  homeClubId: string;
  awayClubId: string;
  roundsAfterThis: number;
  complexOnlyFinalRounds: number;
  startsAt: Date;
  priorHomeVenueId?: string;
};

const preference = { OWN: 0, HOME_LOAN: 1, COMPLEX: 2 } as const;

function contains(window: Interval, start: number, end: number) {
  return window.startsAt.getTime() <= start && window.endsAt.getTime() >= end;
}

export function homeVenueOptions(context: HomeVenueContext, venues: readonly HomeVenueCandidate[]) {
  const { roundsAfterThis, complexOnlyFinalRounds } = context;
  if (!Number.isSafeInteger(roundsAfterThis) || roundsAfterThis < 0 ||
      !Number.isSafeInteger(complexOnlyFinalRounds) || complexOnlyFinalRounds < 0) {
    throw new RangeError("Invalid season venue rule");
  }
  const start = context.startsAt.getTime();
  if (!Number.isFinite(start)) throw new RangeError("Invalid kickoff");
  const complexOnly = roundsAfterThis < complexOnlyFinalRounds;

  return venues.flatMap(venue => {
    if (!venue.active || venue.leagueId !== context.leagueId ||
        (complexOnly && venue.kind !== "complex") ||
        !Number.isInteger(venue.durationMinutes) || venue.durationMinutes < 1 || venue.durationMinutes > 1440 ||
        !Number.isInteger(venue.bufferMinutes) || venue.bufferMinutes < 0 || venue.bufferMinutes > 1440) return [];

    const end = start + venue.durationMinutes * 60_000;
    const reserved = end + venue.bufferMinutes * 60_000;
    if (!Number.isFinite(new Date(reserved).getTime()) ||
        !venue.openings.some(window => contains(window, start, reserved)) ||
        venue.closures.some(window => start < window.endsAt.getTime() && window.startsAt.getTime() < reserved)) return [];

    const approvedFor = (clubId: string) => venue.loans.some(loan =>
      loan.status === "APPROVED" && loan.seasonId === context.seasonId && loan.clubId === clubId &&
      loan.windows.some(window => contains(window, start, reserved)));

    const source: keyof typeof preference | null = venue.kind === "complex" ? "COMPLEX"
      : venue.ownerClubId === context.homeClubId ? "OWN"
      : approvedFor(context.homeClubId) ? "HOME_LOAN" : null;
    if (!source) return [];

    return [{ venueId: venue.id, source, endsAt: new Date(end), reservedUntil: new Date(reserved) }];
  }).sort((a, b) => preference[a.source] - preference[b.source]);
}
