"use client";

import { useEffect, useState } from "react";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import { assessPreview, assignmentLabels, intervalLabel } from "../preview-model";
import type { AssignmentAssessment, AssignmentPresentation, AssignmentStatus, RefereePreviewData, LiveRefereeControls } from "../types";
import { OperationFields } from "./operation-fields";

export function Assessment({ assessment, live=false }: { assessment: ReturnType<typeof assessPreview>; live?:boolean }) {
  return <div className="space-y-2 text-sm" aria-live="polite">
    <p className="font-semibold">Disponibilidad: {assessment.availability === "COVERED" ? "cubre el horario" : assessment.availability === "UNAVAILABLE" ? "indisponible" : "sin confirmar"}</p>
    {assessment.blockers.length ? <div className="rounded-xl border border-danger bg-danger-surface p-4 text-danger">
      <p className="font-semibold">No se puede aprobar</p><ul className="mt-2 list-disc space-y-2 pl-5">{assessment.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blocker.message}</li>)}</ul>
    </div> : <p className="rounded-xl border border-positive bg-positive-surface p-3 text-positive">{live ? "Sin bloqueos actuales. Se comprobará otra vez al confirmar la operación." : "Sin bloqueos en el ejemplo. Requiere validación oficial del servidor antes de una aprobación real."}</p>}
  </div>;
}

export function AssignmentDialog({ data, seasonId, timezone, assignment, onClose, onConfirm, live }: {
  data: RefereePreviewData; seasonId: string; timezone: string; assignment?: AssignmentPresentation;
  onClose: () => void;
  onConfirm: (value: { matchId: string; refereeId: string; status: AssignmentStatus }) => void;
  live?: LiveRefereeControls;
}) {
  const [matchId, setMatchId] = useState(assignment?.matchId ?? "");
  const [refereeId, setRefereeId] = useState(assignment?.refereeId ?? "");
  const match = data.matches.find(item => item.id === matchId);
  const [remote, setRemote] = useState<{key:string;value:AssignmentAssessment}|null>(null);
  const key = `${matchId}:${refereeId}:${assignment?.id??""}`;
  const liveMode = !!live;
  const leagueId = live?.leagueId;
  useEffect(()=>{
    if(!liveMode || !matchId || !refereeId)return;
    const controller=new AbortController();
    const q=new URLSearchParams({leagueId:leagueId!,seasonId,matchId,refereeId,...(assignment?{assignmentId:assignment.id}:{})});
    void fetch(`/api/referees?${q}`,{cache:"no-store",signal:controller.signal}).then(async response=>{if(!response.ok)throw Error();const value=await response.json();setRemote({key,value});}).catch(()=>{if(!controller.signal.aborted)setRemote({key,value:{availability:"UNKNOWN",blockers:[{code:"UNAVAILABLE_ASSESSMENT",message:"No se pudo consultar la evaluación. Cierra y vuelve a abrir para consultar de nuevo."}]}});});
    return ()=>controller.abort();
  },[liveMode,leagueId,seasonId,matchId,refereeId,assignment,key]);
  const assessment = live ? remote?.key===key ? remote.value : {availability:"UNKNOWN" as const,blockers:[{code:"LOADING",message:"Consulta de evaluación pendiente."}]} : assessPreview(data, matchId, refereeId, assignment?.id);
  const review = !!assignment;
  const revoked = assignment?.status === "REVOKED";
  const eligible = !!match && !!refereeId && !assessment.blockers.length && (!live || (review ? live.capabilities.approve : live.capabilities.update)) && !live?.pending && !live?.uncertain;
  return <FormDialog open title={live ? review ? "Revisar designación" : "Proponer designación" : review ? "Revisar designación · Simulación" : "Proponer designación · Simulación"}
    description={live ? "Revisa el contexto y los motivos. La propuesta no publica ni concede acceso; la aprobación requiere permiso de Comisión." : "Partido, presentación y disponibilidad sintéticos. Ninguna acción envía información al servidor."}
    dirty={!review && !!(matchId || refereeId)} pending={live?.pending} uncertain={live?.uncertain} onClose={onClose}
    footer={<>
      {review && !revoked && <button type="button" disabled={!!live && (!live.capabilities.approve || live.pending || live.uncertain)} className="min-h-12 rounded-xl border border-danger px-4 py-3 text-sm font-semibold text-danger disabled:opacity-50" onClick={() => onConfirm({ matchId, refereeId, status: "REVOKED" })}>{live ? "Revocar designación" : "Simular revocación"}</button>}
      {(!review || assignment.status === "PROPOSED") && <button type="button" disabled={!eligible} aria-describedby="assignment-assessment"
        className="primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50"
        onClick={() => onConfirm({ matchId, refereeId, status: review ? "APPROVED" : "PROPOSED" })}>{live ? review ? "Aprobar designación" : "Enviar propuesta" : review ? "Simular aprobación" : "Simular propuesta"}</button>}
    </>}>
    <div className="space-y-5">
      {assignment && <p className="font-semibold">Estado: {assignmentLabels[assignment.status]}</p>}
      <div><label htmlFor="assignment-match" className="mb-2 block text-sm font-semibold">Partido</label>
        <SelectField id="assignment-match" value={matchId} onValueChange={setMatchId} disabled={review}
          options={data.matches.filter(item => item.seasonId === seasonId).map(item => ({ value: item.id, label: `${item.number} · ${item.home} – ${item.away}`, description: `${item.category} · Grupo ${item.group}` }))} /></div>
      {match && <div className="space-y-2 rounded-xl border border-border bg-background p-4 text-sm">
        <p>{data.seasons.find(item => item.id === match.seasonId)?.name} · {match.category} · Grupo {match.group}</p>
        <p>{intervalLabel(match.startsAt, match.endsAt, timezone)} · {timezone}</p><p>{match.venue}</p>
        <p><strong>Equipos del grupo completo:</strong> {match.groupClubs.map(item => item.team).join(", ")}</p>
        {match.group === "Único" && <p className="text-danger">{live ? "Grupo único: se aplica la misma restricción cuando el club que presenta participa en el grupo. No existe una excepción automática." : "Grupo único: todos los clubes de este ejemplo están representados. La restricción por club bloquea a sus árbitros. Criterio pendiente de acuerdo; no se aplica una excepción automática."}</p>}
      </div>}
      <div><label htmlFor="assignment-referee" className="mb-2 block text-sm font-semibold">Árbitro presentado en la temporada</label>
        <SelectField id="assignment-referee" value={refereeId} onValueChange={setRefereeId} disabled={review}
          options={data.referees.filter(item => data.links.some(link => link.refereeId === item.id && link.seasonId === seasonId)).map(item => ({ value: item.id, label: assignment?.historical && assignment.refereeId===item.id ? assignment.displayName ?? "Identidad histórica no disponible" : item.name, description: `${item.active ? "Activo" : "Inactivo"} · ${data.clubs.find(club => club.id === data.links.find(link => link.refereeId === item.id && link.seasonId === seasonId)?.clubId)?.name}` }))} /></div>
      <div id="assignment-assessment"><Assessment assessment={assessment} live={!!live} /></div>
      {revoked && <p className="text-sm text-muted">Antecedente revocado. Se conserva en el historial; una nueva propuesta sería una designación independiente.</p>}
      {live ? <OperationFields live={live} /> : <p className="text-sm text-muted">La evaluación es una simulación visual. La seguridad futura debe verificarse otra vez en servidor al proponer, aprobar o revocar, aunque el botón aparezca habilitado.</p>}
    </div>
  </FormDialog>;
}
