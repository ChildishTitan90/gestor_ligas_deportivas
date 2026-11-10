"use client";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { SelectField } from "@/components/ui/select-field";
import { FormDialog } from "@/components/ui/form-dialog";
import { focusFormControl } from "@/components/ui/focus-form-control";
import { registerPlayerSchema, jerseyNumberFromField } from "../schemas";
import { playerRequest, PlayerRequestError, playerListSchema, playerResultSchema } from "../player-client";
import {describeAdmissionRule} from "../age-exception";
import { playerErrorMessages } from "../player-feedback";
import type { PlayerListItem, PlayerTeamOption } from "../types";
import { CurpVerificationPanel } from "./curp-verification-panel";
import Link from "next/link";

export function PlayerRegistrationWorkspace({ actorId, teams, initialPlayers=[],providerConfigured, fetcher = fetch }: {
  actorId: string; teams: readonly PlayerTeamOption[]; initialPlayers?:PlayerListItem[];providerConfigured: boolean; fetcher?: typeof fetch;
}) {
  const prefix = useId();
  const form = useRef<HTMLFormElement>(null);
  const lock = useRef(false);
  const pending = useRef<unknown>(null);
  const [clubId, setClubId] = useState("");
  const [seasonId, setSeasonId] = useState("");
  const [teamId, setTeamId] = useState("");
  const [phase, setPhase] = useState<"editing" | "sending" | "uncertain" | "confirmed" | "checking">("editing");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [listMessage, setListMessage] = useState("");
  const [rows, setRows] = useState<PlayerListItem[]>(initialPlayers);
  const [search,setSearch]=useState("");
  const [listTeam,setListTeam]=useState("");
  const [selectedRecord, setSelectedRecord] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [registrationOpen,setRegistrationOpen]=useState(false);
  const [dirty,setDirty]=useState(false);
  const [requestAgeException,setRequestAgeException]=useState(false);
  const team = teams.find(option => option.id === teamId);
  const clubs = [...new Map(teams.map(option => [option.clubId, { value: option.clubId, label: option.clubName }])).values()];
  const seasons = [...new Map(teams.filter(option => option.clubId === clubId).map(option => [option.seasonId, { value: option.seasonId, label: option.seasonName }])).values()];
  const availableTeams = teams.filter(option => option.clubId === clubId && option.seasonId === seasonId);
  const frozen = phase !== "editing";

  useEffect(() => {
    let active = true;
    playerRequest(actorId, "/api/player-registrations", undefined, fetcher).then(value => {
      const parsed = playerListSchema.safeParse(value);
      if (!active) return;
      if (!parsed.success) { setListMessage("No se pudo confirmar el listado. Intenta actualizarlo."); return; }
      setRows(parsed.data); setListMessage(parsed.data.length ? "" : "Todavía no hay jugadores registrados en tus equipos.");
    }).catch(error => { if (active) setListMessage(error instanceof PlayerRequestError ? playerErrorMessages[error.code] ?? "No se pudo cargar el listado." : "No se pudo cargar el listado."); });
    return () => { active = false; };
  }, [actorId, refresh, fetcher]);
  useEffect(() => {
    if (!["sending", "uncertain", "checking"].includes(phase)) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  async function send() {
    if (lock.current || !pending.current) return;
    lock.current = true; setPhase("sending"); setMessage("");
    try {
      const parsed = playerResultSchema.safeParse(await playerRequest(actorId, "/api/player-registrations", pending.current, fetcher));
      if (!parsed.success) throw new PlayerRequestError("UNCONFIRMED", true);
      setPhase("confirmed"); setSelectedRecord(parsed.data.registrationId); setRefresh(value => value + 1);
      setMessage(parsed.data.ageExceptionPending?"Captura recibida sin habilitación. Abre el expediente, carga la carta de excepción y presenta la petición a Secretaría.":parsed.data.status==="ACTIVE"?"Jugador registrado y activo. Puedes abrir su expediente para completar los documentos.":parsed.data.identityReviewStatus === "REQUIRED" ? "Registro recibido. Requiere revisión de identidad por Secretaría antes de aprobarse."
        : parsed.data.curpVerification==="VERIFIED"?"CURP verificada. Completa los requisitos de su categoría en el expediente.":"Jugador registrado. La verificación de CURP sigue pendiente; consulta su estado sin volver a registrar al jugador.");
    } catch (error) {
      if (error instanceof PlayerRequestError && !error.uncertain) {
        pending.current = null; setPhase("editing"); setMessage((playerErrorMessages[error.code] ?? "No se pudo registrar. Revisa los datos e intenta nuevamente.")+(error.rule?" "+describeAdmissionRule(error.rule):""));
      } else { setPhase("uncertain"); setMessage("No se recibió una respuesta confirmada. Conservamos este envío en la pantalla; consulta su resultado antes de reintentar."); }
    } finally { lock.current = false; }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || frozen) return;
    const data = new FormData(event.currentTarget);
    const parsed = registerPlayerSchema.safeParse({ seasonTeamId: teamId, requestAgeException, jerseyNumber: jerseyNumberFromField(data.get("jerseyNumber")), identity: {
      curp: data.get("curp"), firstName: data.get("firstName"), paternalSurname: data.get("paternalSurname"),
      maternalSurname: data.get("maternalSurname"), birthDate: data.get("birthDate"),
    } });
    if (!parsed.success) {
      const nextErrors = Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path.at(-1)), issue.message]));
      setErrors(nextErrors); setMessage("Revisa los campos señalados.");
      focusFormControl(event.currentTarget, String(parsed.error.issues[0].path.at(-1))); return;
    }
    setErrors({}); pending.current = parsed.data; await send();
  }
  async function recover() {
    if (lock.current || !pending.current) return;
    lock.current = true; setPhase("checking");
    try {
      const result = z.object({ status: z.enum(["CONFIRMED", "UNRESOLVED"]), registrationId: z.uuid().optional() })
        .parse(await playerRequest(actorId, "/api/player-registrations/recover", pending.current, fetcher));
      if (result.status === "CONFIRMED" && result.registrationId) {
        setPhase("confirmed"); setSelectedRecord(result.registrationId); setRefresh(value => value + 1);
        setMessage("Registro confirmado en el servidor. No se volvió a enviar el alta.");
      } else { setPhase("uncertain"); setMessage("Todavía no hay un registro confirmado. Puedes consultar nuevamente o reintentar el mismo envío."); }
    } catch (error) { setPhase("uncertain"); setMessage(error instanceof PlayerRequestError ? playerErrorMessages[error.code] ?? "No se pudo confirmar el resultado. Conserva el mismo envío." : "No se pudo confirmar el resultado."); }
    finally { lock.current = false; }
  }

  const inputClass = "mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-base text-foreground disabled:opacity-60";
  const secondary = "min-h-12 rounded-xl border border-border bg-surface px-4 py-3 font-semibold text-primary disabled:opacity-50";
  function resetRegistration(){pending.current=null;setPhase("editing");setMessage("");setErrors({});form.current?.reset();setClubId("");setSeasonId("");setTeamId("");setDirty(false);setRequestAgeException(false);}
  function closeRegistration(reason:"dismiss"|"discard"){
    if(lock.current)return;
    if(reason==="discard")resetRegistration();
    setRegistrationOpen(false);
  }
  function field(name: string, label: string, type = "text", required = true) {
    return <div><label htmlFor={`${prefix}-${name}`} className="text-sm font-medium">{label}{required ? " *" : ""}</label>
      <input id={`${prefix}-${name}`} name={name} type={type} min={type === "number" ? 0 : undefined} step={type === "number" ? 1 : undefined} required={required} autoComplete="off" maxLength={name === "curp" ? 18 : type === "text" ? 120 : undefined}
        aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `${prefix}-${name}-error` : undefined} className={inputClass} />
      {errors[name] && <p id={`${prefix}-${name}-error`} className="mt-2 text-sm text-danger">{errors[name]}</p>}</div>;
  }
  const normalized=(text:string)=>text.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const visibleRows=rows.filter(r=>(!listTeam || r.seasonTeamId===listTeam) && normalized([r.displayName,r.teamName,r.clubName,r.seasonName].join(" ")).includes(normalized(search.trim())));
  const directoryTeams=[...new Map(rows.filter(r=>r.seasonTeamId).map(r=>[r.seasonTeamId!,{value:r.seasonTeamId!,label:[r.teamName,r.seasonName].filter(Boolean).join(" · ")}])).values()];
  return <div className="space-y-8">
    <section className="space-y-4" aria-label="Mis jugadores"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-semibold text-primary">Mis jugadores</h2><div className="flex flex-wrap gap-3"><button type="button" onClick={() => setRefresh(value => value + 1)} className={secondary}>Actualizar listado</button>{teams.length>0 && <button type="button" onClick={()=>{if(phase==="confirmed")resetRegistration();setRegistrationOpen(true);}} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold">{phase==="uncertain"?"Continuar registro pendiente":"Registrar jugador"}</button>}</div></div>
      <div className="grid items-start gap-4 sm:grid-cols-2"><div><label htmlFor={`${prefix}-search`} className="block text-sm font-medium">Buscar jugador, club o temporada</label><input id={`${prefix}-search`} type="search" value={search} onChange={e=>setSearch(e.target.value)} className={inputClass}/></div><div><label htmlFor={`${prefix}-list-team`} className="block text-sm font-medium">Filtrar por equipo</label><div className="mt-2"><SelectField id={`${prefix}-list-team`} value={listTeam} onValueChange={setListTeam} options={[{value:"",label:"Todos mis equipos"},...directoryTeams]}/></div></div></div>
      {listMessage && <p role="status" className="rounded-xl border border-border bg-surface p-4">{listMessage}</p>}
      {!listMessage && !visibleRows.length && <p role="status">{rows.length?"No hay jugadores que coincidan con la búsqueda.":"Todavía no hay jugadores registrados en tus equipos."}</p>}
      <ul className="grid gap-3">{visibleRows.map(row=><li key={row.registrationId} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-surface p-4"><div><p className="font-semibold">{row.displayName}</p><p className="text-sm">Dorsal habitual: {row.jerseyNumber ?? "Sin asignar"}</p><p className="text-sm text-muted">{[row.clubName,row.teamName,row.seasonName].filter(Boolean).join(" · ")}</p><p className="text-sm">{row.status==="ACTIVE"?"Activo":row.status==="INELIGIBLE"?"Pendiente de habilitación":row.status==="WITHDRAWN"?"Baja registrada":"Suspendido"}{row.identityReviewStatus==="REQUIRED"?" · Revisión de identidad pendiente":""}</p></div><div className="flex flex-wrap gap-3"><Link href={`/players/registrations/${row.registrationId}/documents`} className={secondary}>Abrir expediente</Link><Link href={`/players/registrations/${row.registrationId}/participations`} className="min-h-12 rounded-xl border border-border px-4 py-3 font-semibold">Participaciones</Link><button type="button" onClick={()=>setSelectedRecord(row.registrationId)} className={secondary}>Estado de CURP</button></div></li>)}</ul>
    </section>
    {!teams.length && <div className="rounded-2xl border border-border bg-surface p-6 space-y-4">
    <h2 className="text-xl font-semibold text-primary">Todavía no hay equipos disponibles para registrar jugadores</h2>
    <p className="leading-7">Primero debe aprobarse la afiliación del club y su categoría en la temporada. Después inscribe al equipo. Una afiliación en correcciones todavía no permite altas de jugadores.</p>
    <div className="flex flex-wrap gap-3"><a href="/affiliations/new" className={secondary}>Mis solicitudes de afiliación</a><a href="/teams/registrations" className={secondary}>Inscripción de equipos</a></div>
  </div>}
    {teams.length>0 && <FormDialog open={registrationOpen} title="Registrar jugador" description="Captura los datos del jugador para inscribirlo en un equipo autorizado." dirty={dirty && phase==="editing"} pending={phase==="sending" || phase==="checking"} uncertain={phase==="uncertain"} onClose={closeRegistration}><form ref={form} onSubmit={submit} onChange={()=>setDirty(true)} noValidate className="space-y-6" aria-label="Registrar jugador">
      <p className="text-sm leading-6 text-muted">Solo se muestran equipos con afiliación y categoría aprobadas. El registro ordinario verifica la CURP y su coincidencia con los datos del jugador. La captura para una excepción queda pendiente de revisión y no inicia esa consulta. Los documentos adicionales dependen de su edad y categoría.</p>
      <fieldset disabled={frozen} className="grid gap-5 sm:grid-cols-2">
        <legend className="sr-only">Equipo e identidad del jugador</legend>
        <div><label htmlFor={`${prefix}-club`} className="text-sm font-medium">Club *</label><div className="mt-2"><SelectField id={`${prefix}-club`} name="clubId" value={clubId} onValueChange={value => { setDirty(true);setClubId(value); setSeasonId(""); setTeamId(""); }} options={clubs} required /></div></div>
        <div><label htmlFor={`${prefix}-season`} className="text-sm font-medium">Temporada *</label><div className="mt-2"><SelectField id={`${prefix}-season`} name="seasonId" value={seasonId} onValueChange={value => { setDirty(true);setSeasonId(value); setTeamId(""); }} options={seasons} disabled={!clubId} required /></div></div>
        <div className="sm:col-span-2"><label htmlFor={`${prefix}-team`} className="text-sm font-medium">Equipo inscrito *</label><div className="mt-2"><SelectField id={`${prefix}-team`} name="seasonTeamId" value={teamId} onValueChange={value=>{setDirty(true);setTeamId(value);}} options={availableTeams.map(option => ({ value: option.id, label: option.teamName, description: option.categoryName }))} disabled={!seasonId} required aria-invalid={Boolean(errors.seasonTeamId)} /></div>
          {team && <p className="mt-2 text-sm text-muted">{team.categoryName} · {team.groupName}</p>}</div>
        <div>{field("jerseyNumber", "Dorsal habitual (opcional)", "number", false)}<p className="mt-2 text-sm text-muted">Si lo asignas, queda fijo durante esta temporada y no puede repetirse en el mismo equipo.</p></div>
        {field("curp", "CURP")}{field("birthDate", "Fecha de nacimiento", "date")}
        {field("firstName", "Nombre(s)")}{field("paternalSurname", "Apellido paterno")}{field("maternalSurname", "Apellido materno (opcional)", "text", false)}
        <label className="flex items-start gap-3 rounded-xl border border-border p-4 sm:col-span-2"><input type="checkbox" name="requestAgeException" checked={requestAgeException} onChange={e=>setRequestAgeException(e.target.checked)} className="mt-1 size-5"/><span><strong>Presentar una petición de excepción de edad</strong><span className="mt-1 block text-sm leading-6 text-muted">Solo si la edad está dentro del margen excepcional configurado. Se abrirá un expediente pendiente para cargar la carta y solicitar la decisión de Secretaría. No se autoriza la edad ni se consulta la CURP automáticamente.</span></span></label>
      </fieldset>
      {message && <p role="status" tabIndex={-1} className="rounded-xl border border-border p-4 text-sm leading-6">{message}</p>}
      <div className="flex flex-wrap gap-3">
        {phase === "editing" && <button type="submit" disabled={!team} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50">{requestAgeException?"Abrir expediente para pedir excepción":"Registrar y verificar CURP"}</button>}
        {phase === "sending" && <button type="button" disabled className="primary-action min-h-12 rounded-xl px-5 py-3 opacity-60">{requestAgeException?"Preparando expediente pendiente…":"Registrando y verificando CURP…"}</button>}
        {(phase === "uncertain" || phase === "checking") && <><button type="button" disabled={phase === "checking"} onClick={() => void recover()} className={secondary}>{phase === "checking" ? "Consultando…" : "Consultar resultado del envío"}</button><button type="button" disabled={phase === "checking"} onClick={() => void send()} className={secondary}>Reintentar el mismo envío</button></>}
        {phase === "confirmed" && <button type="button" className={secondary} onClick={resetRegistration}>Registrar otro jugador</button>}
        {phase === "confirmed" && selectedRecord && <Link href={`/players/registrations/${selectedRecord}/documents`} className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold">Continuar al expediente</Link>}
      </div>
      <p className="text-xs leading-6 text-muted">Las altas y capturas para excepción están sujetas a los días y zona horaria configurados para la categoría. La captura se conserva solo mientras esta pantalla esté abierta; no es un borrador guardado.</p>
    </form></FormDialog>}
    {selectedRecord && <CurpVerificationPanel key={`${actorId}:${selectedRecord}`} actorId={actorId} registrationId={selectedRecord} providerConfigured={providerConfigured} fetcher={fetcher} onRegistrationChange={()=>setRefresh(value=>value+1)} />}
  </div>;
}
