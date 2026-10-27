import assert from 'node:assert/strict';
import test from 'node:test';
import { rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { previewCommand, previewOwnerConnection } from './connection.mjs';
import { PREVIEW_PROJECT } from './runtime-plan.mjs';

const certificate = rootCertificates.find(pem => {
  const cert = new X509Certificate(pem);
  return cert.ca && Date.parse(cert.validFrom) < Date.now() && Date.parse(cert.validTo) > Date.now();
});
const url = `postgresql://postgres.${PREVIEW_PROJECT}:synthetic-password@aws-0-us-east-1.pooler.supabase.com:5432/postgres`;
const caPath = 'C:/fixture/ca.crt';
test('Preview fija proyecto de pruebas, propietario, puerto de sesión y TLS estricto', () => {
  const target = previewOwnerConnection(url + '?host=evil.example&sslaccept=accept_invalid_certs', caPath, certificate);
  assert.equal(target.username, `postgres.${PREVIEW_PROJECT}`);
  assert.equal(target.searchParams.get('sslaccept'), 'strict');
  assert.equal(target.searchParams.get('sslmode'), 'require');
  assert.equal(target.searchParams.get('sslcert'), caPath);
  assert.equal(target.searchParams.has('host'), false);
  assert.equal(previewOwnerConnection(`postgresql://postgres:synthetic@db.${PREVIEW_PROJECT}.supabase.co:5432/postgres`, caPath, certificate).hostname,
    `db.${PREVIEW_PROJECT}.supabase.co`);
});
test('Preview rechaza producción, runtime, otro host/puerto/usuario/base y CA inválida', () => {
  for (const raw of [undefined, url.replace(PREVIEW_PROJECT, 'abcdefghijklmnopqrst'), url.replace(`postgres.${PREVIEW_PROJECT}`, 'gestor_ligas_preview'),
    url.replace(':5432', ':6543'), url.replace('aws-0-us-east-1.pooler.supabase.com', 'evil.example'),
    url.replace('/postgres', '/otra'), 'postgresql://postgres:synthetic@localhost:5433/gestor_ligas_dev'])
    assert.throws(() => previewOwnerConnection(raw, caPath, certificate));
  assert.throws(() => previewOwnerConnection(url, caPath, 'no-es-certificado'), /Certificado/);
});
test('ninguna escritura remota sin verbo y confirmación explícita del proyecto de pruebas', () => {
  assert.equal(previewCommand(['check']), 'check');
  for (const verb of ['migrate', 'provision']) {
    assert.equal(previewCommand([verb, '--apply', PREVIEW_PROJECT]), verb);
    for (const args of [[verb], [verb, '--apply'], [verb, '--apply', 'production'], [verb, '--apply', PREVIEW_PROJECT, 'extra']])
      assert.throws(() => previewCommand(args));
  }
  assert.throws(() => previewCommand([]));
});
