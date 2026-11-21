import { pendingReasonMessages } from "../pending-encounters";

export function PendingReasons({ factors }: { factors?: string[] }) {
  if (!factors?.length) return <p className="text-sm">No se registró un motivo. Revisa la disponibilidad y la autorización de las canchas para asignar una.</p>;
  return <div className="text-sm"><p>Motivos detectados al generar:</p><ul className="list-disc pl-5">
    {factors.map(reason => <li key={reason}>{pendingReasonMessages[reason] ?? "Revisa las restricciones de la jornada."}</li>)}
  </ul></div>;
}
