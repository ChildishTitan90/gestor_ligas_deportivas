import { ActionLink } from "@/components/ui/action-link";
import { canAccessAffiliationCapture } from "../server/affiliation-form-queries";

export async function AffiliationCaptureLink() {
  let allowed = false;
  try {
    allowed = await canAccessAffiliationCapture();
  } catch { /* La navegación no concede permisos ni bloquea el resto del panel. */ }
  return allowed ? <ActionLink href="/affiliations/new" variant="secondary" className="mt-3 w-full">Mis solicitudes de afiliación</ActionLink> : null;
}
