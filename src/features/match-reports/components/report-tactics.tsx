"use client";
import { EventIcon } from "./event-icon";
import { effectiveCaptain } from "../captaincy";
import { useRef, useState, type PointerEvent } from "react";
import { GripVertical, SlidersHorizontal } from "lucide-react";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import { defaultUniformKits, hexRGB, rgbHex, rgbText } from "@/features/clubs/uniform-kits";
import { ColorField } from "@/components/ui/color-field";
import { currentPitch, formationLines, formationSlots, formations, keeperKit, teamTactics, type TeamTactics } from "../tactics";
import type { MatchReportPresentation, ReportDemoData, ReportPlayer, ReportTeam } from "../types";
import { inputClass, primaryButton, secondaryButton } from "./report-shared";
import { PlayerEventBadges } from "./player-event-badges";
import { PlayerBadge } from "./player-badge";

export type SlotAssignment = { playerId: string; jersey: number | null };
type Props = { data: ReportDemoData; report: MatchReportPresentation; team: ReportTeam; locked: boolean; onTactics: (teamId: string, tactics: TeamTactics, assignment?: SlotAssignment) => void; onPlayer: (playerId: string) => void };

export function ReportTactics({ data, report, team, locked, onTactics, onPlayer }: Props) {
  const sealed = Boolean(report.lineupsLock) || report.status === "CONFIRMED";
  const [preferredMode, setMode] = useState<"initial" | "current" | null>(null);
  const mode = sealed ? preferredMode ?? "current" : "initial";
  const [slotEditor, setSlotEditor] = useState<{ index: number; playerId?: string } | null>(null);
  const [kitEditor, setKitEditor] = useState(false);
  const tactics = teamTactics(data, report, team.id);
  const current = currentPitch(tactics.slots, report.events, team.id);
  const slots = mode === "initial" ? tactics.slots : current.slots;
  const starters = tactics.slots.filter(s => s.playerId).length;
  const players = data.players.filter(p => p.teamId === team.id);
  const bench = players.filter(p => report.lineups.some(row => row.playerId === p.id && row.selected) && !(mode === "initial" ? tactics.slots : current.slots).some(s => s.playerId === p.id) && (mode === "initial" || !current.removed.has(p.id)));
  const [selectedBench, setSelectedBench] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ playerId: string; x: number; y: number; target: number | null } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const drag = useRef<{ playerId: string; source?: number; startX: number; startY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const board = useRef<HTMLDivElement>(null);
  const customLines = formationLines(tactics.formation === "CUSTOM" ? tactics.customFormation ?? "" : tactics.formation === "WM" ? "3-2-2-3" : tactics.formation ?? "4-4-2");
  const maxRow = Math.max(...(customLines ?? [4]));
  function assign(index: number, playerId: string) {
    const player = players.find(p => p.id === playerId);
    if (locked || !player?.eligible || tactics.slots.some((s, i) => i !== index && s.playerId === playerId)) return;
    const lineup = report.lineups.find(r => r.playerId === playerId);
    if (lineup?.participationHalf === 2) { setAnnouncement("Reservado para segundo tiempo; inicia en banca."); return; }
    const jersey = lineup ? lineup.matchJersey : player.usualJersey;
    if (jersey === null || report.lineups.some(r => r.selected && r.playerId !== playerId && r.matchJersey === jersey && players.some(p => p.id === r.playerId))) { setSlotEditor({ index, playerId }); return; }
    onTactics(team.id, { ...tactics, slots: tactics.slots.map((slot, i) => i === index ? { ...slot, playerId } : slot) }, { playerId, jersey });
    setSelectedBench(null); setAnnouncement(`${player.name} asignado a la posición ${index + 1}.`);
  }
  function beginDrag(event: PointerEvent<HTMLButtonElement>, playerId: string, source?: number) {
    if (locked || mode !== "initial" || (event.pointerType === "mouse" && event.button !== 0)) return;
    if (report.lineups.some(r => r.playerId === playerId && r.participationHalf === 2)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { playerId, source, startX: event.clientX, startY: event.clientY, moved: false };
    suppressClick.current = false;
  }
  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current; if (!active) return;
    if (Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 8 && !active.moved) return;
    active.moved = true;
    if (event.clientY < 110) window.scrollBy(0, -24);
    else if (event.clientY > window.innerHeight - 60) window.scrollBy(0, 24);
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-pitch-slot]");
    const index = target?.dataset.team === team.id ? Number(target.dataset.pitchSlot) : null;
    setDragging({ playerId: active.playerId, x: event.clientX, y: event.clientY, target: index });
  }
  function endDrag(event: PointerEvent<HTMLButtonElement>, cancel = false) {
    const active = drag.current; drag.current = null; setDragging(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!active?.moved || cancel) return;
    suppressClick.current = true;
    if (locked || sealed || mode !== "initial") return;
    if (active.source !== undefined && board.current) {
      const rect = board.current.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-pitch-slot]");
      const targetIndex = target?.dataset.team === team.id ? Number(target.dataset.pitchSlot) : null;
      if (targetIndex !== null && targetIndex !== active.source && tactics.slots[targetIndex]) {
        const displaced = tactics.slots[targetIndex].playerId;
        onTactics(team.id, { ...tactics, slots: tactics.slots.map((slot, i) => i === targetIndex ? { ...slot, playerId: active.playerId } : i === active.source ? { ...slot, playerId: displaced } : slot) });
        setSelectedBench(null);
        setAnnouncement(displaced ? `${players.find(p => p.id === active.playerId)?.name} y ${players.find(p => p.id === displaced)?.name} intercambiaron posiciones.` : `Jugador trasladado a la posición ${targetIndex + 1}. La posición de origen quedó vacante.`);
        return;
      }
      const x = Math.max(8, Math.min(92, Math.round((event.clientX - rect.left) * 100 / rect.width)));
      const y = Math.max(8, Math.min(92, Math.round((event.clientY - rect.top) * 100 / rect.height)));
      onTactics(team.id, { ...tactics, formation: "CUSTOM", customFormation: tactics.customFormation || (tactics.formation === "WM" ? "3-2-2-3" : tactics.formation) || "4-4-2", slots: tactics.slots.map((slot, i) => i === active.source ? { ...slot, x, y } : slot) });
      setAnnouncement("Posición ajustada en el campo. Falta guardar el once inicial.");
    } else {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-pitch-slot]");
      if (target?.dataset.team === team.id) assign(Number(target.dataset.pitchSlot), active.playerId);
    }
  }
  function positionClick(index: number, clickCount: number) {
    if (suppressClick.current) { suppressClick.current = false; if (clickCount > 0) return; }
    if (mode === "initial") { if (selectedBench) assign(index, selectedBench); else setSlotEditor({ index }); }
    else if (slots[index].playerId) onPlayer(slots[index].playerId!);
  }
  function formation(code: string) {
    const previous = tactics.slots.flatMap(s => s.playerId ? [s.playerId] : []);
    const next = code === "CUSTOM" || !code ? tactics.slots : formationSlots(code).map((s, i) => ({ ...s, playerId: previous[i] ?? null }));
    onTactics(team.id, { ...tactics, formation: code ? code as TeamTactics["formation"] : null, ...(code === "CUSTOM" ? { customFormation: tactics.customFormation || (tactics.formation === "WM" ? "3-2-2-3" : tactics.formation) || "4-4-2" } : {}), slots: next });
  }
  return <div className="space-y-4 p-3 sm:p-4">
    <div className="flex flex-wrap gap-2" aria-label={`Vista de ${team.shortName}`}><button type="button" aria-pressed={mode === "initial"} className={mode === "initial" ? primaryButton : secondaryButton} onClick={() => setMode("initial")}>Once inicial</button>{sealed && <button type="button" aria-pressed={mode === "current"} className={mode === "current" ? primaryButton : secondaryButton} onClick={() => setMode("current")}>En cancha</button>}</div>
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2"><div><label htmlFor={`formation-${team.id}`} className="mb-2 block text-sm font-semibold">Formación</label><SelectField id={`formation-${team.id}`} value={tactics.formation ?? ""} onValueChange={formation} disabled={locked || mode !== "initial"} options={[{ value: "", label: "Sin formación indicada" }, ...formations.map(code => ({ value: code, label: code === "WM" ? "WM · 3-2-2-3" : code })), { value: "CUSTOM", label: "Personalizada" }]} /></div><button type="button" onClick={() => setKitEditor(true)} disabled={locked} className={secondaryButton} aria-label={`Elegir uniforme de ${team.shortName}`}><SlidersHorizontal size={18} aria-hidden="true" /><span className="hidden sm:inline">Uniforme</span></button></div>
    {tactics.formation === "CUSTOM" && <div><label htmlFor={`custom-formation-${team.id}`} className="mb-2 block text-sm font-semibold">Escribe la formación</label><input id={`custom-formation-${team.id}`} value={tactics.customFormation ?? ""} placeholder="Ej. 4-2-2-2" disabled={locked || mode !== "initial"} aria-invalid={!customLines} aria-describedby={`custom-formation-help-${team.id}`} onChange={event => { const value = event.target.value; const valid = formationLines(value); const previous = tactics.slots.flatMap(s => s.playerId ? [s.playerId] : []); onTactics(team.id, { ...tactics, customFormation: value, ...(valid ? { slots: formationSlots(value).map((slot, i) => ({ ...slot, playerId: previous[i] ?? null })) } : {}) }); }} className={inputClass} /><p id={`custom-formation-help-${team.id}`} className={`mt-2 text-xs ${customLines ? "text-muted" : "text-danger"}`}>Separa las líneas con guiones. Deben sumar diez jugadores, sin contar al portero.</p></div>}
    {!sealed && <p className="text-xs leading-5 text-muted">Al continuar confirmarás el once inicial de ambos equipos. Después solo se modificarán mediante eventos.</p>}
    {announcement && <p role="status" className="text-sm text-primary">{announcement}</p>}
    {!tactics.formation && <p className="rounded-xl border border-accent p-3 text-xs leading-5 text-muted">Distribución provisional. Elige una formación y revisa las posiciones para registrar el esquema del equipo.</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted"><p>{mode === "initial" ? `${starters}/11 titulares asignados` : `${current.slots.filter(s => s.playerId).length} jugadores en cancha`}</p><p>{tactics.kit ? `Uniforme ${tactics.kitSource === "custom" ? "del partido" : tactics.kitSource === "away" ? "visitante" : "local"}` : "Colores sin registrar"}</p></div>
    <div className="overflow-x-auto rounded-2xl"><div ref={board} style={{ minWidth: maxRow > 5 ? Math.ceil((maxRow - 1) * 70 / 0.76 + 30) : undefined, minHeight: (customLines?.length ?? 0) > 5 ? Math.ceil((customLines!.length - 1) * 76 / 0.54 + 140) : undefined }} className="relative isolate aspect-[0.68] w-full overflow-hidden rounded-2xl border border-[var(--pitch-line)] bg-[var(--pitch)] text-[var(--pitch-foreground)]" data-pitch={team.id}>
      <svg viewBox="0 0 100 145" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 size-full" aria-hidden="true"><defs><pattern id={`stripes-${team.id}`} width="100" height="29" patternUnits="userSpaceOnUse"><rect width="100" height="14.5" fill="white" opacity=".035" /></pattern></defs><rect width="100" height="145" fill={`url(#stripes-${team.id})`} /><g fill="none" stroke="var(--pitch-line)" strokeWidth=".35" opacity=".75"><rect x="4" y="4" width="92" height="137" /><path d="M4 72.5H96M28 4V24H72V4M39 4V12H61V4M28 141V121H72V141M39 141V133H61V141" /><circle cx="50" cy="72.5" r="12" /><circle cx="50" cy="72.5" r=".8" fill="var(--pitch-line)" /><path d="M39 24Q50 35 61 24M39 121Q50 110 61 121" /></g></svg>
      {slots.map((slot, index) => {
        const player = players.find(p => p.id === slot.playerId);
        const row = report.lineups.find(r => r.playerId === slot.playerId);
        const events = report.events.filter(e => e.playerId === player?.id);
        const goals=events.filter(e=>e.typeCode==="GOAL").length, assists=events.filter(e=>e.typeCode==="ASSIST").length, ownGoals=events.filter(e=>e.typeCode==="OWN_GOAL").length;
        const yellow = events.filter(e => e.typeCode === "CAUTION").length;
        const red = yellow >= 2 || events.some(e => e.typeCode === "SENDING_OFF");
        const exited = Boolean(player && report.events.some(e => e.typeCode === "SUBSTITUTION" && e.teamId === team.id && e.outgoingPlayerId === player.id));
        const substitution = exited ? "EXIT" : events.some(e => e.typeCode === "SUBSTITUTION") ? "ENTER" : null;
        const substitutionLabel = exited ? "Salió de cambio" : "Entró de cambio";
        return <button key={index} type="button" disabled={mode === "initial" ? locked : !player} data-pitch-slot={index} data-team={team.id} onPointerDown={event => { suppressClick.current = false; if (player) beginDrag(event, player.id, index); }} onPointerMove={moveDrag} onPointerUp={event => endDrag(event)} onPointerCancel={event => endDrag(event, true)} onClick={event => positionClick(index, event.detail)} aria-label={mode === "initial" ? `Asignar posición ${index + 1} de ${team.shortName}${player ? `: ${player.name}${exited ? ", salió de cambio" : ""}` : ""}` : `${player?.name ?? "Posición vacante"}, dorsal ${row?.matchJersey ?? "pendiente"}, ${goals} goles, ${assists} asistencias, ${ownGoals} goles en contra, ${yellow} amarillas${events.some(e=>e.typeCode==="INJURY")?", con lesión":""}${red ? ", expulsado" : ""}`} className={`absolute flex w-[19%] max-w-16 ${dragging?.target === index ? "ring-2 ring-accent" : ""} -translate-x-1/2 -translate-y-1/2 flex-col items-center rounded-xl px-0.5 py-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-default`} style={{ touchAction: mode === "initial" && !locked ? "none" : "auto", left: `${slot.x}%`, top: `${slot.y}%` }}>
          <span className="relative block">{player ? <PlayerBadge player={player} jersey={row?.matchJersey} kit={index === 0 ? keeperKit(tactics) : tactics.kit} showPhoto={mode === "current"} /> : <span className="grid size-12 place-items-center rounded-xl border border-dashed border-white/70 bg-black/10 text-2xl">{mode === "initial" ? "+" : "–"}</span>}<span className="absolute -right-2 -top-1 flex gap-0.5" aria-hidden="true"><PlayerEventBadges events={events} kind="cards" />{events.some(e => e.typeCode === "INJURY") && <EventIcon code="INJURY" size={16} onPitch />}</span>{substitution && <span className={`absolute -left-2 -top-1 rounded-full border border-white p-0.5 ${exited ? "bg-danger-surface" : "bg-positive-surface"}`} title={substitutionLabel}><EventIcon code={substitution} size={16} /><span className="sr-only">{substitutionLabel}</span></span>}{events.some(e => ["GOAL","OWN_GOAL","ASSIST"].includes(e.typeCode)) && <span className="absolute -bottom-1 -left-1"><PlayerEventBadges events={events} kind="goals" /></span>}{player && (mode === "initial" ? report.captains[team.id] : effectiveCaptain(report.captains[team.id],report.events,team.id)) === player.id && <span className="absolute -bottom-1 -right-1 rounded border border-white bg-[var(--pitch)] px-1 text-[10px] font-bold" aria-label="Capitán">C</span>}</span>
          <span className="mt-1 block w-full truncate rounded bg-black/30 px-0.5 py-0.5 text-center text-[10px] font-semibold leading-4 sm:text-xs" title={player?.name}>{player ? player.name : index === 0 ? "Portería" : `Posición ${index + 1}`}</span>
        </button>;
      })}
    </div></div>
    <p className="text-xs leading-5 text-muted">{mode === "initial" ? "Toca una posición o arrastra desde la banca. Arrastrar sobre otro jugador intercambia sus posiciones; sobre el campo libre ajusta la ubicación. Quienes estén convocados sin posición quedan en banca." : "Toca un jugador para registrar una acción. El esquema conserva el once inicial."} {report.events.some(e => e.periodNumber === null || e.minute === null) && "Con tiempos incompletos, el campo sigue el orden de captura de los eventos."}</p>
    <details className="rounded-xl border border-border p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Símbolos del partido</summary><ul className="grid grid-cols-2 gap-3 pt-3 text-xs">{[["GOAL","Gol"],["OWN_GOAL","Gol en contra"],["CAUTION","Amarilla"],["SENDING_OFF","Roja"],["SECOND_CAUTION","Dos amarillas"],["ENTER","Entra"],["EXIT","Sale"],["INJURY","Con lesión"],["SUSPENDED","Con suspensión"],["ASSIST","Asistencia"]].map(([code,label])=><li key={code} className="flex items-center gap-2"><EventIcon code={code} size={22}/>{label}</li>)}</ul><p className="mt-3 text-xs text-muted">Dos amarillas generan expulsión. La suspensión se consulta desde elegibilidad; no se impone desde la captura.</p></details>
    {current.problems.length > 0 && <p role="alert" className="rounded-xl border border-danger bg-danger-surface p-3 text-sm text-danger">Hay cambios que no se pueden representar. Revisa el orden y los jugadores en Participación antes de guardar.</p>}
    <div><h4 className="mb-3 text-sm font-semibold text-primary">Banca · {bench.length}</h4>{bench.length ? <ul className="grid grid-cols-2 gap-2">{bench.map(player => <li key={player.id} className={`flex rounded-xl border bg-background ${selectedBench === player.id ? "border-accent ring-1 ring-accent" : "border-border"}`}><button type="button" onClick={() => mode === "initial" && !locked ? (setSelectedBench(player.id), setAnnouncement(`Selecciona una posición para ${player.name}.`)) : onPlayer(player.id)} aria-pressed={mode === "initial" ? selectedBench === player.id : undefined} className="flex min-h-16 min-w-0 flex-1 items-center gap-2 p-2 text-left"><PlayerBadge player={player} jersey={report.lineups.find(r => r.playerId === player.id)?.matchJersey} kit={tactics.kit} showPhoto={mode === "current"} /><span className="min-w-0 text-xs font-medium">{player.name}</span></button>{mode === "initial" && !locked && <button type="button" style={{ touchAction: "none" }} onPointerDown={event => beginDrag(event, player.id)} onPointerMove={moveDrag} onPointerUp={event => endDrag(event)} onPointerCancel={event => endDrag(event, true)} onClick={() => { suppressClick.current = false; }} aria-label={`Arrastrar ${player.name} al campo`} className="grid min-h-12 w-10 shrink-0 cursor-grab place-items-center rounded-r-xl text-muted active:cursor-grabbing"><GripVertical size={20} aria-hidden="true" /></button>}</li>)}</ul> : <p className="text-sm text-muted">Sin suplentes convocados disponibles.</p>}</div>
    {current.removed.size > 0 && <details className="rounded-xl border border-border p-3"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Jugadores que salieron o fueron expulsados</summary><ul className="space-y-1">{players.filter(p => current.removed.has(p.id)).map(p => <li key={p.id}><button type="button" className="min-h-12 w-full py-2 text-left text-sm underline underline-offset-4" onClick={() => onPlayer(p.id)}>{p.name}{report.events.filter(e => e.playerId === p.id && e.teamId === team.id && e.typeCode === "CAUTION").length >= 2 ? " · Roja por segunda amarilla" : report.events.some(e => e.playerId === p.id && e.typeCode === "SENDING_OFF") ? " · Expulsado" : " · Sustituido"} · Ver historial <EventIcon code={report.events.some(e=>e.outgoingPlayerId===p.id)?"EXIT":"SENDING_OFF"} size={16} /> <PlayerEventBadges events={report.events.filter(e=>e.playerId===p.id && e.teamId===team.id)} /></button></li>)}</ul></details>}
    {slotEditor !== null && <SlotDialog key={`${slotEditor.index}:${slotEditor.playerId ?? ""}`} data={data} report={report} team={team} tactics={tactics} index={slotEditor.index} initialPlayerId={slotEditor.playerId} onClose={() => setSlotEditor(null)} onSave={(next, assignment) => { onTactics(team.id, next, assignment); setSlotEditor(null); }} />}
    {dragging && <div aria-hidden="true" className="pointer-events-none fixed z-50 rounded-xl border border-accent bg-surface p-2 shadow-xl" style={{ left: dragging.x + 10, top: dragging.y + 10 }}><PlayerBadge player={players.find(p => p.id === dragging.playerId)} jersey={report.lineups.find(r => r.playerId === dragging.playerId)?.matchJersey} kit={tactics.kit} /></div>}
    {kitEditor && <KitDialog team={team} tactics={tactics} onClose={() => setKitEditor(false)} onSave={next => { onTactics(team.id, next); setKitEditor(false); }} />}
  </div>;
}

function SlotDialog({ data, report, team, tactics, index, initialPlayerId, onClose, onSave }: { data: ReportDemoData; report: MatchReportPresentation; team: ReportTeam; tactics: TeamTactics; index: number; initialPlayerId?: string; onClose: () => void; onSave: (tactics: TeamTactics, assignment?: SlotAssignment) => void }) {
  const slot = tactics.slots[index];
  const [playerId, setPlayerId] = useState(initialPlayerId ?? slot.playerId ?? "");
  const [jersey, setJersey] = useState(report.lineups.find(r => r.playerId === (initialPlayerId ?? slot.playerId))?.matchJersey?.toString() ?? "");
  const [x, setX] = useState(slot.x); const [y, setY] = useState(slot.y); const [dirty, setDirty] = useState(false);
  const players = data.players.filter(p => p.teamId === team.id);
  const duplicate = report.lineups.find(row => row.selected && row.playerId !== playerId && row.matchJersey === Number(jersey) && jersey !== "" && players.some(p => p.id === row.playerId));
  const jerseyError = duplicate ? `El dorsal ${jersey} ya lo usa ${players.find(p => p.id === duplicate.playerId)?.name} en este equipo.` : "";
  function choose(value: string) { setPlayerId(value); setJersey((report.lineups.find(r => r.playerId === value)?.matchJersey)?.toString() ?? ""); setDirty(true); }
  return <FormDialog open title={`Posición ${index + 1} · ${team.shortName}`} description="El jugador elegido será titular inicial. Su reemplazo anterior permanece convocado en banca." dirty={dirty} onClose={onClose} footer={<button type="submit" form="pitch-slot-form" className={primaryButton} disabled={Boolean(jerseyError)}>Aplicar posición</button>}><form id="pitch-slot-form" className="space-y-4" onChange={() => setDirty(true)} onSubmit={event => { event.preventDefault(); if (jerseyError) return; onSave({ ...tactics, slots: tactics.slots.map((s, i) => i === index ? { x, y, playerId: playerId || null } : s) }, playerId ? { playerId, jersey: jersey === "" ? null : Number(jersey) } : undefined); }}><div><label htmlFor="pitch-player" className="mb-2 block font-semibold">Jugador titular</label><SelectField id="pitch-player" value={playerId} onValueChange={choose} options={[{ value: "", label: "Posición sin asignar" }, ...players.map((p: ReportPlayer) => ({ value: p.id, label: p.name, description: !p.eligible ? p.blockers.map(b => b.message).join(" · ") : `Dorsal ${report.lineups.find(r => r.playerId === p.id)?.matchJersey ?? p.usualJersey ?? "pendiente"}`, disabled: !p.eligible || report.lineups.find(r => r.playerId === p.id)?.participationHalf === 2 || tactics.slots.some((s, i) => i !== index && s.playerId === p.id) }))]} /></div>{playerId && <label className="block font-semibold">Dorsal de este partido<input className={`${inputClass} mt-2`} type="number" min="0" step="1" required aria-invalid={Boolean(jerseyError)} aria-describedby={jerseyError ? "slot-jersey-error" : undefined} value={jersey} onChange={event => setJersey(event.target.value)} /></label>}{jerseyError && <p id="slot-jersey-error" role="alert" className="text-sm text-danger">{jerseyError}</p>}{tactics.formation === "CUSTOM" && <fieldset className="space-y-4 rounded-xl border border-border p-4"><legend className="px-1 text-sm font-semibold">Ubicación personalizada</legend><label className="block text-sm">Horizontal · {Math.round(x)}%<input type="range" min="8" max="92" value={x} onChange={e => setX(Number(e.target.value))} className="block min-h-12 w-full accent-[var(--action)]" /></label><label className="block text-sm">Vertical · {Math.round(y)}%<input type="range" min="8" max="92" value={y} onChange={e => setY(Number(e.target.value))} className="block min-h-12 w-full accent-[var(--action)]" /></label></fieldset>}</form></FormDialog>;
}

function KitDialog({ team, tactics, onClose, onSave }: { team: ReportTeam; tactics: TeamTactics; onClose: () => void; onSave: (tactics: TeamTactics) => void }) {
  const [kit, setKit] = useState(tactics.kit ?? defaultUniformKits.home); const [source, setSource] = useState(tactics.kitSource ?? "custom"); const [dirty, setDirty] = useState(false);
  const [keeper, setKeeper] = useState(() => keeperKit(tactics));
  const keeperConflict = rgbHex(keeper.primary) === rgbHex(kit.primary);
  return <FormDialog open title={`Uniforme · ${team.shortName}`} description="Elige los colores usados en este partido. Guardar la cédula conserva esta selección." dirty={dirty} onClose={onClose} footer={<button type="button" className={primaryButton} disabled={keeperConflict} onClick={() => onSave({ ...tactics, kit, keeperKit: keeper, kitSource: source })}>Aplicar uniforme</button>}><div className="space-y-5"><div><label htmlFor="match-kit-source" className="mb-2 block font-semibold">Uniforme</label><SelectField id="match-kit-source" value={source} onValueChange={value => { setSource(value as typeof source); if (value !== "custom" && team.uniformKits) setKit(team.uniformKits[value as "home" | "away"]); setDirty(true); }} searchable={false} options={[{ value: "home", label: "Local registrado", disabled: !team.uniformKits }, { value: "away", label: "Visitante registrado", disabled: !team.uniformKits }, { value: "custom", label: "Colores de este partido" }]} /></div><div className="grid grid-cols-2 gap-3">{(["primary", "secondary"] as const).map(part => <ColorField key={part} id={`match-kit-${team.id}-${part}`} label={part === "primary" ? "Principal" : "Secundario"} value={rgbHex(kit[part])} description={rgbText(kit[part])} onValueChange={hex => { setKit(current => ({ ...current, [part]: hexRGB(hex) })); setSource("custom"); setDirty(true); }} />)}</div><fieldset className="space-y-3 rounded-xl border border-border p-4"><legend className="px-1 font-semibold">Portero · Solo este partido</legend><p className="text-xs leading-5 text-muted">Su uniforme no se toma del registro del club. El color principal debe distinguirse del resto del equipo.</p><div className="grid grid-cols-2 gap-3">{(["primary", "secondary"] as const).map(part => <ColorField key={part} id={`match-keeper-${team.id}-${part}`} label={part === "primary" ? "Principal del portero" : "Secundario"} value={rgbHex(keeper[part])} description={rgbText(keeper[part])} onValueChange={hex => { setKeeper(current => ({ ...current, [part]: hexRGB(hex) })); setDirty(true); }} />)}</div>{keeperConflict && <p role="alert" className="text-sm text-danger">El portero necesita un color principal diferente al del equipo.</p>}</fieldset>{!team.uniformKits && <p className="text-sm text-muted">El club aún no tiene colores RGB registrados. Puedes indicar los utilizados en este encuentro.</p>}</div></FormDialog>;
}
