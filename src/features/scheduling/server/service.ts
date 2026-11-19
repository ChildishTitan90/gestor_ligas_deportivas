import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { assertPermission, AuthorizationError, lockAuthorization } from "@/server/auth/authorization";
import { venueTimeToIso } from "@/features/venues/time";
import { generateScheduleSchema, schedulingPolicySchema } from "../schemas";
import { assignSlots, clashes, roundRobin, type Slot, type Scheduled } from "../generator";
import { calendarMatchdays, candidateStarts } from "../constraints";
import { validateSlot } from "../slot-validation";
import { validateScheduleStructure } from "../structure-validation";
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
        {isolationLevel:Prisma.TransactionIsolationLevel.Serializable,maxWait:10000,timeout:30000});
    } catch(error) {
      if(!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code!=="P2034") throw error;
      if(attempt===2) throw new SchedulingError("CONCURRENT_CONFIGURATION_CHANGE");
    }
  }
  throw new SchedulingError("CONCURRENT_CONFIGURATION_CHANGE");
}

/** Carga reglas y recursos vigentes para generación y validación; el llamador autoriza y bloquea la temporada. */
async function loadScheduleContext(tx:Prisma.TransactionClient,input:{seasonId:string;categoryId:string;groupId:string;expectedSeasonVersion:number}) {
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
  return {season,group,rule,config:config.data,teams,calendar,loans,seasonDays,days,breaks,venues,sanctions,busy};
}

const editedMatchSchema=z.strictObject({round:z.number().int().positive(),matchdayId:z.uuid(),home:z.uuid(),away:z.uuid(),
  venueId:z.uuid(),start:z.iso.datetime()});
const validationSchema=z.strictObject({proposalId:z.uuid(),expectedSeasonVersion:z.number().int().positive(),
  matches:z.array(editedMatchSchema).min(1).max(1024)});
type ScheduleContext=Awaited<ReturnType<typeof loadScheduleContext>>;
type EditedMatch=z.infer<typeof editedMatchSchema>;

/** Evalúa la propuesta completa usando recursos actuales; no escribe ni reserva. */
function validateSchedule(context:ScheduleContext,matches:EditedMatch[]) {
  const {season,config,teams,seasonDays,days,venues,sanctions,breaks,loans,busy}=context;
  const structure=validateScheduleStructure(teams.map(team=>team.id),days,config.rounds,matches);
  if(!structure.ok) return {ok:false as const,code:structure.code,conflicts:[]};
  const checked:Scheduled[]=[];
  const conflicts:{round:number;home:string;away:string;code:string}[]=[];
  for(const match of matches) {
    const day=days.find(value=>value.id===match.matchdayId)!;
    const venue=venues.find(value=>value.id===match.venueId);
    const home=teams.find(value=>value.id===match.home)!;
    if(!venue) {conflicts.push({...match,code:"INVALID_VENUE"});continue;}
    const stage=config.scheduling.venueStages.find(value=>day.number>=value.fromRound&&day.number<=value.toRound);
    const windows=loans.filter(loan=>loan.venueId===venue.id&&loan.clubId===home.club_id).flatMap(loan=>loan.windows);
    const slot=validateSlot({seasonId:season.id,timezone:season.leagues.timezone,seasonStart:season.start_date,seasonEnd:season.end_date,
      day,home:match.home,away:match.away,homeClub:home.club_id,matchDurationMinutes:config.matchDurationMinutes,
      complexOnly:seasonDays.filter(candidate=>candidate.number>day.number).length<(config.complexOnlyFinalRounds??0),
      allowedVenueIds:stage?.venueIds,breaks,sanctions,venue,loanWindows:windows},Date.parse(match.start));
    if(!slot.ok) {conflicts.push({...match,code:slot.factor});continue;}
    const scheduled={round:match.round,home:match.home,away:match.away,...slot.slot};
    if(busy.some(other=>clashes(scheduled,other))||checked.some(other=>clashes(scheduled,other))) {
      conflicts.push({...match,code:"SLOT_CONFLICT"});continue;
    }
    checked.push(scheduled);
  }
  if(conflicts.length) return {ok:false as const,code:"INVALID_SCHEDULE",conflicts};
  return {ok:true as const,matches:checked.map(match=>({...match,matchdayId:days.find(day=>day.number===match.round)!.id,
    start:new Date(match.start).toISOString(),end:new Date(match.end).toISOString(),reservedUntil:new Date(match.reservedUntil).toISOString()})),byes:structure.byes};
}

/**
 * Solo servidor. Debe llamarse dentro de la misma transacción SERIALIZABLE que
 * comprueba la versión de edición y guarda el ajuste. No escribe por sí sola.
 */
export async function validateScheduleProposalInTransaction(tx:Prisma.TransactionClient,actorId:string,raw:unknown,action:"UPDATE"|"APPROVE"="UPDATE") {
  const parsed=validationSchema.safeParse(raw);
  if(!parsed.success) throw new SchedulingError("INVALID_INPUT",400);
  const input=parsed.data;
  const isolation=await tx.$queryRaw<{level:string}[]>`SELECT current_setting('transaction_isolation') AS level`;
  if(isolation[0]?.level!=="serializable") throw new SchedulingError("SERIALIZABLE_TRANSACTION_REQUIRED");
  await lockAuthorization(tx);
  const lookup=await tx.schedule_proposals.findUnique({where:{id:input.proposalId},select:{season_id:true}});
  if(!lookup) throw new AuthorizationError();
  await tx.$queryRaw`SELECT id FROM sports_management.seasons WHERE id=${lookup.season_id}::uuid FOR UPDATE`;
  const grants=await assertPermission(tx,actorId,{module:"scheduling",action,context:{seasonId:lookup.season_id}});
  if(!grants.some(grant=>!grant.clubId)) throw new AuthorizationError();
  await tx.$queryRaw`SELECT id FROM sports_management.schedule_proposals WHERE id=${input.proposalId}::uuid FOR UPDATE`;
  const stored=await tx.schedule_proposals.findUniqueOrThrow({where:{id:input.proposalId},select:{season_id:true,parameters:true}});
  const meta=z.object({formatVersion:z.literal(1),groupId:z.uuid(),categoryId:z.uuid(),seasonVersion:z.number().int().positive(),state:z.literal("DRAFT_PROPOSAL"),
    matches:z.array(z.object({round:z.number().int().positive(),matchdayId:z.uuid(),home:z.uuid(),away:z.uuid()})).min(1).max(1024)}).safeParse(stored.parameters);
  if(!meta.success) throw new SchedulingError("INVALID_PROPOSAL");
  if(meta.data.seasonVersion!==input.expectedSeasonVersion) throw new SchedulingError("STALE_CONFIGURATION");
  // PDGLD-25 cambia localía, cancha y horario; mover jornadas o sustituir
  // equipos requiere un contrato específico y no debe hacerse implícitamente.
  const matchKey=(match:{round:number;matchdayId:string;home:string;away:string})=>
    `${match.round}/${match.matchdayId}/${[match.home,match.away].sort().join("/")}`;
  const storedKeys=meta.data.matches.map(matchKey).sort(), submittedKeys=input.matches.map(matchKey).sort();
  if(storedKeys.length!==submittedKeys.length || storedKeys.some((key,index)=>key!==submittedKeys[index]))
    return {ok:false as const,code:"MATCHUP_CHANGE_NOT_ALLOWED",conflicts:[]};
  const context=await loadScheduleContext(tx,{seasonId:stored.season_id,categoryId:meta.data.categoryId,
    groupId:meta.data.groupId,expectedSeasonVersion:input.expectedSeasonVersion});
  return validateSchedule(context,input.matches);
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
  const context=await loadScheduleContext(tx,input);
  const {season,group,rule,config,teams,calendar,loans,seasonDays,days,breaks,venues,sanctions,busy}=context;
  let candidates=0;
  const jobs=calendar.pairings.map(pairing=>{
    const day=days[pairing.round-1], stage=config.scheduling.venueStages.find(s=>day.number>=s.fromRound&&day.number<=s.toRound);
    const roundsAfterThis=seasonDays.filter(candidate=>candidate.number>day.number).length;
    const complexOnly=roundsAfterThis<(config.complexOnlyFinalRounds ?? 0);
    const slots:Slot[]=[];
    const factors=new Set<string>();
    let sawTimeCandidate=false;
    const home=teams.find(t=>t.id===pairing.home)!;
    for(const venue of venues) {
      if(stage&&!stage.venueIds.includes(venue.id)) { factors.add("VENUE_STAGE"); continue; }
      if(complexOnly&&!venue.is_league_sports_complex) { factors.add("FINAL_ROUNDS"); continue; }
      if(venue.match_duration_minutes!==config.matchDurationMinutes) { factors.add("DURATION"); continue; }
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
        const step=config.scheduling.slotStepMinutes*60000;
        const lower=Math.max(+opening.starts_at,+day.start_date-86400000);
        const upper=Math.min(+opening.ends_at,+day.end_date+2*86400000);
        for(const start of candidateStarts(+opening.starts_at,lower,upper,step,fixedStarts)) {
          if(++candidates>200000) throw new SchedulingError("CANDIDATE_LIMIT");
          const checked=validateSlot({seasonId:season.id,timezone:season.leagues.timezone,seasonStart:season.start_date,seasonEnd:season.end_date,
            day,home:pairing.home,away:pairing.away,homeClub:home.club_id,matchDurationMinutes:config.matchDurationMinutes,
            complexOnly,allowedVenueIds:stage?.venueIds,breaks,sanctions,venue,loanWindows:homeLoans.flatMap(loan=>loan.windows)},start);
          if(!checked.ok) { if(checked.factor!=="NO_OPENING") { sawTimeCandidate=true; factors.add(checked.factor); } continue; }
          sawTimeCandidate=true;
          slots.push(checked.slot);
        }
      }
    }
    if(!sawTimeCandidate) factors.add("NO_OPENING");
    return {pairing,slots,factors:[...factors]};
  });
  const result=assignSlots(jobs,busy);
  if(!result.ok) {
    if(result.code!=="NO_AVAILABLE_SLOT") return result;
    return {...result, conflicts:result.conflicts.map(pairing=>{
      const job=jobs.find(j=>j.pairing.round===pairing.round&&j.pairing.home===pairing.home&&j.pairing.away===pairing.away)!;
      return {...pairing, factors:job.slots.length ? ["OCCUPIED"] : job.factors};
    })};
  }
  const validated=validateSchedule(context,result.matches.map(match=>({round:days[match.round-1].number,matchdayId:days[match.round-1].id,
    home:match.home,away:match.away,venueId:match.venueId,start:new Date(match.start).toISOString()})));
  if(!validated.ok) return validated;
  const usedVenueIds = new Set(validated.matches.map(match => match.venueId));
  const proposal={formatVersion:1,requestHash:hash,groupId:group.id,categoryId:group.season_category_id,seasonVersion:season.version,
    timezone: season.leagues.timezone,
    venueNames: Object.fromEntries(venues.filter(venue => usedVenueIds.has(venue.id)).map(venue => [venue.id, venue.name])),
    teamNames:Object.fromEntries(teams.map(enrollment=>[enrollment.id,enrollment.teams.name])),
    ruleId:rule.id,ruleVersion:rule.version_number,reason:input.reason,state:"DRAFT_PROPOSAL",reservesResources:false,
    matches:validated.matches,
    preferenceOptimal:result.preferenceOptimal,
    byes:validated.byes};
  await tx.$queryRaw`SELECT set_config('app.user_id',${actorId},true),set_config('app.reason',${input.reason},true)`;
  await tx.schedule_proposals.create({data:{id:input.operationId,season_id:season.id,matchday_id:days[0].id,competition_rule_id:rule.id,created_by:actorId,parameters:proposal,conflicts:[]}});
  return {ok:true as const,proposalId:input.operationId,replayed:false,proposal};
}
