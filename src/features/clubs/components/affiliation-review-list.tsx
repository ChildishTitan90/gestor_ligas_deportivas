import { ActionLink } from "@/components/ui/action-link";

export type AffiliationReviewItem = {
  id: string; referenceNumber: string; clubName: string; seasonName: string;
  status: "PENDING" | "APPROVED";
  reviewPhase: "AWAITING_REVIEW" | "CORRECTIONS_REQUESTED" | null;
  detailHref: string;
};
type Props = { items: readonly AffiliationReviewItem[]; onSelect?: (id: string) => void; disabled?: boolean; status?: "PENDING" | "APPROVED" };
const phase = (item: AffiliationReviewItem) => item.reviewPhase === "AWAITING_REVIEW" ? "Por revisar" : item.reviewPhase === "CORRECTIONS_REQUESTED" ? "Correcciones solicitadas" : "No aplica";

function Status({ item }: { item: AffiliationReviewItem }) {
  return <span className="inline-flex rounded-full border px-3 py-1 text-xs font-semibold"
    style={item.status === "APPROVED" ? { color: "var(--positive)", background: "var(--positive-surface)", borderColor: "var(--positive)" } :
      { color: "var(--primary)", background: "var(--soft)", borderColor: "var(--accent)" }}>
    {item.status === "APPROVED" ? "Aprobada" : "Pendiente"}
  </span>;
}

export function AffiliationReviewList({ items, onSelect, disabled = false, status = "PENDING" }: Props) {
  const label = status === "APPROVED" ? "Afiliaciones aprobadas" : "Solicitudes pendientes de afiliación";
  function action(item: AffiliationReviewItem) {
    const text = item.status === "PENDING" ? "Revisar" : "Ver detalle";
    const name = `${text} de ${item.clubName}, folio ${item.referenceNumber}`;
    return onSelect ? <button type="button" disabled={disabled} onClick={() => onSelect(item.id)} aria-label={name}
      className="min-h-11 w-full rounded-xl border border-border bg-surface px-5 py-2.5 text-sm font-semibold text-primary hover:bg-soft disabled:opacity-50 lg:w-auto">{text}</button> :
      <ActionLink href={item.detailHref} variant="secondary" aria-label={name}>{text}</ActionLink>;
  }
  if (!items.length) return <div className="rounded-2xl border border-border bg-surface p-6">
    <p className="font-medium text-primary">{status === "APPROVED" ? "No hay afiliaciones aprobadas en esta consulta." : "No hay solicitudes pendientes de revisión."}</p>
    <p className="mt-2 text-sm leading-6 text-muted">Prueba otra búsqueda o limpia los filtros del ámbito consultado.</p>
  </div>;

  return <>
    <div className="hidden overflow-x-auto rounded-2xl border border-border bg-surface lg:flex">
      <table aria-label={label} className="w-full text-left text-sm">
        <thead className="border-b border-border bg-soft text-xs text-muted uppercase"><tr>
          {["Folio", "Club", "Temporada", "Estado", "Fase de revisión", "Acción"].map(column => <th key={column} scope="col" className="px-4 py-4 font-semibold">{column}</th>)}
        </tr></thead>
        <tbody>{items.map(item => <tr key={item.id} className="border-b border-border last:border-b-0">
          <td className="px-4 py-4 font-semibold text-primary">{item.referenceNumber}</td>
          <td className="px-4 py-4">{item.clubName}</td>
          <td className="px-4 py-4 text-muted">{item.seasonName}</td>
          <td className="px-4 py-4"><Status item={item} /></td>
          <td className="px-4 py-4 text-xs text-muted">{phase(item)}</td>
          <td className="px-4 py-4">{action(item)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <ul aria-label={label} className="space-y-4 lg:hidden">{items.map(item => <li key={item.id} className="space-y-3 rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="wrap-break-word font-semibold text-primary">{item.referenceNumber}</p><Status item={item} />
      </div>
      <h3 className="wrap-break-word text-lg font-semibold text-primary">{item.clubName}</h3>
      <p className="text-sm leading-6 text-muted">{item.seasonName} · {phase(item)}</p>
      {action(item)}
    </li>)}</ul>
  </>;
}
