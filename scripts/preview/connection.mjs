import { X509Certificate } from 'node:crypto';
import { productionConnection } from '../ci/migration-helpers.mjs';
import { PREVIEW_PROJECT } from './runtime-plan.mjs';

export const DEFAULT_PREVIEW_CA = 'C:/Users/victo/Downloads/supabase-pruebas-ca.crt.crt';

export function previewOwnerConnection(rawUrl, certificatePath, certificate) {
  // Nunca inferir el proyecto desde una URL ni reutilizar DATABASE_URL/DIRECT_URL.
  let cert;
  try { cert = new X509Certificate(certificate); } catch { throw new Error('Certificado CA de pruebas no válido.'); }
  if (!cert.ca || Date.now() < Date.parse(cert.validFrom) || Date.now() > Date.parse(cert.validTo))
    throw new Error('El certificado CA de pruebas debe ser válido y vigente.');
  return productionConnection(rawUrl, PREVIEW_PROJECT, certificatePath);
}

export function previewCommand(args) {
  if (args.length === 1 && args[0] === 'check') return 'check';
  if (args.length === 3 && ['migrate', 'provision'].includes(args[0]) && args[1] === '--apply' && args[2] === PREVIEW_PROJECT)
    return args[0];
  throw new Error(`Uso: check | migrate --apply ${PREVIEW_PROJECT} | provision --apply ${PREVIEW_PROJECT}`);
}
