"use client";

import { useRef, useState } from "react";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import { focusFormControl } from "@/components/ui/focus-form-control";
import { participationTimesSchema } from "@/features/matches/eligibility";
import type { MatchReportPresentation, ParticipationPeriod, ReportDemoData, ReportEvent } from "../types";
import { inputClass, primaryButton } from "./report-shared";

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

export function EventDialog({ data, report, event: original, changeOnly = false, onClose, onSave }: {
  data: ReportDemoData; report: MatchReportPresentation; event?: ReportEvent; changeOnly?: boolean;
  onClose: () => void; onSave: (event: ReportEvent) => void;
}) {
  const [typeCode, setTypeCode] = useState(original?.typeCode ?? (changeOnly ? "SUBSTITUTION" : ""));
  const [teamId, setTeamId] = useState(original?.teamId ?? "");
  const [playerId, setPlayerId] = useState(original?.playerId ?? "");
  const [outgoing, setOutgoing] = useState(original?.outgoingPlayerId ?? "");
  const [minute, setMinute] = useState(original?.minute?.toString() ?? "");
  const [period, setPeriod] = useState(original?.periodNumber?.toString() ?? "");
  const [description, setDescription] = useState(original?.description ?? "");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const type = data.eventTypes.find(type => type.code === typeCode);
  const isChange = typeCode === "SUBSTITUTION";
  const playerOptions = data.players.filter(player => player.teamId === teamId && report.lineups.some(row => row.playerId === player.id && row.selected)).map(player => ({ value: player.id, label: player.name, description: `Dorsal ${report.lineups.find(row => row.playerId === player.id)?.matchJersey ?? "pendiente"}` }));
  function save() {
    const problem = !type ? ["type", "Selecciona el evento."]
      : type.team === "required" && !teamId ? ["team", "Selecciona el equipo."]
        : type.player === "required" && !playerId ? ["player", "Selecciona el jugador."]
          : isChange && (!outgoing || outgoing === playerId) ? ["outgoing", "Selecciona dos jugadores diferentes para el cambio."]
            : type.opensCase && !description.trim() ? ["description", "Describe lo ocurrido para su revisión."] : null;
    if (problem) { setError(problem[1]); focusFormControl(form.current, problem[0]); return; }
    onSave({ id: original?.id ?? crypto.randomUUID(), typeCode, teamId: teamId || null, playerId: playerId || null, outgoingPlayerId: isChange ? outgoing : null,
      periodNumber: optionalNumber(period), minute: optionalNumber(minute), description: description.trim() });
  }
  return <FormDialog open title={original ? "Editar evento" : changeOnly ? "Registrar cambio" : "Registrar evento"} description="Catálogo sintético basado en los códigos existentes. El minuto es opcional." dirty={dirty} onClose={onClose} footer={<button type="submit" form="report-event-form" className={primaryButton}>Aplicar {isChange ? "cambio" : "evento"}</button>}>
    <form ref={form} id="report-event-form" className="space-y-4" onChange={() => setDirty(true)} onSubmit={event => { event.preventDefault(); save(); }}>
      <div><label htmlFor="event-type" className="mb-2 block font-medium">Evento</label><SelectField id="event-type" name="type" value={typeCode} onValueChange={value => { setTypeCode(value); setDirty(true); }} disabled={changeOnly} options={data.eventTypes.map(type => ({ value: type.code, label: type.label }))} aria-invalid={Boolean(error)} aria-describedby="event-error" /></div>
      <div><label htmlFor="event-team" className="mb-2 block font-medium">Equipo {type?.team === "optional" ? "(opcional)" : ""}</label><SelectField id="event-team" name="team" value={teamId} onValueChange={value => { setTeamId(value); setPlayerId(""); setOutgoing(""); setDirty(true); }} options={[{ value: "", label: "Sin equipo indicado" }, ...[data.match.home, data.match.away].map(team => ({ value: team.id, label: team.name }))]} aria-describedby="event-error" /></div>
      <div><label htmlFor="event-player" className="mb-2 block font-medium">{isChange ? "Jugador que entra" : `Jugador ${type?.player === "optional" ? "(opcional)" : ""}`}</label><SelectField id="event-player" name="player" value={playerId} onValueChange={value => { setPlayerId(value); setDirty(true); }} disabled={!teamId} options={[{ value: "", label: "Sin jugador indicado" }, ...playerOptions]} aria-describedby="event-error" /></div>
      {isChange && <div><label htmlFor="event-outgoing" className="mb-2 block font-medium">Jugador que sale</label><SelectField id="event-outgoing" name="outgoing" value={outgoing} onValueChange={value => { setOutgoing(value); setDirty(true); }} disabled={!teamId} options={playerOptions.filter(player => player.value !== playerId)} aria-describedby="event-error" /></div>}
      <div className="grid grid-cols-2 gap-3"><label className="font-medium">Periodo (opcional)<input value={period} onChange={event => setPeriod(event.target.value)} type="number" min="1" step="1" className={inputClass} /></label><label className="font-medium">Minuto (opcional)<input value={minute} onChange={event => setMinute(event.target.value)} type="number" min="0" step="1" className={inputClass} /></label></div>
      <label className="block font-medium">Descripción {type?.opensCase ? "(necesaria para revisar el incidente)" : "(opcional)"}<textarea name="description" rows={3} value={description} onChange={event => setDescription(event.target.value)} maxLength={4000} className={inputClass} aria-describedby="event-error" /></label>
      {type?.opensCase && <p className="text-sm text-muted">Este evento requeriría revisión disciplinaria. La demo no crea expedientes ni impone sanciones.</p>}
      <p id="event-error" role={error ? "alert" : undefined} className="text-sm text-danger">{error}</p>
    </form>
  </FormDialog>;
}
