import { pendingReasonMessages } from "../pending-encounters";

export function PendingReasons({ factors }: { factors?: string[] }) {
  if (!factors?.length) return <p className="text-sm">No se registró un motivo. Revisa la disponibilidad y la autorización de las canchas para asignar una.</p>;
  return <div className="text-sm"><p>Motivos registrados para este pendiente:</p><ul className="list-disc pl-5">
    {factors.map(reason => <li key={reason}>{pendingReasonMessages[reason] ?? "Revisa las restricciones de la jornada."}</li>)}
  </ul><p>Revisa la cancha y el horario disponibles antes de guardar el ajuste.</p></div>;
}
