import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { venueLocalTime, venueTimeToIso } from "@/features/venues/time";
import { generateScheduleSchema, schedulingPolicySchema } from "../schemas";
import { assignSlots, overlaps, roundRobin, type Slot, type Scheduled } from "../generator";
import { authorizedHomeAssignment, calendarMatchdays, candidateStarts, participationBlocked } from "../constraints";
import { fitsLoanWindow } from "../loan-windows";
import { loadApprovedLoanWindows } from "./loan-windows";

export class SchedulingError extends Error {
  constructor(public code: string, public status = 409) { super(code); }
}
const dateOnly=(d:Date)=>d.toISOString().slice(0,10);
const calendarSchema=z.object({rounds:z.number().int().min(1).max(4),matchDurationMinutes:z.number().int().positive(),complexOnlyFinalRounds:z.number().int().nonnegative().optional(),scheduling:schedulingPolicySchema});

export async function generateSchedule(input:unknown) {
  const actor=await requireOperationalUser();
  return generateScheduleForActor(actor.id,input);
}

/** Solo llamadores de servidor: identidad obtenida de sesión, nunca del formulario. */
export async function generateScheduleForActor(actorId:string,input:unknown) {
  for(let attempt=0;attempt<3;attempt++) {
    try {
      return await getPrisma().$transaction(tx=>generateScheduleInTransaction(tx,actorId,input),
        {isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
    } catch(error) {
      if(!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code!=="P2034") throw error;
      if(attempt===2) throw new SchedulingError("CONCURRENT_CONFIGURATION_CHANGE");
    }
  }
  throw new SchedulingError("CONCURRENT_CONFIGURATION_CHANGE");
}

/** Genera una propuesta de calendario. Aprobar/reservar requiere PDGLD-25. */
export async function generateScheduleInTransaction(tx:Prisma.TransactionClient,actorId:string,raw:unknown) {
  const parsed=generateScheduleSchema.safeParse(raw);
  if(!parsed.success) throw new SchedulingError("INVALID_INPUT",400);
  const input=parsed.data;
  await lockAuthorization(tx);
  await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${input.seasonId}::uuid FOR UPDATE`;
  const grants=await assertPermission(tx,actorId,{module:"scheduling",action:"CREATE",context:{seasonId:input.seasonId}});
  if(!grants.some(g=>!g.clubId)) throw new AuthorizationError();
  const hash=createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const previous=await tx.schedule_proposals.findUnique({where:{id:input.operationId}});
  if(previous) {
    const data=previous.parameters as Record<string,Prisma.JsonValue>;
    if(previous.created_by!==actorId || previous.season_id!==input.seasonId || data.requestHash!==hash) throw new SchedulingError("OPERATION_KEY_REUSED");
    return {ok:true as const,proposalId:previous.id,replayed:true,proposal:previous.parameters};
  }
  const season=await tx.seasons.findUniqueOrThrow({where:{id:input.seasonId},include:{leagues:{select:{timezone:true}}}});
  if(season.status==="CLOSED") throw new SchedulingError("SEASON_CLOSED");
  if(season.version!==input.expectedSeasonVersion) throw new SchedulingError("STALE_CONFIGURATION");
  const group=await tx.groups.findFirst({where:{id:input.groupId,season_id:season.id,season_category_id:input.categoryId},include:{season_categories:true}});
  if(!group) throw new SchedulingError("INVALID_CONTEXT");
  const category=group.season_categories;
  if(!["GENERAL_TABLE","GROUP_STAGE"].includes(category.competition_format)) throw new SchedulingError("FORMAT_NOT_CONFIGURED");
  if(category.competition_format==="GENERAL_TABLE" && (group.name!=="General" || await tx.groups.count({where:{season_category_id:category.id}})!==1)) throw new SchedulingError("INVALID_GENERAL_GROUP");
  if(await tx.season_teams.count({where:{season_category_id:category.id,status:{in:["REGISTERED","ACTIVE"]},group_id:null}})) throw new SchedulingError("DISTRIBUTION_PENDING");
  if(await tx.matches.count({where:{group_id:group.id,deleted_at:null}})) throw new SchedulingError("CALENDAR_ALREADY_EXISTS");
  const rule=await tx.competition_rules.findUniqueOrThrow({where:{id:category.competition_rule_id},include:{competition_rule_parameters:true}});
  const parameter=rule.competition_rule_parameters.find(p=>p.parameter_key==="calendar");
  const config=calendarSchema.safeParse(parameter?.parameter_value);
  if(rule.status!=="APPROVED" || !parameter || parameter.requires_validation || !parameter.validated_by || !config.success) throw new SchedulingError("APPROVED_SCHEDULING_POLICY_REQUIRED");
  const teams=await tx.season_teams.findMany({where:{group_id:group.id,status:{in:["REGISTERED","ACTIVE"]}},include:{teams:{include:{clubs:true}},club_affiliations:true}});
  if(teams.some(t=>t.teams.status!=="ACTIVE" || t.teams.clubs.status!=="ACTIVE" || t.club_affiliations.status!=="APPROVED" || t.season_category_id!==category.id)) throw new SchedulingError("TEAM_NOT_AUTHORIZED");
  for(const team of teams) {
    const authorization=await tx.club_affiliation_categories.findFirst({where:{affiliation_id:team.club_affiliations.id,
      season_id:season.id,category_id:category.category_id,authorized_by:{not:null},authorized_at:{not:null}},select:{category_id:true}});
    if(!authorization) throw new SchedulingError("CATEGORY_NOT_AUTHORIZED");
  }
  if(teams.length<2 || teams.length>64) throw new SchedulingError("INVALID_TEAM_COUNT");
  const calendar=roundRobin(teams.map(t=>t.id),config.data.rounds);
  const loans=await loadApprovedLoanWindows(tx,season.id,[...new Set(teams.map(t=>t.club_id))]);
  const seasonDays=await tx.matchdays.findMany({where:{season_id:season.id},orderBy:{number:"asc"}});
  const count=(teams.length%2?teams.length:teams.length-1)*config.data.rounds;
  const days=calendarMatchdays(seasonDays,count);
  if(!days) throw new SchedulingError("MATCHDAY_COUNT_MISMATCH");
  if(config.data.scheduling.venueStages.some(s=>!seasonDays.some(d=>d.number===s.fromRound)||!seasonDays.some(d=>d.number===s.toRound))) throw new SchedulingError("INVALID_VENUE_STAGE");
  const breaks=await tx.season_breaks.findMany({where:{season_id:season.id}});
  const venues=await tx.venues.findMany({where:{league_id:season.league_id,is_active:true},include:{venue_availability:true,home_venue_assignments:{where:{season_team_id:{in:teams.map(t=>t.id)}},include:{venue_loans:{select:{status:true,season_id:true,club_id:true,venue_id:true,approved_by:true,approved_at:true}}}}}});
  const sanctions=await tx.sanctions.findMany({where:{season_team_id:{in:teams.map(t=>t.id)},blocks_participation:true},select:{season_team_id:true,starts_at:true,ends_at:true}});
  if(config.data.scheduling.venueStages.some(s=>s.venueIds.some(id=>!venues.some(v=>v.id===id)))) throw new SchedulingError("INVALID_STAGE_VENUE");
  const occupied=await tx.matches.findMany({where:{deleted_at:null,match_statuses:{reserves_resources:true},starts_at:{not:null},
    OR:[{venue_id:{in:venues.map(v=>v.id)}},{home_team_id:{in:teams.map(t=>t.id)}},{away_team_id:{in:teams.map(t=>t.id)}}]},
    select:{venue_id:true,starts_at:true,ends_at:true,reserved_until:true,home_team_id:true,away_team_id:true}});
  const busy:Scheduled[]=occupied.filter(m=>m.venue_id&&m.starts_at&&m.ends_at&&m.reserved_until).map(m=>({round:0,home:m.home_team_id,away:m.away_team_id,venueId:m.venue_id!,start:+m.starts_at!,end:+m.ends_at!,reservedUntil:+m.reserved_until!,preference:0}));
  let candidates=0;
  const jobs=calendar.pairings.map(pairing=>{
    const day=days[pairing.round-1], stage=config.data.scheduling.venueStages.find(s=>day.number>=s.fromRound&&day.number<=s.toRound);
    const roundsAfterThis=seasonDays.filter(candidate=>candidate.number>day.number).length;
    const complexOnly=roundsAfterThis<(config.data.complexOnlyFinalRounds ?? 0);
    const slots:Slot[]=[];
    const home=teams.find(t=>t.id===pairing.home)!;
    for(const venue of venues) {
      if(stage&&!stage.venueIds.includes(venue.id)) continue;
      if(complexOnly&&!venue.is_league_sports_complex) continue;
      if(venue.match_duration_minutes!==config.data.matchDurationMinutes) continue;
      const homeLoans=loans.filter(loan=>loan.venueId===venue.id&&loan.clubId===home.club_id);
      const fixedStarts:number[]=homeLoans.flatMap(loan=>loan.windows.map(w=>w.start));
      for(const assignment of venue.home_venue_assignments.filter(a=>a.season_team_id===pairing.home)) {
        const first=Math.max(+day.start_date,+assignment.starts_at),last=Math.min(+day.end_date,+assignment.ends_at);
        for(let at=first;at<=last;at+=86400000) {
          if(++candidates>200000) throw new SchedulingError("CANDIDATE_LIMIT");
          if((new Date(at).getUTCDay()||7)!==assignment.weekday) continue;
          const iso=venueTimeToIso(`${dateOnly(new Date(at))}T${assignment.start_time.toISOString().slice(11,19)}`,season.leagues.timezone);
          if(iso) fixedStarts.push(Date.parse(iso));
        }
      }
      for(const opening of venue.venue_availability.filter(a=>a.type==="AVAILABLE")) {
        const step=config.data.scheduling.slotStepMinutes*60000;
        const lower=Math.max(+opening.starts_at,+day.start_date-86400000);
        const upper=Math.min(+opening.ends_at,+day.end_date+2*86400000);
        for(const start of candidateStarts(+opening.starts_at,lower,upper,step,fixedStarts)) {
          if(++candidates>200000) throw new SchedulingError("CANDIDATE_LIMIT");
          const end=start+venue.match_duration_minutes*60000,reservedUntil=end+venue.buffer_minutes*60000;
          if(reservedUntil>+opening.ends_at) continue;
          if(participationBlocked(sanctions,[pairing.home,pairing.away],start,end)) continue;
          const local=venueLocalTime(new Date(start),season.leagues.timezone), date=local.slice(0,10);
          const finalDate=venueLocalTime(new Date(reservedUntil-1),season.leagues.timezone).slice(0,10);
          if(date<dateOnly(day.start_date)||finalDate>dateOnly(day.end_date)||date<dateOnly(season.start_date)||finalDate>dateOnly(season.end_date)) continue;
          if(breaks.some(b=>date<=dateOnly(b.ends_at)&&finalDate>=dateOnly(b.starts_at))) continue;
          if(venue.venue_availability.some(a=>a.type!=="AVAILABLE"&&overlaps(start,reservedUntil,+a.starts_at,+a.ends_at))) continue;
          const authorizedHome=authorizedHomeAssignment(venue.home_venue_assignments,{
            teamId:home.id,clubId:home.club_id,seasonId:season.id,venueId:venue.id,localStart:local,
            localEnd:venueLocalTime(new Date(reservedUntil-1),season.leagues.timezone)});
          const approvedWindow=homeLoans.some(loan=>fitsLoanWindow(loan.windows,start,reservedUntil));
          if(!venue.is_league_sports_complex&&!approvedWindow) continue;
          slots.push({venueId:venue.id,start,end,reservedUntil,preference:authorizedHome?0:1});
        }
      }
    }
    return {pairing,slots};
  });
  const result=assignSlots(jobs,busy);
  if(!result.ok) return result;
  const usedVenueIds = new Set(result.matches.map(match => match.venueId));
  const proposal={formatVersion:1,requestHash:hash,groupId:group.id,categoryId:category.id,seasonVersion:season.version,
    timezone: season.leagues.timezone,
    venueNames: Object.fromEntries(venues.filter(venue => usedVenueIds.has(venue.id)).map(venue => [venue.id, venue.name])),
    teamNames:Object.fromEntries(teams.map(enrollment=>[enrollment.id,enrollment.teams.name])),
    ruleId:rule.id,ruleVersion:rule.version_number,reason:input.reason,state:"DRAFT_PROPOSAL",reservesResources:false,
    matches:result.matches.map(m=>({...m,matchdayId:days[m.round-1].id,round:days[m.round-1].number,
      start:new Date(m.start).toISOString(),end:new Date(m.end).toISOString(),reservedUntil:new Date(m.reservedUntil).toISOString()})),
    preferenceOptimal:result.preferenceOptimal,
    byes:calendar.byes.map(b=>({...b,matchdayId:days[b.round-1].id,round:days[b.round-1].number}))};
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${input.reason},true)`;
  await tx.schedule_proposals.create({data:{id:input.operationId,season_id:season.id,matchday_id:days[0].id,competition_rule_id:rule.id,created_by:actorId,parameters:proposal,conflicts:[]}});
  return {ok:true as const,proposalId:input.operationId,replayed:false,proposal};
}
