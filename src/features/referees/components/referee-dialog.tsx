"use client";

import { useState, type FormEvent } from "react";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import type { RefereePresentation, RefereePreviewData, LiveRefereeControls } from "../types";
import { OperationFields } from "./operation-fields";

export function RefereeDialog({ data, seasonId, referee, onClose, onConfirm, live }: {
  data: RefereePreviewData; seasonId: string; referee?: RefereePresentation;
  onClose: () => void;
  onConfirm: (value: { personId: string; clubId: string; active: boolean }) => void;
  live?: LiveRefereeControls;
}) {
  const existingLink = data.links.find(item => item.refereeId === referee?.id && item.seasonId === seasonId);
  const [personId, setPersonId] = useState(referee?.personId ?? "");
  const [clubId, setClubId] = useState(existingLink?.clubId ?? "");
  const [active, setActive] = useState(referee?.active ?? true);
  const [error, setError] = useState("");
  const dirty = personId !== (referee?.personId ?? "") || clubId !== (existingLink?.clubId ?? "") || active !== (referee?.active ?? true);
  const season = data.seasons.find(item => item.id === seasonId)!;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!personId || !clubId) { setError("Selecciona una persona existente y el club que la presenta."); return; }
    const registered = data.referees.find(item => item.personId === personId);
    if (!referee && registered && data.links.some(item => item.refereeId === registered.id && item.seasonId === seasonId)) {
      setError("Esta persona ya está presentada en la temporada. Edita su registro; no se creará otro árbitro."); return;
    }
    onConfirm({ personId, clubId, active });
  }
  return <FormDialog open title={live ? referee ? "Editar árbitro" : "Presentar árbitro" : referee ? "Editar árbitro · Simulación" : "Presentar árbitro · Simulación"}
    description={live ? "Selecciona una persona existente. No se crean personas, cuentas ni permisos." : "Selecciona una persona del catálogo sintético. No se crean personas, cuentas ni permisos."}
    dirty={dirty} pending={live?.pending} uncertain={live?.uncertain} onClose={onClose} footer={<button type="submit" disabled={live?.pending || live?.uncertain} form="referee-preview-form" className="primary-action min-h-12 rounded-xl px-5 py-3 text-sm font-semibold disabled:opacity-50">{live ? "Confirmar registro" : "Aplicar a la demo"}</button>}>
    <form id="referee-preview-form" onSubmit={submit} className="space-y-5">
      <fieldset disabled={live?.pending||live?.uncertain} className="space-y-5">
      <p className="rounded-xl border border-border bg-background p-3 text-sm">{season.name}. La relación es un club por árbitro y temporada.</p>
      <div><label htmlFor="referee-person" className="mb-2 block text-sm font-semibold">Persona existente</label>
        <SelectField id="referee-person" name="personId" required value={personId} disabled={!!referee}
          onValueChange={value => { setPersonId(value); setError(""); const current = data.referees.find(item => item.personId === value); setActive(current?.active ?? true); }}
          options={data.people.map(person => ({ value: person.id, label: person.label, description: person.reference }))} /></div>
      <div><label htmlFor="referee-club" className="mb-2 block text-sm font-semibold">Club que presenta</label>
        <SelectField id="referee-club" name="clubId" required value={clubId} disabled={!!live&&!!existingLink} onValueChange={value => { setClubId(value); setError(""); }}
          options={data.clubs.filter(club => club.seasonId === seasonId).map(club => ({ value: club.id, label: club.name, description: club.code,disabled:club.eligible===false }))} /></div>
      {live&&existingLink&&<p className="text-sm text-muted">El club que presentó al árbitro no se sustituye en esta temporada.</p>}
      <div><label htmlFor="referee-active" className="mb-2 block text-sm font-semibold">Estado del árbitro</label>
        <SelectField id="referee-active" name="active" value={active ? "active" : "inactive"} onValueChange={value => setActive(value === "active")} searchable={false}
          options={[{ value: "active", label: "Activo" }, { value: "inactive", label: "Inactivo" }]} aria-describedby="referee-state-help" />
        <p id="referee-state-help" className="mt-2 text-sm text-muted">El estado corresponde al padrón, no a una designación. Desactivar no borra antecedentes ni revoca designaciones automáticamente.</p></div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </fieldset>{live ? <OperationFields live={live} /> : <p className="text-sm text-muted">Los cambios viven solo en esta vista. Al recargar o salir se pierde la captura; no es un borrador guardado.</p>}
    </form>
  </FormDialog>;
}
