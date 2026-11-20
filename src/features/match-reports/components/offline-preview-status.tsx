import { Check, CheckCheck, FileClock, LoaderCircle, Wifi, WifiOff } from "lucide-react";
import { primaryButton, secondaryButton } from "./report-shared";

export type PreviewDraftStatus = "idle" | "dirty" | "device" | "saving" | "saved" | "error" | "stale" | "uncertain" | "denied" | "session" | "storage" | "confirmed";

const copy: Record<PreviewDraftStatus, [string, string]> = {
  idle: ["Borrador de ejemplo", "Los próximos cambios mostrarán cómo se guardaría un borrador en este dispositivo."],
  dirty: ["Guardando cambios en el dispositivo", "Puedes continuar la captura mientras se simula el guardado."],
  device: ["Guardado en este dispositivo", "Pendiente de sincronizar con el servidor."],
  saving: ["Sincronizando borrador", "Esperando el acuse simulado del servidor."],
  saved: ["Acuse de borrador recibido", "El servidor simulado recibió el avance. La cédula sigue como borrador."],
  error: ["Borrador pendiente de sincronizar", "Puedes reintentar la misma operación cuando tengas conexión."],
  stale: ["Conflicto de versiones", "Compara tu borrador con la referencia antes de continuar."],
  uncertain: ["Sin acuse de borrador", "Consulta si se aplicó la operación antes de reenviarla."],
  denied: ["Acceso denegado", "La captura permanece en esta página mientras revisas el permiso."],
  session: ["Sesión vencida", "Tu borrador sigue aquí. Inicia sesión de nuevo para habilitar la sincronización."],
  storage: ["Espacio insuficiente para guardar", "Los últimos cambios siguen en esta página. Libera espacio y reintenta el guardado antes de salir."],
  confirmed: ["Confirmación oficial", "Cédula cerrada y disponible para consulta en este ejemplo."],
};

export function previewDraftLabel(status: PreviewDraftStatus) {
  return copy[status][0];
}

export function OfflinePreviewStatus({ connected, status, matchNumber, version, retaking, invalidJerseys, onConnection, onLogin, onSync, onRetryStorage, onPause }: {
  connected: boolean;
  status: PreviewDraftStatus;
  matchNumber: string;
  version: number;
  retaking: boolean;
  invalidJerseys: boolean;
  onConnection: () => void;
  onLogin: () => void;
  onSync: () => void;
  onRetryStorage: () => void;
  onPause?: () => void;
}) {
  const busy = status === "dirty" || status === "saving";
  const Icon = busy ? LoaderCircle : status === "confirmed" ? CheckCheck : status === "saved" ? Check : FileClock;
  const NetworkIcon = connected ? Wifi : WifiOff;
  return <section aria-label="Estado offline simulado" className="space-y-4 rounded-2xl border border-border bg-surface p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <p className="font-semibold text-primary">{matchNumber} · {status === "confirmed" ? "Cédula" : "Borrador"} v{version}{retaking && " · Retomado"}</p>
      <p role="status" className="flex items-center gap-2 text-muted"><NetworkIcon size={17} aria-hidden="true" />{connected ? "Con conexión" : "Sin conexión"} · Simulación</p>
    </div>
    <div role="status" aria-atomic="true" className={`flex items-start gap-3 rounded-xl border p-4 ${status === "confirmed" ? "border-positive bg-positive-surface text-positive" : "border-border bg-soft text-foreground"}`}>
      <Icon size={21} className={`mt-0.5 shrink-0 ${busy ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
      <div><p className="font-semibold">{copy[status][0]} · Simulación</p><p className="mt-1 text-sm leading-6">{copy[status][1]}</p>{status === "device" && !connected && <p className="mt-1 text-sm">Sigue capturando y recupera la conexión para sincronizar.</p>}{status === "device" && invalidJerseys && <p className="mt-1 text-sm">Corrige los dorsales antes de sincronizar.</p>}</div>
    </div>
    <div className="flex flex-col flex-wrap gap-2 sm:flex-row">
      {status === "device" && <button type="button" className={primaryButton} disabled={!connected || invalidJerseys} onClick={onSync}>Sincronizar borrador</button>}
      {status === "session" && <button type="button" className={primaryButton} disabled={!connected} onClick={onLogin}>Simular inicio de sesión</button>}
      {status === "storage" && <button type="button" className={primaryButton} onClick={onRetryStorage}>Reintentar guardado local</button>}
      {status !== "confirmed" && <button type="button" className={secondaryButton} disabled={status === "saving"} onClick={onConnection}>{connected ? "Simular pérdida de red" : "Simular regreso de red"}</button>}
      {onPause && <button type="button" className={secondaryButton} disabled={status === "saving"} onClick={onPause}>Volver a la ficha del partido</button>}
    </div>
  </section>;
}
