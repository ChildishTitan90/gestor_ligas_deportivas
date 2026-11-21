import { overlaps } from "./generator";
import { authorizedHomeAssignment, participationBlocked } from "./constraints";
import { fitsLoanWindow } from "./loan-windows";
import { venueLocalTime } from "@/features/venues/time";

type HomeAssignments = Parameters<typeof authorizedHomeAssignment>[0];
type Sanctions = Parameters<typeof participationBlocked>[0];
type Windows = Parameters<typeof fitsLoanWindow>[0];
type Range = { starts_at: Date; ends_at: Date; type: string };
type Day = { start_date: Date; end_date: Date };
export type SlotContext = {
  seasonId: string; timezone: string; seasonStart: Date; seasonEnd: Date;
  day: Day; home: string; away: string; homeClub: string;
  matchDurationMinutes: number; complexOnly: boolean; allowedVenueIds?: string[];
  breaks: { starts_at: Date; ends_at: Date }[]; sanctions: Sanctions;
  venue: { id: string; is_league_sports_complex: boolean; owner_club_id?: string | null; match_duration_minutes: number;
    buffer_minutes: number; venue_availability: Range[]; home_venue_assignments: HomeAssignments };
  loanWindows: Windows;
};
const dateOnly = (value: Date) => value.toISOString().slice(0, 10);

/** Validación común de un horario exacto, con datos vigentes cargados por el servidor. */
export function validateSlot(context: SlotContext, start: number) {
  const { venue, day } = context;
  if (context.allowedVenueIds && !context.allowedVenueIds.includes(venue.id)) return { ok:false as const, factor:"VENUE_STAGE" };
  if (context.complexOnly && !venue.is_league_sports_complex) return { ok:false as const, factor:"FINAL_ROUNDS" };
  if (venue.match_duration_minutes !== context.matchDurationMinutes) return { ok:false as const, factor:"DURATION" };
  const end=start+venue.match_duration_minutes*60000, reservedUntil=end+venue.buffer_minutes*60000;
  if (!Number.isFinite(start) || !venue.venue_availability.some(a=>a.type==="AVAILABLE" && +a.starts_at<=start && reservedUntil<=+a.ends_at))
    return { ok:false as const, factor:"NO_OPENING" };
  const local=venueLocalTime(new Date(start),context.timezone), date=local.slice(0,10);
  const lastLocal=venueLocalTime(new Date(reservedUntil-1),context.timezone), finalDate=lastLocal.slice(0,10);
  if(date<dateOnly(day.start_date)||finalDate>dateOnly(day.end_date)||date<dateOnly(context.seasonStart)||finalDate>dateOnly(context.seasonEnd))
    return { ok:false as const, factor:"NO_OPENING" };
  if(participationBlocked(context.sanctions,[context.home,context.away],start,end)) return {ok:false as const,factor:"SANCTION"};
  if(context.breaks.some(b=>date<=dateOnly(b.ends_at)&&finalDate>=dateOnly(b.starts_at))) return {ok:false as const,factor:"SEASON_BREAK"};
  if(venue.venue_availability.some(a=>a.type!=="AVAILABLE"&&overlaps(start,reservedUntil,+a.starts_at,+a.ends_at))) return {ok:false as const,factor:"VENUE_BLOCK"};
  if(!venue.is_league_sports_complex&&venue.owner_club_id!==context.homeClub&&!fitsLoanWindow(context.loanWindows,start,reservedUntil)) return {ok:false as const,factor:"LOAN_WINDOW"};
  const preferred=authorizedHomeAssignment(venue.home_venue_assignments,{teamId:context.home,clubId:context.homeClub,
    seasonId:context.seasonId,venueId:venue.id,localStart:local,localEnd:lastLocal,
    directAssignmentAllowed:venue.is_league_sports_complex || venue.owner_club_id===context.homeClub});
  return {ok:true as const,slot:{venueId:venue.id,start,end,reservedUntil,preference:preferred?0:1}};
}
