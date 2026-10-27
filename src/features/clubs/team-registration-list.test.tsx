import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamRegistrationList } from "./components/team-registration-list";
import type { TeamRegistrationItem, TeamRegistrationStatus } from "./team-registration-model";

// Datos sintéticos exclusivos de pruebas. Ninguna página real importa este archivo.
const fixture: TeamRegistrationItem = {
  teamId: "63000000-0000-4000-8000-000000000001",
  seasonTeamId: "63000000-0000-4000-8000-000000000002",
  teamName: "Equipo sintético A", seasonName: "Temporada de prueba 2026",
  categoryName: "Categoría sintética", groupName: "Grupo de prueba A", status: "REGISTERED",
};
const render = (items: readonly TeamRegistrationItem[]) => renderToStaticMarkup(<TeamRegistrationList items={items} />);

test("lista muestra equipo, temporada, categoría, grupo e identidades diferenciadas", () => {
  const html = render([fixture]);
  assert.match(html, /aria-label="Inscripciones de equipos"/);
  for (const value of [fixture.teamName, fixture.seasonName, fixture.categoryName, fixture.groupName,
    fixture.teamId, fixture.seasonTeamId, "Identificador del equipo", "Identificador de inscripción"]) {
    assert.ok(html.includes(value));
  }
  assert.match(html, /Estado: /);
  assert.match(html, />Inscrito</);
  assert.doesNotMatch(html, />Activo</);
});

test("sin inscripciones muestra un vacío de consulta y no equipos ficticios", () => {
  const html = render([]);
  assert.match(html, /No hay inscripciones de equipos para la consulta seleccionada/);
  assert.doesNotMatch(html, /<li|Equipo sintético|<button|<a\b/);
});

test("conserva dos inscripciones del mismo equipo en temporadas distintas", () => {
  const previous: TeamRegistrationItem = { ...fixture,
    seasonTeamId: "63000000-0000-4000-8000-000000000003",
    seasonName: "Temporada de prueba 2025", groupName: "Grupo histórico B", status: "WITHDRAWN" };
  const html = render([previous, fixture]);
  assert.equal((html.match(/<li\b/g) ?? []).length, 2);
  assert.equal(html.split(fixture.teamId).length - 1, 2);
  for (const value of [previous.seasonTeamId, fixture.seasonTeamId, previous.seasonName, fixture.seasonName,
    previous.groupName, fixture.groupName]) assert.ok(html.includes(value));
  assert.match(html, />Retirado</);
  assert.match(html, />Inscrito</);
});

test("muestra varias inscripciones de equipos diferentes en la misma temporada", () => {
  const other = { ...fixture, teamId: "63000000-0000-4000-8000-000000000004",
    seasonTeamId: "63000000-0000-4000-8000-000000000005", teamName: "Equipo sintético B" };
  const html = render([fixture, other]);
  assert.equal((html.match(/<li\b/g) ?? []).length, 2);
  assert.ok(html.includes(fixture.teamName)); assert.ok(html.includes(other.teamName));
  assert.equal(html.split(fixture.seasonName).length - 1, 2);
});

test("presenta los tres estados existentes sin controles de activación, baja o edición", () => {
  for (const [status, label] of [["REGISTERED", "Inscrito"], ["ACTIVE", "Activo"], ["WITHDRAWN", "Retirado"]] as const satisfies readonly (readonly [TeamRegistrationStatus, string])[]) {
    const html = render([{ ...fixture, status }]);
    assert.ok(html.includes(`>${label}</`));
    assert.doesNotMatch(html, /<button|<a\b|<form|Activar|Dar de baja|Editar/);
  }
});
