type ProposalStatusCode = "DRAFT" | "IN_REVIEW" | "APPROVED";

export function ProposalStatus({ status, pendingCount, canEdit }: { status: string; pendingCount: number; canEdit: boolean }) {
  const descriptions: Record<ProposalStatusCode, string> = {
    DRAFT: canEdit ? "Puedes ajustar los encuentros y enviar la propuesta a revisión cuando esté lista." : "La propuesta está en preparación y aún no se ha enviado a revisión.",
    IN_REVIEW: "La propuesta espera la decisión de la autoridad de la liga. Si necesita cambios, puede devolverla a borrador.",
    APPROVED: "La liga aprobó esta programación para operar. La publicación en el portal público es un paso separado.",
  };
  const description = descriptions[status as ProposalStatusCode];
  if (!description) return null;
  return <div className="mt-4 space-y-2 rounded-xl border border-border bg-background p-4 text-sm" aria-label="Información de la propuesta">
    <p>{description}</p>
    {pendingCount > 0 && <p role="status">{pendingCount === 1 ? "Hay 1 encuentro pendiente de cancha y horario." : `Hay ${pendingCount} encuentros pendientes de cancha y horario.`} {canEdit ? "Abre su jornada y selecciona Ver detalles para asignarlos. Completa todos antes de la aprobación." : "La persona encargada de la programación debe completar esos datos antes de la aprobación."}</p>}
  </div>;
}
