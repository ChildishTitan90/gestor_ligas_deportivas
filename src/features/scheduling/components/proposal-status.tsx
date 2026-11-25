import { ProgressSteps } from "./progress-steps";

type ProposalStatusCode = "DRAFT" | "IN_REVIEW" | "APPROVED";

export function ProposalProgress({ status, generated, awaitingActivation }: {
  status: string;
  generated: boolean;
  awaitingActivation: boolean;
}) {
  if (status !== "DRAFT" && status !== "IN_REVIEW" && status !== "APPROVED") return null;
  const steps = [
    { label: "Borrador", detail: "Prepara y ajusta los encuentros." },
    { label: "En revisión", detail: "La propuesta espera una decisión." },
    { label: "Aprobada", detail: "La liga aprobó la programación." },
  ];
  if (generated) steps.push({
    label: "Registro de partidos",
    detail: awaitingActivation ? "La liga ya aprobó la propuesta. Falta activar los partidos para operar." : "Los partidos de la propuesta quedaron registrados para operación.",
  });
  return <ProgressSteps label="Estado de la propuesta"
    current={status === "DRAFT" ? 0 : status === "IN_REVIEW" ? 1 : awaitingActivation ? 3 : steps.length}
    steps={steps} />;
}

export function ProposalStatus({ status, pendingCount, canEdit, awaitingActivation = false }: {
  status: string;
  pendingCount: number;
  canEdit: boolean;
  awaitingActivation?: boolean;
}) {
  const descriptions: Record<ProposalStatusCode, string> = {
    DRAFT: canEdit ? "Puedes ajustar los encuentros y enviar la propuesta a revisión cuando esté lista." : "La propuesta está en preparación y aún no se ha enviado a revisión.",
    IN_REVIEW: "La propuesta espera la decisión de la autoridad de la liga. Si necesita cambios, puede devolverla a borrador.",
    APPROVED: awaitingActivation
      ? "El PDF conserva la propuesta que aprobó la liga. La activación de los partidos y la publicación en el portal se consultan por separado."
      : "La liga aprobó esta programación para operar. La publicación en el portal público es un paso separado.",
  };
  const description = descriptions[status as ProposalStatusCode];
  if (!description) return null;
  return <div className="mt-4 space-y-2 rounded-xl border border-border bg-background p-4 text-sm" aria-label="Información de la propuesta">
    <p>{description}</p>
    {pendingCount > 0 && <p role="status">{pendingCount === 1 ? "Hay 1 encuentro pendiente de cancha y horario." : `Hay ${pendingCount} encuentros pendientes de cancha y horario.`} {canEdit ? "Abre su jornada y selecciona Ver detalles para asignarlos. Completa todos antes de la aprobación." : "La persona encargada de la programación debe completar esos datos antes de la aprobación."}</p>}
  </div>;
}
