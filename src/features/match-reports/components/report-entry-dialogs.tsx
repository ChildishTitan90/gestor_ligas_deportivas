"use client";

import { useRef, useState } from "react";
import { currentPitch, dismissalEvents, eventsBeforePlayerEvent, pitchBeforeChange, teamTactics } from "../tactics";
import { effectiveCaptain } from "../captaincy";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import { focusFormControl } from "@/components/ui/focus-form-control";
import { participationTimesSchema } from "@/features/matches/eligibility";
import type { MatchReportPresentation, ParticipationPeriod, ReportDemoData, ReportEvent } from "../types";
import { inputClass, primaryButton } from "./report-shared";
import { clockReading, formatClock } from "../match-clock";

const optionalNumber = (value: string) => value.trim() === "" ? null : Number(value);

export function PeriodDialog({ data, report, editing, onClose, onSave }: {
  data: ReportDemoData; report: MatchReportPresentation;
  editing: { playerId: string; index: number | null };
  onClose: () => void;
  onSave: (playerId: string, index: number | null, period: ParticipationPeriod) => void;
}) {
  const existing = editing.index === null ? null : report.lineups.find(row => row.playerId === editing.playerId)?.periods[editing.index];
  const [playerId, setPlayerId] = useState(editing.playerId);
  const [period, setPeriod] = useState(existing?.periodNumber.toString() ?? "");
  const [entry, setEntry] = useState(existing?.entryMinute?.toString() ?? "");
  const [exit, setExit] = useState(existing?.exitMinute?.toString() ?? "");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const players = data.players.filter(player => report.lineups.some(row => row.playerId === player.id && row.selected));
  function save() {
    if (!playerId) { setError("Selecciona al jugador."); focusFormControl(form.current, "player"); return; }
    const candidate = { periodNumber: Number(period), entryMinute: optionalNumber(entry), exitMinute: optionalNumber(exit) };
    if (!Number.isInteger(candidate.periodNumber) || candidate.periodNumber < 1 || [candidate.entryMinute, candidate.exitMinute].some(value => value !== null && (!Number.isInteger(value) || value < 0))) {
      setError("Indica un periodo entero mayor que cero y minutos enteros no negativos, o déjalos vacíos."); focusFormControl(form.current, "period"); return;
    }
    const rows = report.lineups.find(row => row.playerId === playerId)!.periods.filter((_, index) => index !== editing.index);
    const parsed = participationTimesSchema.safeParse([...rows, candidate]);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Revisa el tiempo."); focusFormControl(form.current, "period"); return; }
    onSave(playerId, editing.index, candidate);
  }
  return <FormDialog open title={existing ? "Editar tiempo de participación" : "Registrar tiempo de participación"} description="Minutos relativos al periodo. Deja vacíos los tiempos que todavía no conoces." dirty={dirty} onClose={onClose} footer={<button type="submit" form="report-period-form" className={primaryButton}>Aplicar tiempo</button>}>
    <form id="report-period-form" ref={form} className="space-y-4" onChange={() => setDirty(true)} onSubmit={event => { event.preventDefault(); save(); }}>
      <div><label htmlFor="period-player" className="mb-2 block font-medium">Jugador</label><SelectField id="period-player" name="player" value={playerId} onValueChange={value => { setPlayerId(value); setDirty(true); }} disabled={existing !== null} options={players.map(player => ({ value: player.id, label: player.name, description: data.match.home.id === player.teamId ? data.match.home.shortName : data.match.away.shortName }))} aria-describedby={error ? "period-error" : undefined} aria-invalid={Boolean(error)} /></div>
      <label htmlFor="period-number" className="block font-medium">Número de periodo<input id="period-number" name="period" value={period} onChange={event => setPeriod(event.target.value)} type="number" min="1" step="1" required className={inputClass} aria-describedby={error ? "period-error" : "period-help"} aria-invalid={Boolean(error)} /></label>
      <div className="grid grid-cols-2 gap-3"><label className="font-medium">Entrada (opcional)<input name="entry" value={entry} onChange={event => setEntry(event.target.value)} type="number" min="0" step="1" className={inputClass} /></label><label className="font-medium">Salida (opcional)<input name="exit" value={exit} onChange={event => setExit(event.target.value)} type="number" min="0" step="1" className={inputClass} /></label></div>
      <p id="period-help" className="text-sm text-muted">No se presupone la duración del periodo ni se calculan minutos totales. Los cruces de horario y reingresos siguen pendientes de la regla de Liga.</p>
      {error && <p id="period-error" role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  </FormDialog>;
}

export function EventDialog({ data, report, event: original, initial, live = false, liveCapture = false, changeOnly = false, onClose, onSave }: {
  data: ReportDemoData; report: MatchReportPresentation; event?: ReportEvent; initial?: Partial<ReportEvent>; live?: boolean; liveCapture?: boolean; changeOnly?: boolean;
  onClose: () => void; onSave: (event: ReportEvent) => void;
}) {
  const breakChange = report.clock?.phase === "BREAK" && !original;
  const breakTiming = breakChange ? clockReading(report.clock!, Date.parse(report.clock!.phaseStartedAt)) : null;
  const [typeCode, setTypeCode] = useState(breakChange ? "SUBSTITUTION" : original?.typeCode ?? initial?.typeCode ?? (changeOnly ? "SUBSTITUTION" : ""));
  const [teamId, setTeamId] = useState(original?.teamId ?? initial?.teamId ?? "");
  const [playerId, setPlayerId] = useState(original?.playerId ?? initial?.playerId ?? "");
  const [outgoing, setOutgoing] = useState(original?.outgoingPlayerId ?? initial?.outgoingPlayerId ?? "");
  const [second, setSecond] = useState((breakTiming?.second ?? original?.second ?? initial?.second)?.toString() ?? "");
  const [minute, setMinute] = useState((breakTiming?.minute ?? original?.minute ?? initial?.minute)?.toString() ?? "");
  const [period, setPeriod] = useState((breakTiming?.periodNumber ?? original?.periodNumber ?? initial?.periodNumber)?.toString() ?? "");
  const [description, setDescription] = useState(original?.description ?? "");
  const [replacementCaptainId, setReplacementCaptainId] = useState(original?.replacementCaptainId ?? "");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const type = data.eventTypes.find(type => type.code === typeCode);
  const isChange = typeCode === "SUBSTITUTION";
  const usesClockTime = breakChange || liveCapture && Boolean(report.clock) || original?.periodMinute !== undefined;
  const relativeMinute = usesClockTime && minute !== "" && period !== "" ? Number(minute) - (Number(period) === 2 ? report.clock?.halfMinutes ?? ((original?.minute ?? 0) - (original?.periodMinute ?? 0)) : 0) : undefined;
  const pitch = !teamId ? null : isChange && !liveCapture ? pitchBeforeChange(teamTactics(data, report, teamId).slots, report.events, teamId, { id: original?.id ?? "new-change", typeCode: "SUBSTITUTION", teamId, playerId: playerId || null, outgoingPlayerId: outgoing || null, periodNumber: optionalNumber(period), minute: optionalNumber(minute), ...(relativeMinute !== undefined ? {periodMinute:relativeMinute} : {}), description }) : currentPitch(teamTactics(data, report, teamId).slots, report.events.filter(e => e.id !== original?.id), teamId);
  const playerOptions = data.players.filter(player => player.teamId === teamId && report.lineups.some(row => row.playerId === player.id && row.selected)).map(player => ({ value: player.id, label: player.name, description: `Dorsal ${report.lineups.find(row => row.playerId === player.id)?.matchJersey ?? "pendiente"}` }));
  const incomingOptions = playerOptions.filter(p => !pitch?.slots.some(s => s.playerId === p.value) && !pitch?.removed.has(p.value));
  const candidate: ReportEvent = { id: original?.id ?? "new-change",typeCode,teamId:teamId||null,playerId:playerId||null,outgoingPlayerId:isChange?outgoing||null:null,periodNumber:optionalNumber(period),minute:optionalNumber(minute),second:optionalNumber(second),...(relativeMinute !== undefined ? {periodMinute:relativeMinute} : {}),description };
  const before = liveCapture && !original ? report.events : eventsBeforePlayerEvent(report.events,teamId,candidate);
  const captain = effectiveCaptain(report.captains[teamId],before,teamId);
  const captainLeaves = Boolean(captain && (isChange && outgoing === captain || dismissalEvents([...before,candidate]).some(e=>e.id===candidate.id && e.playerId===captain)));
  const after = teamId ? currentPitch(teamTactics(data,report,teamId).slots,[...before,candidate],teamId) : null;
  const captainOptions = playerOptions.filter(p=>p.value!==outgoing && after?.slots.some(s=>s.playerId===p.value));
  function save() {
    const problem = relativeMinute !== undefined && (relativeMinute < 0 || ![1,2].includes(Number(period))) ? ["minute", "El minuto del partido debe corresponder al periodo indicado."] : second !== "" && (minute === "" || !Number.isInteger(Number(second)) || Number(second) < 0 || Number(second) > 59) ? ["second", "Indica el minuto y segundos entre 0 y 59."] : !type ? ["type", "Selecciona el evento."]
      : type.team === "required" && !teamId ? ["team", "Selecciona el equipo."]
        : type.player === "required" && !playerId ? ["player", "Selecciona el jugador."]
          : isChange && !incomingOptions.some(p => p.value === playerId) ? ["player", "Elige un suplente disponible. Quien ya salió o fue expulsado no puede reingresar."]
          : isChange && (!outgoing || outgoing === playerId || !pitch?.slots.some(s => s.playerId === outgoing)) ? ["outgoing", "Elige al jugador que está en cancha y sale del partido."]
            : captainLeaves && !captainOptions.some(p => p.value === replacementCaptainId) ? ["replacementCaptain", "El capitán sale: selecciona al nuevo capitán entre quienes quedan en cancha."]
            : type.opensCase && !description.trim() ? ["description", "Describe lo ocurrido para su revisión."] : null;
    if (problem) { setError(problem[1]); focusFormControl(form.current, problem[0]); return; }
    onSave({ id: original?.id ?? crypto.randomUUID(), typeCode, teamId: teamId || null, playerId: playerId || null, outgoingPlayerId: isChange ? outgoing : null,
      periodNumber: optionalNumber(period), minute: optionalNumber(minute), ...(relativeMinute !== undefined ? {periodMinute:relativeMinute} : {}), ...(second !== "" ? { second: Number(second) } : {}), description: description.trim(), ...(captainLeaves ? { replacementCaptainId } : {}) });
  }
  return <FormDialog open title={original ? "Editar evento" : changeOnly || breakChange ? "Registrar cambio" : "Registrar evento"} description={breakChange ? "Cambio del descanso, registrado al inicio del segundo tiempo." : live ? "Evento del catálogo del partido. El tiempo es opcional; captura minutos y segundos." : "Catálogo sintético basado en los códigos existentes. El tiempo es opcional; captura minutos y segundos."} dirty={dirty} onClose={onClose} footer={<button type="submit" form="report-event-form" className={primaryButton}>Aplicar {isChange ? "cambio" : "evento"}</button>}>
    <form ref={form} id="report-event-form" className="space-y-4" onChange={() => setDirty(true)} onSubmit={event => { event.preventDefault(); save(); }}>
      {breakChange && <p role="status" className="rounded-xl border border-accent bg-soft p-3 text-sm">Cambio durante el descanso · Inicio del segundo tiempo · {formatClock((report.clock?.halfMinutes ?? 45) * 60)}. El tiempo queda fijado automáticamente.</p>}
      <div><label htmlFor="event-type" className="mb-2 block font-medium">Evento</label><SelectField id="event-type" name="type" value={typeCode} onValueChange={value => { setTypeCode(value); setDirty(true); }} disabled={changeOnly || breakChange} options={data.eventTypes.map(type => ({ value: type.code, label: type.label }))} aria-invalid={Boolean(error)} aria-describedby="event-error" /></div>
      {typeCode==='OWN_GOAL'&&<p className="text-sm text-muted">Selecciona al equipo y jugador que cometió el autogol. Se suma un gol al marcador del rival.</p>}
      {typeCode==='ASSIST'&&<p className="text-sm text-muted">La asistencia se registra para este jugador y no suma otro gol al marcador.</p>}
      <div><label htmlFor="event-team" className="mb-2 block font-medium">Equipo {type?.team === "optional" ? "(opcional)" : ""}</label><SelectField id="event-team" name="team" value={teamId} onValueChange={value => { setTeamId(value); setPlayerId(""); setOutgoing(""); setDirty(true); }} options={[{ value: "", label: "Sin equipo indicado" }, ...[data.match.home, data.match.away].map(team => ({ value: team.id, label: team.name }))]} aria-describedby="event-error" /></div>
      <div><label htmlFor="event-player" className="mb-2 block font-medium">{isChange ? "Jugador que entra" : `Jugador ${type?.player === "optional" ? "(opcional)" : ""}`}</label><SelectField id="event-player" name="player" value={playerId} onValueChange={value => { setPlayerId(value); setDirty(true); }} disabled={!teamId} options={[{ value: "", label: "Sin jugador indicado" }, ...(isChange ? incomingOptions : playerOptions)]} aria-describedby="event-error" /></div>
      {isChange && <div><label htmlFor="event-outgoing" className="mb-2 block font-medium">Jugador que sale</label><SelectField id="event-outgoing" name="outgoing" value={outgoing} onValueChange={value => { setOutgoing(value); setDirty(true); }} disabled={!teamId} options={playerOptions.filter(player => player.value !== playerId && (!pitch || pitch.slots.some(s => s.playerId === player.value)))} aria-describedby="event-error" /></div>}
      {captainLeaves && <div className="rounded-xl border border-accent bg-soft p-4"><label htmlFor="event-replacement-captain" className="mb-2 block font-semibold">Nuevo capitán · Obligatorio</label><p className="mb-3 text-sm text-muted">El capitán actual sale del campo. Elige a alguien que permanezca en cancha, incluido el jugador que entra.</p><SelectField id="event-replacement-captain" name="replacementCaptain" value={replacementCaptainId} onValueChange={value=>{setReplacementCaptainId(value);setDirty(true);}} options={captainOptions} aria-invalid={Boolean(error && !replacementCaptainId)} aria-describedby="event-error" /></div>}
      <div className="grid grid-cols-2 gap-3"><label className="font-medium">Periodo (opcional)<input name="period" value={period} disabled={breakChange} onChange={event => setPeriod(event.target.value)} type="number" min="1" step="1" className={inputClass} /></label><label className="font-medium">{usesClockTime ? "Minuto del partido" : "Minuto (opcional)"}<input name="minute" value={minute} disabled={breakChange} onChange={event => setMinute(event.target.value)} type="number" min="0" step="1" className={inputClass} /></label></div>
      <label className="block font-medium">Segundo (opcional)<input name="second" value={second} disabled={breakChange} onChange={event => setSecond(event.target.value)} type="number" min="0" max="59" step="1" className={inputClass} aria-describedby="event-error" /><span className="mt-2 block text-xs font-normal text-muted">Tiempo del evento en minutos y segundos. Si se desconoce, déjalo vacío.</span></label>
      <label className="block font-medium">Descripción {type?.opensCase ? "(necesaria para revisar el incidente)" : "(opcional)"}<textarea name="description" rows={3} value={description} onChange={event => setDescription(event.target.value)} placeholder={typeCode === "SERIOUS_INCIDENT" ? "Ej.: En el minuto 63:20 se produjo una riña entre jugadores de ambos equipos. Indica quiénes participaron, qué observaste y qué medidas se tomaron." : undefined} maxLength={4000} className={inputClass} aria-describedby="event-error" /></label>
      {type?.opensCase && <p className="text-sm text-muted">{live ? "Este evento requiere revisión disciplinaria. Registrar la cédula no impone sanciones." : "Este evento requeriría revisión disciplinaria. La demo no crea expedientes ni impone sanciones."}</p>}
      <p id="event-error" role={error ? "alert" : undefined} className="text-sm text-danger">{error}</p>
    </form>
  </FormDialog>;
}
