"use client";

import { useState } from "react";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import { assessPreview, assignmentLabels, intervalLabel } from "../preview-model";
import type { AssignmentPresentation, AssignmentStatus, RefereePreviewData } from "../types";

export function Assessment({ assessment }: { assessment: ReturnType<typeof assessPreview> }) {
  return <div className="space-y-2 text-sm" aria-live="polite">
    <p className="font-semibold">Disponibilidad: {assessment.availability === "COVERED" ? "cubre el horario" : assessment.availability === "UNAVAILABLE" ? "indisponible" : "sin confirmar"}</p>
    {assessment.blockers.length ? <div className="rounded-xl border border-danger bg-danger-surface p-4 text-danger">
      <p className="font-semibold">No se puede aprobar</p><ul className="mt-2 list-disc space-y-2 pl-5">{assessment.blockers.map((blocker, index) => <li key={`${blocker.code}-${index}`}>{blocker.message}</li>)}</ul>
    </div> : <p className="rounded-xl border border-positive bg-positive-surface p-3 text-positive">Sin bloqueos en el ejemplo. Requiere validación oficial del servidor antes de una aprobación real.</p>}
  </div>;
}

export function AssignmentDialog({ data, seasonId, timezone, assignment, onClose, onConfirm }: {
  data: RefereePreviewData; seasonId: string; timezone: string; assignment?: AssignmentPresentation;
  onClose: () => void;
  onConfirm: (value: { matchId: string; refereeId: string; status: AssignmentStatus }) => void;
}) {
  const [matchId, setMatchId] = useState(assignment?.matchId ?? "");
  const [refereeId, setRefereeId] = useState(assignment?.refereeId ?? "");
  const match = data.matches.find(item => item.id === matchId);
  const assessment = assessPreview(data, matchId, refereeId, assignment?.id);
  const review = !!assignment;
  const revoked = assignment?.status === "REVOKED";
  const eligible = !!match && !!refereeId && !assessment.blockers.length;
  return <FormDialog open title={review ? "Revisar designación · Simulación" : "Proponer designación · Simulación"}
    description="Partido, presentación y disponibilidad sintéticos. Ninguna acción envía información al servidor."
    dirty={!review && !!(matchId || refereeId)} onClose={onClose}
    footer={<>
      {review && !revoked && <button type="button" className="min-h-12 rounded-xl border border-danger px-4 py-3 text-sm font-semibold text-danger" onClick={() => onConfirm({ matchId, refereeId, status: "REVOKED" })}>Simular revocación</button>}
      {(!review || assignment.status === "PROPOSED") && <button type="button" disabled={!eligible} aria-describedby="assignment-assessment"
        className="primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50"
        onClick={() => onConfirm({ matchId, refereeId, status: review ? "APPROVED" : "PROPOSED" })}>{review ? "Simular aprobación" : "Simular propuesta"}</button>}
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
        {match.group === "Único" && <p className="text-danger">Grupo único: todos los clubes de este ejemplo están representados. La restricción por club bloquea a sus árbitros. Criterio pendiente de acuerdo; no se aplica una excepción automática.</p>}
      </div>}
      <div><label htmlFor="assignment-referee" className="mb-2 block text-sm font-semibold">Árbitro presentado en la temporada</label>
        <SelectField id="assignment-referee" value={refereeId} onValueChange={setRefereeId} disabled={review}
          options={data.referees.filter(item => data.links.some(link => link.refereeId === item.id && link.seasonId === seasonId)).map(item => ({ value: item.id, label: item.name, description: `${item.active ? "Activo" : "Inactivo"} · ${data.clubs.find(club => club.id === data.links.find(link => link.refereeId === item.id && link.seasonId === seasonId)?.clubId)?.name}` }))} /></div>
      <div id="assignment-assessment"><Assessment assessment={assessment} /></div>
      {revoked && <p className="text-sm text-muted">Antecedente revocado. Se conserva en el historial; una nueva propuesta sería una designación independiente.</p>}
      <p className="text-sm text-muted">La evaluación es una simulación visual. La seguridad futura debe verificarse otra vez en servidor al proponer, aprobar o revocar, aunque el botón aparezca habilitado.</p>
    </div>
  </FormDialog>;
}
