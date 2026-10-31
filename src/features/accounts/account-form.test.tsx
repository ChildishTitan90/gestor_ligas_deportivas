import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AccountForm } from "./components/account-form";

test("formulario inicial muestra datos requeridos, contraseña oculta y roles autorizados", () => {
  const html = renderToStaticMarkup(<AccountForm options={{ roles: [{ code: "SECRETARY", name: "Secretaría autorizada" }], leagues: [], clubs: [] }} canReusePerson={false} createClubLeagues={[]} />);
  assert.match(html, /Secretaría autorizada/);
  assert.match(html, /type="password"/);
  assert.match(html, /autoComplete="new-password"/);
  assert.match(html, /Nombre de usuario/);
  assert.match(html, /Correo electrónico/);
  assert.doesNotMatch(html, /UUID de persona|value="SUPERADMIN"|value="CLUB_DELEGATE"/);
  assert.match(html, /type="submit" disabled=""/);
});

test("sin roles ofrece estado vacío y mantiene envío bloqueado", () => {
  const html = renderToStaticMarkup(<AccountForm options={{ roles: [], leagues: [], clubs: [] }} canReusePerson={true} createClubLeagues={[]} />);
  assert.match(html, /No hay roles disponibles/);
  assert.match(html, /role="combobox"/);
  assert.match(html, /value="Registrar persona"/);
  assert.match(html, /type="submit" disabled=""/);
});
