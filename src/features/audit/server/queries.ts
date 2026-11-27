import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getPrisma } from "@/server/db/prisma";
import { requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError, getPermissionGrants } from "@/server/auth/authorization";
import { venueTimeToIso } from "@/features/venues/time";
import { auditFiltersSchema, auditEntities, type AuditFilters, type AuditEntry, type AuditWorkspace } from "../contract";
import { actionLabel, actorLabel, projectChanges, reasonLabel, visibleText } from "../projection";

export class AuditInputError extends Error {
  readonly status = 400;
  constructor(readonly code: "INVALID_FILTERS" | "INVALID_CURSOR") { super(code); }
}

// Solo expresiones constantes del servidor. Nunca interpolar nombres enviados por el cliente.
const sources: { table: keyof typeof auditEntities; joins: string; league: string; name: string; refs: Record<string, string> }[] = [
  { table:"users", joins:"JOIN sports_management.users r ON r.id=a.entity_id", league:"NULL::uuid", name:"r.username", refs:{} },
  { table:"clubs", joins:"JOIN sports_management.clubs r ON r.id=a.entity_id", league:"r.league_id", name:"r.name", refs:{league_id:"r.league_id"} },
  { table:"teams", joins:"JOIN sports_management.teams r ON r.id=a.entity_id JOIN sports_management.clubs c ON c.id=r.club_id", league:"c.league_id", name:"r.name", refs:{club_id:"r.club_id",league_id:"c.league_id"} },
  { table:"leagues", joins:"JOIN sports_management.leagues r ON r.id=a.entity_id", league:"r.id", name:"r.name", refs:{league_id:"r.id"} },
  { table:"seasons", joins:"JOIN sports_management.seasons r ON r.id=a.entity_id", league:"r.league_id", name:"r.name", refs:{league_id:"r.league_id"} },
  { table:"club_affiliations", joins:"JOIN sports_management.club_affiliations r ON r.id=a.entity_id JOIN sports_management.clubs c ON c.id=r.club_id", league:"r.league_id", name:"c.name", refs:{league_id:"r.league_id",season_id:"r.season_id",club_id:"r.club_id"} },
  { table:"player_registrations", joins:"JOIN sports_management.player_registrations r ON r.id=a.entity_id JOIN sports_management.seasons s ON s.id=r.season_id", league:"s.league_id", name:"NULL::text", refs:{league_id:"s.league_id",season_id:"r.season_id",season_team_id:"r.season_team_id"} },
  { table:"player_identity_corrections", joins:"JOIN sports_management.player_identity_corrections r ON r.id=a.entity_id JOIN sports_management.player_registrations p ON p.id=r.registration_id JOIN sports_management.seasons s ON s.id=p.season_id", league:"s.league_id", name:"NULL::text", refs:{league_id:"s.league_id",registration_id:"r.registration_id",season_id:"p.season_id"} },
  ...(["schedule_proposals","matches","disciplinary_cases","charges"] as const).map(table => ({ table,
    joins:`JOIN sports_management.${table} r ON r.id=a.entity_id JOIN sports_management.seasons s ON s.id=r.season_id`,
    league:"s.league_id",name:"NULL::text",refs:{league_id:"s.league_id",season_id:"r.season_id"} })),
  { table:"match_results", joins:"JOIN sports_management.match_results r ON r.id=a.entity_id JOIN sports_management.matches m ON m.id=r.match_id JOIN sports_management.seasons s ON s.id=m.season_id", league:"s.league_id", name:"NULL::text", refs:{league_id:"s.league_id",match_id:"r.match_id",season_id:"m.season_id"} },
  { table:"sanctions", joins:"JOIN sports_management.sanctions r ON r.id=a.entity_id JOIN sports_management.disciplinary_rulings d ON d.id=r.ruling_id JOIN sports_management.disciplinary_cases c ON c.id=d.case_id JOIN sports_management.seasons s ON s.id=c.season_id", league:"s.league_id", name:"NULL::text", refs:{league_id:"s.league_id",ruling_id:"r.ruling_id",season_id:"s.id"} },
  { table:"team_withdrawals", joins:"JOIN sports_management.team_withdrawals r ON r.id=a.entity_id JOIN sports_management.season_teams t ON t.id=r.season_team_id JOIN sports_management.seasons s ON s.id=t.season_id", league:"s.league_id", name:"NULL::text", refs:{league_id:"s.league_id",season_team_id:"r.season_team_id",season_id:"t.season_id"} },
];

function eventSources() {
  return Prisma.join(sources.map(source => {
    const checks = Object.entries(source.refs).flatMap(([key, expression]) => {
      const camel = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
      return [...new Set([key, camel])].flatMap(name => ["previous_data", "new_data"].map(column =>
        Prisma.sql`(a.${Prisma.raw(column)}->>${name} IS NULL OR a.${Prisma.raw(column)}->>${name} = (${Prisma.raw(expression)})::text)`));
    });
    if(source.table==="clubs" || source.table==="seasons") {
      checks.push(Prisma.sql`COALESCE(a.previous_data->>'league_id',a.previous_data->>'leagueId',a.new_data->>'league_id',a.new_data->>'leagueId') IS NOT NULL`);
    }
    // Un padre transferido no convierte su historial anterior en historia de la nueva liga.
    for(const [table,alias] of [["clubs","c"],["seasons","s"]] as const) {
      if(!source.joins.includes(`sports_management.${table} ${alias} `))continue;
      checks.push(Prisma.sql`NOT EXISTS(SELECT 1 FROM sports_management.audit_logs h
        WHERE h.table_name=${table} AND h.entity_id=${Prisma.raw(`${alias}.id`)} AND (
          (h.previous_data->>'league_id' IS NOT NULL AND h.previous_data->>'league_id'<>${Prisma.raw(`${alias}.league_id`)}::text)
          OR (h.new_data->>'league_id' IS NOT NULL AND h.new_data->>'league_id'<>${Prisma.raw(`${alias}.league_id`)}::text)))`);
    }
    return Prisma.sql`SELECT a.id,a.user_id,a.occurred_at,a.action,a.table_name,a.entity_id,a.previous_data,a.new_data,a.reason,
      ${Prisma.raw(source.league)} AS league_id, ${Prisma.raw(source.name)} AS entity_name
      FROM sports_management.audit_logs a ${Prisma.raw(source.joins)}
      WHERE a.table_name=${source.table} ${checks.length ? Prisma.sql`AND ${Prisma.join(checks, " AND ")}` : Prisma.empty}`;
  }), " UNION ALL ");
}

async function access(tx: Prisma.TransactionClient, actorId: string) {
  const grants = await getPermissionGrants(tx, actorId, "audit", "READ");
  const global = grants.some(grant => !grant.clubId && !grant.leagueId && !grant.contextOnly);
  const leagues = [...new Set(grants.flatMap(grant => !grant.clubId && grant.leagueId ? [grant.leagueId] : []))];
  if (!global && !leagues.length) throw new AuthorizationError();
  return { global, leagues };
}
type Access = Awaited<ReturnType<typeof access>>;
function visibleScope(rights: Access) {
  return rights.global ? Prisma.sql`TRUE` : Prisma.sql`e.league_id IN (${Prisma.join(rights.leagues.map(id => Prisma.sql`${id}::uuid`))})`;
}

type Row = {
  id:string; at:string; username:string|null; action:string; table_name:keyof typeof auditEntities;
  entity_name:string|null; entity_reference:string; reason:string; league_id:string|null; league_name:string|null; timezone:string|null;
  previous_data?:unknown; new_data?:unknown;
};
const selectFields = Prisma.sql`e.id, to_char(e.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at,
  u.username, e.action, e.table_name, e.entity_name, e.entity_id AS entity_reference, e.reason, e.league_id, l.name AS league_name,
  l.timezone`;
function entry(row: Row): AuditEntry {
  return { id:row.id, at:row.at, actor:actorLabel(row.username), action:actionLabel(row.action),
    entity:auditEntities[row.table_name], name:visibleText(row.entity_name,auditEntities[row.table_name]),
    scope:row.league_id ? visibleText(row.league_name,"Liga") : "Actividad general",
    timezone:row.timezone ?? "America/Mexico_City", reason:reasonLabel(row.table_name,row.action,row.reason),
    reference:row.entity_reference,
  };
}

const cursorSchema = z.strictObject({ at:z.iso.datetime(), id:z.uuid(), upperAt:z.iso.datetime(), upperId:z.uuid(), binding:z.string().regex(/^[a-f0-9]{64}$/) });
function cursor(value: string | undefined, binding: string) {
  if (!value) return null;
  try {
    const bytes=Buffer.from(value,"base64url");
    if(bytes.toString("base64url")!==value) throw Error();
    const result=cursorSchema.parse(JSON.parse(bytes.toString("utf8")));
    if(result.binding!==binding) throw Error();
    return result;
  } catch { throw new AuditInputError("INVALID_CURSOR"); }
}
export function parseAuditFilters(input: unknown): AuditFilters {
  const parsed=auditFiltersSchema.safeParse(input);
  if(!parsed.success) throw new AuditInputError("INVALID_FILTERS");
  return parsed.data;
}

export async function canReadAudit() {
  const actor=await requireOperationalUser();
  return getPrisma().$transaction(async tx=>{ await access(tx,actor.id); return true; });
}
export async function getAuditWorkspace(input: unknown) {
  return getAuditWorkspaceForActor((await requireOperationalUser()).id,input);
}
/** Identidad proporcionada exclusivamente por llamadores de servidor. */
export async function getAuditWorkspaceForActor(actorId: string, input: unknown): Promise<AuditWorkspace> {
  return getPrisma().$transaction(tx=>getAuditWorkspaceInTransaction(tx,actorId,input),
    {isolationLevel:"RepeatableRead",maxWait:10000,timeout:20000});
}
/** Lectura compartida para llamadas autorizadas que ya disponen de una transacción. */
export async function getAuditWorkspaceInTransaction(tx: Prisma.TransactionClient, actorId:string, input:unknown): Promise<AuditWorkspace> {
  const filters=parseAuditFilters(input);
    const rights=await access(tx,actorId);
    const leagues=await tx.leagues.findMany({where:rights.global?{}:{id:{in:rights.leagues}},select:{id:true,name:true,timezone:true},orderBy:{name:"asc"}});
    const scopes=[...(rights.global?[{value:"general",label:"Actividad general de cuentas",timezone:"America/Mexico_City"}]:[]),
      ...leagues.map(league=>({value:league.id,label:visibleText(league.name,"Liga"),timezone:league.timezone}))];
    const selected=scopes.find(scope=>scope.value===(filters.scope ?? (scopes.length===1?scopes[0].value:undefined))) ?? null;
    if(filters.scope && !selected) throw new AuthorizationError();
    if(!selected) return {filters,scopes,selected,entries:[],next:null};
    filters.scope=selected.value;
    const binding=createHash("sha256").update(JSON.stringify([actorId,filters.scope,filters.entity,filters.actor,filters.from,filters.to])).digest("hex");
    const page=cursor(filters.after,binding);
    const conditions: Prisma.Sql[]=[visibleScope(rights),selected.value==="general"?Prisma.sql`e.league_id IS NULL`:Prisma.sql`e.league_id=${selected.value}::uuid`];
    if(filters.entity) conditions.push(Prisma.sql`e.table_name=${filters.entity}`);
    if(filters.actor) conditions.push(Prisma.sql`lower(u.username)=lower(${filters.actor})`);
    if(filters.from) {
      const start=venueTimeToIso(`${filters.from}T00:00`,selected.timezone);
      if(!start) throw new AuditInputError("INVALID_FILTERS");
      conditions.push(Prisma.sql`e.occurred_at>=${start}::timestamptz`);
    }
    if(filters.to) {
      const nextDate=new Date(Date.parse(`${filters.to}T00:00:00Z`)+86400000).toISOString().slice(0,10);
      const end=venueTimeToIso(`${nextDate}T00:00`,selected.timezone);
      if(!end) throw new AuditInputError("INVALID_FILTERS");
      conditions.push(Prisma.sql`e.occurred_at<${end}::timestamptz`);
    }
    if(page) conditions.push(Prisma.sql`(e.occurred_at,e.id)<(${page.at}::timestamptz,${page.id}::uuid)
      AND (e.occurred_at,e.id)<=(${page.upperAt}::timestamptz,${page.upperId}::uuid)`);
    const rows=await tx.$queryRaw<Row[]>(Prisma.sql`WITH events AS (${eventSources()})
      SELECT ${selectFields} FROM events e LEFT JOIN sports_management.users u ON u.id=e.user_id
      LEFT JOIN sports_management.leagues l ON l.id=e.league_id
      WHERE ${Prisma.join(conditions," AND ")} ORDER BY e.occurred_at DESC,e.id DESC LIMIT 26`);
    const items=rows.slice(0,25), last=items.at(-1), upper=rows[0];
    const next=rows.length>25 && last ? Buffer.from(JSON.stringify({at:last.at,id:last.id,upperAt:page?.upperAt??upper.at,upperId:page?.upperId??upper.id,binding})).toString("base64url"):null;
    return {filters,scopes,selected,entries:items.map(entry),next};
}
export async function getAuditDetail(id: string) { return getAuditDetailForActor((await requireOperationalUser()).id,id); }
export async function getAuditDetailForActor(actorId: string, id: string) {
  if(!z.uuid().safeParse(id).success) throw new AuthorizationError();
  return getPrisma().$transaction(async tx => {
    const rights=await access(tx,actorId);
    const rows=await tx.$queryRaw<Row[]>(Prisma.sql`WITH events AS (${eventSources()})
      SELECT ${selectFields}, e.previous_data, e.new_data FROM events e LEFT JOIN sports_management.users u ON u.id=e.user_id
      LEFT JOIN sports_management.leagues l ON l.id=e.league_id
      WHERE e.id=${id}::uuid AND ${visibleScope(rights)}`);
    if(!rows.length) throw new AuthorizationError();
    const row=rows[0];
    return {...entry(row),changes:projectChanges(row.table_name,row.previous_data,row.new_data)};
  },{isolationLevel:"RepeatableRead",maxWait:10000,timeout:20000});
}
