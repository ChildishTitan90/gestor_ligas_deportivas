import { ActionLink } from "@/components/ui/action-link";

export type AffiliationReviewItem = {
  id: string;
  referenceNumber: string;
  clubName: string;
  seasonName: string;
  status: "PENDING" | "APPROVED";
  reviewPhase: "AWAITING_REVIEW" | "CORRECTIONS_REQUESTED" | null;
  detailHref: string;
};

type AffiliationReviewListProps = {
  items: readonly AffiliationReviewItem[];
  onSelect?: (id: string) => void;
  disabled?: boolean;
  status?: "PENDING" | "APPROVED";
};

const phaseLabels = {
  AWAITING_REVIEW: "Pendiente de revisión",
  CORRECTIONS_REQUESTED: "Correcciones solicitadas",
} satisfies Record<Exclude<AffiliationReviewItem["reviewPhase"], null>, string>;

export function AffiliationReviewList({
  items, onSelect, disabled = false, status = "PENDING",
}: AffiliationReviewListProps) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-surface p-6">
        <p className="font-medium text-primary">
          {status === "APPROVED" ? "No hay afiliaciones aprobadas en esta consulta." : "No hay solicitudes pendientes de revisión."}
        </p>
        <p className="mt-2 text-sm leading-6 text-muted">
          Aquí aparecerán las solicitudes del ámbito consultado.
        </p>
      </div>
    );
  }

  return (
    <ul aria-label={status === "APPROVED" ? "Afiliaciones aprobadas" : "Solicitudes pendientes de afiliación"} className="space-y-4">
      {items.map((item) => (
        <li
          key={item.id}
          className="rounded-2xl border border-border bg-surface p-5 sm:p-6"
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 flex-1">
              <h2 className="wrap-break-word text-lg font-semibold text-primary">
                {item.clubName}
              </h2>

              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted">Folio</dt>
                  <dd className="mt-1 wrap-break-word font-medium">
                    {item.referenceNumber}
                  </dd>
                </div>

                <div className="min-w-0">
                  <dt className="text-muted">Temporada</dt>
                  <dd className="mt-1 wrap-break-word">{item.seasonName}</dd>
                </div>

                <div>
                  <dt className="text-muted">Estado de aprobación</dt>
                  <dd className="mt-1">{item.status === "APPROVED" ? "Aprobada" : "Pendiente"}</dd>
                </div>

                <div>
                  <dt className="text-muted">Fase de revisión</dt>
                  <dd className="mt-1">
                    <span className="inline-block rounded-lg bg-soft px-3 py-1 font-medium text-primary">
                      {item.reviewPhase ? phaseLabels[item.reviewPhase] : "No aplica"}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>

            {onSelect ? <button type="button" disabled={disabled} onClick={() => onSelect(item.id)}
              aria-label={`Ver detalle de ${item.clubName}, folio ${item.referenceNumber}`}
              className="min-h-12 rounded-xl border border-border px-5 py-3 text-sm font-semibold text-primary disabled:opacity-50">
              Ver detalle
            </button> : <ActionLink
              href={item.detailHref}
              variant="secondary"
              aria-label={`Ver detalle de ${item.clubName}, folio ${item.referenceNumber}`}
              className="w-full shrink-0 sm:w-auto"
            >
              Ver detalle
            </ActionLink>}
          </div>
        </li>
      ))}
    </ul>
  );
}
