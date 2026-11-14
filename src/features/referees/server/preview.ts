import "server-only";
import { notFound } from "next/navigation";
import { requireOperationalUser } from "@/server/auth/session";

/** La demostración no concede permisos de arbitraje. Solo muestra datos sintéticos
 * a cuentas operativas autenticadas en desarrollo. No hay entrada de escritura. */
export async function getRefereePreview() {
  if (process.env.NODE_ENV !== "development") notFound();
  await requireOperationalUser();
  const { refereePreviewData } = await import("../preview-data");
  return refereePreviewData;
}
