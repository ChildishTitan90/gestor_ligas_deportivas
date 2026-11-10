import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ManagementDashboard } from "./components/management-dashboard";
import type { DashboardActivity } from "./server/dashboard-queries";
import { parseDashboardContext } from "../clubs/dashboard";

const id = "63000000-0000-4000-8000-000000000001";
const activity: DashboardActivity = { state: "ready", summary: null, selected: "", nextClubAfter: null,
  options: [{ value: `club:${id}`, label: "Club · Club sintético" }] };
const render = (overrides: Partial<Parameters<typeof ManagementDashboard>[0]> = {}) => renderToStaticMarkup(
  <ManagementDashboard account={{ username: "prueba", roleNames: ["Secretario", "Delegado"] }} scopes={[]}
    navigation={[{ label: "General", items: [{ href: "/access", label: "Mi panel", icon: "overview" }] }]}
    activity={activity} {...overrides} />,
);

test("el panel conserva identidad segura y no selecciona un contexto automáticamente", () => {
  const html = render();
  for (const text of ["@prueba", "Secretario", "Delegado", "Selecciona el contexto", "No tienes herramientas"])
    assert.ok(html.includes(text));
  assert.doesNotMatch(html, /Indicadores del contexto seleccionado/);
  assert.match(html, /type="hidden"[^>]*name="context"[^>]*value=""/);
});

test("las tarjetas incluyen exactamente los destinos habilitados para perfiles combinados", () => {
  const html = render({ navigation: [{ label: "Herramientas", items: [
    { href: "/affiliations/new", label: "Afiliación", icon: "affiliations" },
    { href: "/teams/registrations", label: "Equipos", icon: "teams" },
  ] }] });
  assert.match(html, /href="\/affiliations\/new"/);
  assert.match(html, /href="\/teams\/registrations"/);
  assert.doesNotMatch(html, /href="\/(?:accounts\/new|affiliations\/review)"/);
});

test("los ceros son datos reales y se diferencian de un resumen todavía no elegido", () => {
  const html = render({ activity: { ...activity, selected: `club:${id}`, summary: {
    context: { kind: "club", id }, name: "Club sintético", awaitingReview: 0, correctionsRequested: 0, approved: 0, enrollments: 0,
  } } });
  assert.match(html, /Indicadores del contexto seleccionado/);
  assert.match(html, /No hay afiliaciones pendientes ni aprobadas, ni inscripciones registradas/);
  assert.match(html, /Todas las temporadas/);
  assert.equal((html.match(/tabular-nums">0</g) ?? []).length, 4);
});

test("fallos y denegación no aparentan ceros ni eliminan las herramientas", () => {
  for (const state of ["invalid", "denied", "unavailable"] as const) {
    const html = render({ activity: { ...activity, state }, navigation: [{ label: "Cuentas", items: [
      { href: "/accounts/new", label: "Crear cuenta", icon: "accounts" },
    ] }] });
    assert.match(html, /role="alert"/);
    assert.match(html, /Reintentar resumen/);
    assert.match(html, /href="\/accounts\/new"/);
    assert.doesNotMatch(html, /tabular-nums/);
  }
});

test("la paginación de clubes mantiene la selección y permite volver al inicio", () => {
  const html = render({ activity: { ...activity, nextClubAfter: id, selected: `club:${id}` } });
  assert.match(html, /Ver más clubes/);
  assert.ok(html.includes(`clubAfter=${id}`) && html.includes(`context=club%3A${id}`));
  assert.match(html, /Limpiar selección/);
});

test("la selección valida tipo, UUID y valores múltiples sin interpretar autoridad del cliente", () => {
  assert.deepEqual(parseDashboardContext(`club:${id}`), { kind: "club", id });
  assert.deepEqual(parseDashboardContext(`league:${id}`), { kind: "league", id });
  for (const value of [undefined, "", "club:incorrecto", `league:${id}:extra`, [`club:${id}`], `user:${id}`])
    assert.equal(parseDashboardContext(value), null);
});
