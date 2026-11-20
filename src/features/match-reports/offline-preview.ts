import { createReportDemo, REPORT_DEMO_MATCH_ID } from "./demo-data";

export const offlinePreviewPath = "/matches/offline-preview";
export const offlinePreviewReportPath = `${offlinePreviewPath}/${REPORT_DEMO_MATCH_ID}`;

export const downloadCases = [
  { value: "prepare", label: "Preparar partido" },
  { value: "incomplete", label: "Descarga incompleta" },
  { value: "space", label: "Espacio insuficiente" },
] as const;

export const captureCases = [
  { value: "ready", label: "Abrir partido preparado" },
  { value: "offline", label: "Capturar sin red y retomar" },
  { value: "pending", label: "Borrador pendiente de sincronizar" },
  { value: "storage", label: "Sin espacio para guardar el borrador" },
  { value: "session", label: "Sesión vencida" },
  { value: "conflict", label: "Conflicto de versiones" },
  { value: "uncertain", label: "Respuesta del servidor perdida" },
  { value: "receipt", label: "Acuse de borrador" },
  { value: "confirmed", label: "Confirmación oficial simulada" },
] as const;

export type PreviewDownloadCase = (typeof downloadCases)[number]["value"];
export type PreviewCaptureCase = (typeof captureCases)[number]["value"];

export function createOfflineCapturePreview(scenario: PreviewCaptureCase) {
  return createReportDemo(scenario === "conflict" ? "stale" : scenario === "uncertain" ? "uncertain" : scenario === "confirmed" ? "confirmed" : "draft");
}
