"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { administrativeStatus, effectiveStatus, maintenanceErrors, type MaintenanceRow } from "../maintenance";
import { maintainClubOrTeamAction, maintenanceHistoryAction } from "../maintenance-actions";

const button = "min-h-12 rounded-xl border border-border px-4 py-2 text-sm font-semibold text-primary disabled:opacity-50";
const field = "min-h-12 w-full rounded-xl border border-border bg-surface px-3 py-2 text-foreground";
export function MaintenanceList({ items }: { items: MaintenanceRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<MaintenanceRow | null>(null);
  const [operation, setOperation] = useState<"edit" | "deactivate" | "reactivate" | "delete" | "detail">("detail");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [pending, startTransition] = useTransition();
  const [history, setHistory] = useState<{ id: string; date: string; reason: string }[]>([]);
  const [historyMessage, setHistoryMessage] = useState("");
  function open(row: MaintenanceRow, action: typeof operation) {
    setSelected(row); setOperation(action); setName(row.name); setReason(""); setConfirmed(false); setError(""); setUncertain(false);
    setHistory([]); setHistoryMessage("");
    if (action === "detail") {
      setHistoryMessage("Consultando historial…");
      startTransition(async () => {
        try {
          const result = await maintenanceHistoryAction(row.kind, row.id);
          setHistory(result.items); setHistoryMessage(result.ok ? result.items.length ? "Últimos 20 cambios administrativos." : "Sin cambios administrativos registrados." : "No se pudo consultar el historial.");
        } catch { setHistoryMessage("No se pudo consultar el historial. Cierra y vuelve a abrir el detalle."); }
      });
    }
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!selected || pending || uncertain) return;
    if (!navigator.onLine) { setError("No hay conexión. Conservamos tu captura; vuelve a intentar cuando se restablezca."); return; }
    startTransition(async () => {
      try {
        const result = await maintainClubOrTeamAction({ kind: selected.kind, id: selected.id, version: selected.version,
          operation, ...(operation === "edit" ? { name } : {}), reason, confirmed });
        if (!result.ok) {
          setError(maintenanceErrors[result.code] ?? maintenanceErrors.UNAVAILABLE);
          if (["UNAVAILABLE", "CONFLICT"].includes(result.code)) setUncertain(true);
          return;
        }
        setSelected(null); setMessage(operation === "delete" ? "Registro eliminado. La auditoría de la operación se conserva." : "Cambio guardado. Se conservaron las inscripciones y el historial."); router.refresh();
      } catch { setError(maintenanceErrors.UNAVAILABLE); setUncertain(true); }
    });
  }
  return <>
    <p role="status" className="my-4 text-sm text-primary">{message}</p>
    {!items.length ? <p className="rounded-2xl border border-border bg-surface p-6">No hay registros para estos filtros.</p> :
      <ul className="grid gap-4">{items.map(row => <li key={row.id} className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="text-lg font-semibold text-primary">{row.name}</h2>
        <p className="break-all text-sm text-muted">{row.reference}</p>
        <p className="mt-2 text-sm">{row.leagueName}{row.kind === "team" ? ` · ${row.clubName}` : ""}</p>
        <p className="my-3 font-medium">{row.kind === "team" ? effectiveStatus(row.status, row.clubStatus) : administrativeStatus(row.status)}</p>
        <div className="flex flex-wrap gap-2">
          <button className={button} onClick={() => open(row, "detail")}>Ver detalle e historial</button>
          {row.canEdit && row.status === "ACTIVE" && row.clubStatus === "ACTIVE" && !row.hasHistory && <button className={button} onClick={() => open(row, "edit")}>Corregir nombre</button>}
          {row.canChangeStatus && ["ACTIVE", "INACTIVE"].includes(row.status) && (row.kind === "club" || row.clubStatus === "ACTIVE") &&
            <button className={button} onClick={() => open(row, row.status === "ACTIVE" ? "deactivate" : "reactivate")}>{row.status === "ACTIVE" ? "Dar de baja temporal" : "Reactivar"}</button>}
          {row.canDelete && <button className={button} onClick={() => open(row, "delete")}>Eliminar definitivamente</button>}
        </div>
        {row.hasHistory && <p className="mt-3 text-sm text-muted">Tiene referencias o historial: el nombre requiere un trámite formal y la eliminación está bloqueada.</p>}
        {row.kind === "team" && row.clubStatus !== "ACTIVE" && <p className="mt-3 text-sm text-muted">Para editar o reactivar este equipo, una autoridad de liga debe reactivar primero el club.</p>}
        {!row.canEdit && !row.canChangeStatus && <p className="mt-3 text-sm text-muted">Tu permiso permite consultar este registro.</p>}
      </li>)}</ul>}
    <FormDialog open={!!selected} title={operation === "detail" ? "Detalle e historial" : operation === "delete" ? "Confirmar eliminación definitiva" : operation === "edit" ? "Corregir nombre" : operation === "deactivate" ? "Confirmar baja temporal" : "Confirmar reactivación"}
      description={selected?.name ?? "Club o equipo"} pending={pending} uncertain={uncertain}
      dirty={operation !== "detail" && (!!reason || name !== selected?.name || confirmed)} onClose={() => setSelected(null)}>
      {selected && <div className="space-y-4">
        {operation === "detail" ? <>
          <dl className="space-y-2"><dt className="font-semibold">Referencia</dt><dd className="break-all">{selected.reference}</dd>
            <dt className="font-semibold">Liga / club</dt><dd>{selected.leagueName} / {selected.clubName}</dd>
            <dt className="font-semibold">Estado administrativo propio</dt><dd>{administrativeStatus(selected.status)}</dd>
            <dt className="font-semibold">Disponibilidad</dt><dd>{selected.kind === "team" ? effectiveStatus(selected.status, selected.clubStatus) : administrativeStatus(selected.status)}</dd></dl>
          {selected.hasHistory && <p>Este registro tiene vínculos históricos. Los cambios de nombre o representación requieren su trámite formal; no se modifican desde esta pantalla.</p>}
          <p>{selected.hasHistory ? "La eliminación está bloqueada por referencias o historial. Usa la baja temporal cuando proceda." : selected.canDelete ? "Puedes eliminar este registro vacío desde su lista. La operación requiere motivo y confirmación." : "No tienes habilitada la eliminación definitiva para este registro."}</p>
          <p role="status">{historyMessage}</p>
          <ol className="space-y-3">{history.map(item => <li key={item.id} className="rounded-xl border border-border p-3"><time dateTime={item.date}>{new Date(item.date).toLocaleString("es-MX")}</time><p>{item.reason}</p></li>)}</ol>
        </> : <form onSubmit={submit} className="space-y-4">
          <p>{operation === "delete" ? "Eliminarás definitivamente este registro. Esta acción no se puede deshacer. El servidor volverá a comprobar que no existan referencias ni historial y conservará una auditoría de la eliminación." : operation === "deactivate" ? selected.kind === "club"
            ? "El club y todos sus equipos quedarán bloqueados para nuevas operaciones. Se conservan afiliaciones, partidos e inscripciones. Esta acción no es una baja deportiva."
            : "El equipo quedará bloqueado para nuevas operaciones. Se conservan sus inscripciones y resultados. Esta acción no es una baja deportiva."
            : operation === "reactivate" ? "Se habilitarán nuevas operaciones, sujetas a los permisos y reglas vigentes. Los equipos con baja individual seguirán inactivos." : "Solo se corrige el nombre de un registro sin historial. No cambia de club, categoría ni grupo."}</p>
          {operation === "edit" && <label className="block" htmlFor="maintenance-name">Nombre<input id="maintenance-name" className={field} minLength={2} maxLength={160} required value={name} disabled={pending || uncertain} onChange={event => setName(event.target.value)} /></label>}
          <label className="block" htmlFor="maintenance-reason">Motivo (sin datos personales)<textarea id="maintenance-reason" className={field} minLength={5} maxLength={500} required value={reason} disabled={pending || uncertain} onChange={event => setReason(event.target.value)} /></label>
          <label className="flex min-h-12 items-center gap-3"><input type="checkbox" required checked={confirmed} disabled={pending || uncertain} onChange={event => setConfirmed(event.target.checked)} />{operation === "delete" ? "Confirmo que deseo eliminar definitivamente este registro." : "Confirmo la operación y sus efectos."}</label>
          {error && <p role="alert">{error}</p>}
          {uncertain ? <button className={button} type="button" onClick={() => { setSelected(null); router.refresh(); }}>Consultar estado actualizado</button> :
            <button type="submit" className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold disabled:opacity-50" disabled={pending}>{pending ? "Guardando…" : "Confirmar y guardar"}</button>}
        </form>}
      </div>}
    </FormDialog>
  </>;
}
