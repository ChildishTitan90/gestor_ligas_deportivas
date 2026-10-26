import assert from "node:assert/strict";
import { isTeamRegistrationPreview, TEAM_REGISTRATION_PREVIEW_PATH } from "../../lib/development-preview";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamRegistrationFormView } from "./components/team-registration-form";
import { createTeamRegistrationFormController, type TeamRegistrationFormController } from "./team-registration-form-controller";
import type { TeamRegistrationFormOptions, TeamRegistrationSubmission, TeamRegistrationResult, TeamRegistrationSubmit } from "./team-registration-model";

// Exclusivamente fixtures de pruebas; no hay páginas reales ni peticiones HTTP.
const options: TeamRegistrationFormOptions = { clubs: [
  { id: "club-a", name: "Club sintético A", seasons: [
    { id: "season-2026", name: "Temporada sintética 2026", canCreateTeam: true,
      teams: [{ id: "team-a", name: "Equipo sintético A" }], categories: [
        { id: "category-a", name: "Categoría sintética A", groups: [{ id: "group-a", name: "Grupo sintético A" }] },
        { id: "category-b", name: "Categoría sintética B", groups: [{ id: "group-b", name: "Grupo sintético B" }] },
      ] },
    { id: "season-2025", name: "Temporada sintética 2025", canCreateTeam: false,
      teams: [{ id: "team-a", name: "Equipo sintético A" }], categories: [
        { id: "category-history", name: "Categoría histórica", groups: [{ id: "group-history", name: "Grupo histórico" }] },
      ] },
  ] },
  { id: "club-b", name: "Club sintético B", seasons: [
    { id: "season-2026", name: "Temporada sintética 2026", canCreateTeam: false,
      teams: [{ id: "team-b", name: "Equipo sintético B" }], categories: [
        { id: "category-b", name: "Categoría sintética B", groups: [{ id: "group-b", name: "Grupo sintético B" }] },
      ] },
  ] },
] };
const confirmed = { kind: "confirmed", teamId: "team-a", seasonTeamId: "enrollment-synthetic", status: "REGISTERED" } as const;
function setup() {
  const calls: TeamRegistrationSubmission[] = [];
  const controller = createTeamRegistrationFormController(options, async capture => { calls.push(capture); return confirmed; });
  return { controller, calls };
}
function chooseScope(controller: TeamRegistrationFormController) {
  controller.change("clubId", "club-a"); controller.change("seasonId", "season-2026");
}
function chooseGroup(controller: TeamRegistrationFormController) {
  controller.change("categoryId", "category-a"); controller.change("groupId", "group-a");
}
function existing(controller: TeamRegistrationFormController) {
  chooseScope(controller); controller.change("teamId", "team-a"); chooseGroup(controller);
}
const render = (controller: TeamRegistrationFormController) => renderToStaticMarkup(<TeamRegistrationFormView controller={controller} />);

test("opciones iniciales: padres obligatorios, sin nombre ni creación sin contexto", () => {
  const { controller } = setup(); const html = render(controller);
  assert.match(html, /Club sintético A/); assert.match(html, /Club sintético B/);
  assert.doesNotMatch(html, /Crear equipo|name="teamName"|value="group-a"/);
  assert.match(html, /no activa el equipo/);
});

test("cambiar club limpia temporada, equipo, categoría y grupo aunque compartan IDs", () => {
  const { controller } = setup(); existing(controller);
  controller.change("clubId", "club-b");
  assert.deepEqual(controller.getSnapshot().draft, { clubId: "club-b", seasonId: "", teamMode: "existing",
    teamId: "", teamName: "", categoryId: "", groupId: "" });
  assert.doesNotMatch(render(controller), /value="team-a"|value="group-a"/);
});

test("cambiar temporada borra grupo y categoría previos y vuelve al modo existente", () => {
  const { controller } = setup(); chooseScope(controller);
  controller.change("teamMode", "new"); controller.change("teamName", "Equipo temporal"); chooseGroup(controller);
  controller.change("seasonId", "season-2025");
  const draft = controller.getSnapshot().draft;
  assert.equal(draft.categoryId, ""); assert.equal(draft.groupId, ""); assert.equal(draft.teamName, "");
  assert.equal(draft.teamMode, "existing");
  assert.doesNotMatch(render(controller), /Crear equipo|name="teamName"|value="group-a"/);
});

test("cambiar categoría limpia el grupo; no admite uno de otra categoría o temporada", async () => {
  const { controller, calls } = setup(); existing(controller);
  controller.change("categoryId", "category-b"); assert.equal(controller.getSnapshot().draft.groupId, "");
  for (const group of ["group-a", "group-history"]) {
    controller.change("groupId", group); await controller.submit();
    assert.equal(controller.getSnapshot().draft.groupId, "");
    assert.ok(controller.getSnapshot().errors.groupId); assert.equal(calls.length, 0);
  }
});

test("captura existente entrega identidad y ámbito sin nombre nuevo ni estado", async () => {
  const { controller, calls } = setup(); existing(controller); await controller.submit();
  assert.deepEqual(calls, [{ clubId: "club-a", seasonId: "season-2026", categoryId: "category-a", groupId: "group-a",
    team: { kind: "existing", id: "team-a" } }]);
  assert.doesNotMatch(render(controller), /name="teamName"/);
});

test("captura nueva exige nombre, muestra errores asociados y entrega solo nombre recortado", async () => {
  const { controller, calls } = setup(); chooseScope(controller);
  assert.match(render(controller), /Crear equipo/);
  controller.change("teamMode", "new"); chooseGroup(controller);
  controller.change("teamName", "   "); await controller.submit();
  assert.equal(calls.length, 0); assert.ok(controller.getSnapshot().errors.teamName);
  const html = render(controller);
  assert.match(html, /name="teamName"/); assert.doesNotMatch(html, /name="teamId"/);
  assert.match(html, /aria-describedby="[^"]+-teamName-error"/);
  assert.match(html, /aria-invalid="true"/); assert.match(html, /Escribe el nombre del equipo/);
  controller.change("teamName", "  Equipo sintético nuevo  "); await controller.submit();
  assert.deepEqual(calls[0].team, { kind: "new", name: "Equipo sintético nuevo" });
});

test("cambiar modo retira los datos del otro modo y limpia categoría/grupo", () => {
  const { controller } = setup(); existing(controller); controller.change("teamMode", "new");
  assert.equal(controller.getSnapshot().draft.teamId, ""); assert.equal(controller.getSnapshot().draft.groupId, "");
  controller.change("teamName", "Nombre residual"); controller.change("teamMode", "existing");
  assert.equal(controller.getSnapshot().draft.teamName, ""); assert.doesNotMatch(render(controller), /Nombre residual/);
});

test("crear equipo depende de la capacidad recibida y se revoca al actualizar opciones", async () => {
  const { controller, calls } = setup(); chooseScope(controller); controller.change("teamMode", "new");
  controller.change("teamName", "Nuevo"); chooseGroup(controller);
  const revoked: TeamRegistrationFormOptions = { clubs: options.clubs.map(club => ({ ...club,
    seasons: club.seasons.map(season => ({ ...season, canCreateTeam: false })) })) };
  controller.configure(revoked, async capture => { calls.push(capture); return confirmed; });
  assert.equal(controller.getSnapshot().draft.teamMode, "existing");
  assert.equal(controller.getSnapshot().draft.teamName, "");
  controller.change("teamMode", "new"); await controller.submit();
  assert.equal(calls.length, 0); assert.doesNotMatch(render(controller), /Crear equipo|name="teamName"/);
});

test("opciones actualizadas eliminan un grupo que deja de estar disponible", () => {
  const { controller } = setup(); existing(controller);
  controller.configure({ clubs: options.clubs.map(club => ({ ...club, seasons: club.seasons.map(season => ({ ...season,
    categories: season.categories.map(category => ({ ...category, groups: [] })) })) })) }, async () => confirmed);
  assert.equal(controller.getSnapshot().draft.groupId, "");
});

test("validación inicial no invoca callback y asocia errores a campos", async () => {
  const { controller, calls } = setup(); await controller.submit();
  assert.equal(calls.length, 0);
  for (const field of ["clubId", "seasonId", "teamId", "categoryId", "groupId"] as const) {
    assert.ok(controller.getSnapshot().errors[field]);
    assert.ok(render(controller).includes(`-${field}-error`));
  }
  assert.match(render(controller), /role="alert"/);
});

test("durante el callback bloquea cambios y envíos concurrentes y libera al terminar", async () => {
  let finish!: (result: TeamRegistrationResult) => void; let writes = 0;
  const controller = createTeamRegistrationFormController(options, () => { writes++; return new Promise(resolve => { finish = resolve; }); });
  existing(controller); const before = controller.getSnapshot().draft;
  const pending = controller.submit(); assert.equal(controller.getSnapshot().submitting, true);
  for (const [field, value] of [["clubId", "club-b"], ["seasonId", "season-2025"], ["teamMode", "new"], ["categoryId", "category-b"], ["groupId", "group-b"]] as const) controller.change(field, value);
  await controller.submit(); assert.equal(writes, 1); assert.deepEqual(controller.getSnapshot().draft, before);
  const html = render(controller);
  assert.match(html, /aria-busy="true"/); assert.match(html, /Enviando inscripción/);
  assert.equal((html.match(/<select[^>]*disabled=""/g) ?? []).length, 6);
  assert.match(html, /<button[^>]*disabled=""/);
  finish(confirmed); await pending; assert.equal(controller.getSnapshot().submitting, false);
});

test("fallo del callback conserva captura, no anuncia éxito ni reintenta", async () => {
  let writes = 0;
  const controller = createTeamRegistrationFormController(options, async () => { writes++; throw new Error("Detalle privado"); });
  existing(controller); await controller.submit();
  assert.equal(writes, 1); assert.equal(controller.getSnapshot().draft.teamId, "team-a");
  await controller.submit(); assert.equal(writes, 1);
  assert.equal(controller.getSnapshot().outcome, "unconfirmed");
  assert.match(render(controller), /No se pudo confirmar la inscripción/);
  assert.doesNotMatch(render(controller), /Detalle privado|Inscripción confirmada/);
});


test("resultado incierto bloquea cambios y envíos incluso tras actualizar opciones", async () => {
  let writes = 0;
  const controller = createTeamRegistrationFormController(options, async () => { writes++; return { kind: "unconfirmed" }; });
  existing(controller); const capture = controller.getSnapshot().draft;
  await controller.submit(); assert.equal(controller.getSnapshot().outcome, "unconfirmed");
  controller.change("clubId", "club-b"); controller.change("teamName", "Cambiar");
  controller.configure({ clubs: [] }, async () => { writes++; return confirmed; });
  await controller.submit();
  assert.equal(writes, 1); assert.deepEqual(controller.getSnapshot().draft, capture);
  assert.match(render(controller), /El envío está bloqueado: verifica su estado/);
  assert.match(render(controller), /<button[^>]*disabled=""/);
});

test("error confirmado permite corregir y reenviar sin aviso de resultado incierto", async () => {
  let writes = 0;
  const controller = createTeamRegistrationFormController(options, async () => {
    writes++;
    return writes === 1 ? { kind: "correctable", fieldErrors: { groupId: "Elige otro grupo disponible." } } : confirmed;
  });
  existing(controller); await controller.submit();
  assert.equal(controller.getSnapshot().outcome, "idle");
  assert.match(render(controller), /Elige otro grupo disponible/);
  assert.match(render(controller), /aria-describedby="[^"]+-groupId-error"/);
  assert.doesNotMatch(render(controller), /verifica su estado/);
  controller.change("categoryId", "category-b"); controller.change("groupId", "group-b");
  await controller.submit(); assert.equal(writes, 2);
  assert.match(render(controller), /Inscripción confirmada como «Inscrito»/);
  await controller.submit(); assert.equal(writes, 2);
});

test("resolver el callback sin resultado tipado no confirma persistencia ni permite reenviar", async () => {
  let writes = 0;
  const emptyCallback = (async () => { writes++; }) as unknown as TeamRegistrationSubmit;
  const controller = createTeamRegistrationFormController(options, emptyCallback);
  existing(controller); await controller.submit(); await controller.submit();
  assert.equal(writes, 1); assert.equal(controller.getSnapshot().outcome, "unconfirmed");
  assert.doesNotMatch(render(controller), /Inscripción confirmada/);
});

test("sin categorías o grupos muestra avisos y mantiene envío deshabilitado", async () => {
  for (const missing of ["categories", "groups"] as const) {
    let writes = 0;
    const limited: TeamRegistrationFormOptions = { clubs: options.clubs.map(club => ({ ...club,
      seasons: club.seasons.map(season => ({ ...season, categories: missing === "categories" ? [] :
        season.categories.map(category => ({ ...category, groups: [] })) })) })) };
    const controller = createTeamRegistrationFormController(limited, async () => { writes++; return confirmed; });
    existing(controller); await controller.submit();
    assert.equal(writes, 0);
    assert.match(render(controller), missing === "categories" ? /No hay categorías disponibles/ : /No hay grupos disponibles/);
    assert.match(render(controller), /<button[^>]*disabled=""/);
    // La capacidad de crear se mantiene; no compensa la falta de categoría/grupo.
    assert.match(render(controller), /Crear equipo/);
  }
});

test("categoría sin grupos bloquea envío aunque otra categoría sí los tenga", () => {
  const limited: TeamRegistrationFormOptions = { clubs: options.clubs.map(club => ({ ...club,
    seasons: club.seasons.map(season => ({ ...season, categories: season.categories.map(category => ({ ...category,
      groups: category.id === "category-a" ? [] : category.groups })) })) })) };
  const controller = createTeamRegistrationFormController(limited, async () => confirmed);
  existing(controller); assert.match(render(controller), /No hay grupos disponibles para la categoría seleccionada/);
  assert.match(render(controller), /<button[^>]*disabled=""/);
  controller.change("categoryId", "category-b"); controller.change("groupId", "group-b");
  assert.doesNotMatch(render(controller), /<button[^>]*disabled=""/);
});

test("sin equipos existentes conserva Crear equipo y permite enviar en modo nuevo", async () => {
  let writes = 0;
  const limited: TeamRegistrationFormOptions = { clubs: options.clubs.map(club => ({ ...club,
    seasons: club.seasons.map(season => ({ ...season, teams: [] })) })) };
  const controller = createTeamRegistrationFormController(limited, async capture => {
    writes++; assert.deepEqual(capture.team, { kind: "new", name: "Equipo nuevo sintético" }); return confirmed;
  });
  chooseScope(controller);
  assert.match(render(controller), /No hay equipos existentes disponibles/);
  assert.match(render(controller), /Crear equipo/);
  assert.match(render(controller), /<button[^>]*disabled=""/);
  await controller.submit(); assert.equal(writes, 0);
  controller.change("teamMode", "new"); controller.change("teamName", "Equipo nuevo sintético"); chooseGroup(controller);
  assert.doesNotMatch(render(controller), /<button[^>]*disabled=""/);
  await controller.submit(); assert.equal(writes, 1);
});


test("preview solo habilitada en desarrollo para su ruta exacta", () => {
  assert.equal(isTeamRegistrationPreview(TEAM_REGISTRATION_PREVIEW_PATH, "development"), true);
  for (const environment of ["production", "test", undefined]) {
    assert.equal(isTeamRegistrationPreview(TEAM_REGISTRATION_PREVIEW_PATH, environment), false);
  }
  for (const path of ["/", "/access", "/affiliations/review", "/dev/team-registration/other", null]) {
    assert.equal(isTeamRegistrationPreview(path, "development"), false);
  }
});
