"use client";

import { SelectField } from "@/components/ui/select-field";

import { useState } from "react";
import { TeamRegistrationForm } from "./team-registration-form";
import { TeamRegistrationList } from "./team-registration-list";
import type { TeamRegistrationFormOptions, TeamRegistrationItem, TeamRegistrationSubmit } from "../team-registration-model";

// Datos exclusivamente sintéticos de esta preview, sin imports desde páginas reales.
const demoOptions: TeamRegistrationFormOptions = { clubs: [
  { id: "demo-club-a", name: "DEMO Club A", seasons: [
    { id: "demo-season-2026", name: "DEMO Temporada 2026", canEnroll: true, canCreateTeam: true,
      teams: [{ id: "demo-team-a", name: "DEMO Equipo A" }, { id: "demo-team-b", name: "DEMO Equipo B" }],
      categories: [
        { id: "demo-category-a", name: "DEMO Categoría A", groups: [{ id: "demo-group-a1", name: "DEMO Grupo A1" }, { id: "demo-group-a2", name: "DEMO Grupo A2" }] },
        { id: "demo-category-b", name: "DEMO Categoría B", groups: [{ id: "demo-group-b", name: "DEMO Grupo B" }] },
      ] },
    { id: "demo-season-2025", name: "DEMO Temporada 2025", canEnroll: true, canCreateTeam: false,
      teams: [{ id: "demo-team-a", name: "DEMO Equipo A" }],
      categories: [{ id: "demo-category-past", name: "DEMO Categoría histórica", groups: [{ id: "demo-group-past", name: "DEMO Grupo histórico" }] }] },
  ] },
  { id: "demo-club-b", name: "DEMO Club B", seasons: [
    { id: "demo-season-2026", name: "DEMO Temporada 2026", canEnroll: true, canCreateTeam: true,
      teams: [{ id: "demo-team-c", name: "DEMO Equipo C" }],
      categories: [{ id: "demo-category-c", name: "DEMO Categoría C", groups: [{ id: "demo-group-c", name: "DEMO Grupo C" }] }] },
  ] },
] };
const demoItems: readonly TeamRegistrationItem[] = [
  { teamId: "demo-team-a", seasonTeamId: "demo-enrollment-2026-a", teamName: "DEMO Equipo A", seasonName: "DEMO Temporada 2026", categoryName: "DEMO Categoría A", groupName: "DEMO Grupo A1", status: "REGISTERED" },
  { teamId: "demo-team-a", seasonTeamId: "demo-enrollment-2025-a", teamName: "DEMO Equipo A", seasonName: "DEMO Temporada 2025", categoryName: "DEMO Categoría histórica", groupName: "DEMO Grupo histórico", status: "WITHDRAWN" },
  { teamId: "demo-team-b", seasonTeamId: "demo-enrollment-2026-b", teamName: "DEMO Equipo B", seasonName: "DEMO Temporada 2026", categoryName: "DEMO Categoría B", groupName: "DEMO Grupo B", status: "ACTIVE" },
];
const scenarios = {
  complete: "Opciones completas",
  "no-teams": "Sin equipos existentes (permite crear)",
  "no-create": "Creación no permitida",
  "no-categories": "Sin categorías",
  "no-groups": "Sin grupos",
  empty: "Sin clubes ni inscripciones",
} as const;
type Scenario = keyof typeof scenarios;
function optionsFor(scenario: Scenario): TeamRegistrationFormOptions {
  if (scenario === "empty") return { clubs: [] };
  return { clubs: demoOptions.clubs.map(club => ({ ...club, seasons: club.seasons.map(season => ({
    ...season,
    canEnroll: true, canCreateTeam: scenario === "no-teams" ? true : scenario === "no-create" ? false : season.canCreateTeam,
    teams: scenario === "no-teams" ? [] : season.teams,
    categories: scenario === "no-categories" ? [] : season.categories.map(category => ({ ...category,
      groups: scenario === "no-groups" ? [] : category.groups })),
  })) })) };
}

export function TeamRegistrationPreview() {
  const [scenario, setScenario] = useState<Scenario>("complete");
  const [result, setResult] = useState<"correctable" | "unconfirmed">("correctable");
  const [revision, setRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState("");
  const [options, setOptions] = useState(() => optionsFor("complete"));
  if (process.env.NODE_ENV !== "development") return null;

  const simulate: TeamRegistrationSubmit = async () => {
    setPending(true); setNotice("Simulación en curso durante 2 segundos. No se enviará ni registrará información.");
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      setNotice("Simulación finalizada sin registro. No se creó equipo ni inscripción y la lista de ejemplo no cambia.");
      return result === "unconfirmed" ? { kind: "unconfirmed" } :
        { kind: "correctable", fieldErrors: { groupId: "Error de demostración: selecciona de nuevo el grupo para revisar la validación." } };
    } finally { setPending(false); }
  };
  function reset(nextScenario = scenario) {
    if (pending) return;
    setScenario(nextScenario); setOptions(optionsFor(nextScenario)); setNotice(""); setRevision(value => value + 1);
  }

  return <main className="mx-auto w-full max-w-6xl space-y-8 px-6 py-10 sm:px-10">
    <header className="space-y-3 rounded-2xl border border-border bg-soft p-6">
      <h1 className="text-2xl font-semibold text-primary">PDGLD-63 · Demostración exclusivamente de desarrollo</h1>
      <p className="font-medium">Datos sintéticos. Simulación sin registro ni persistencia.</p>
      <p className="text-sm text-muted">Esta pantalla no consulta sesiones, bases ni endpoints. El botón del formulario solo inicia una espera local. Los estados de la lista son ejemplos, no resultados del envío.</p>
    </header>
    <section aria-labelledby="demo-controls-title" className="space-y-4 rounded-2xl border border-border bg-surface p-5">
      <h2 id="demo-controls-title" className="text-lg font-semibold text-primary">Escenarios de demostración</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label>Opciones disponibles
          <SelectField className="mt-2" value={scenario} disabled={pending} onValueChange={value => reset(value as Scenario)}
            options={Object.entries(scenarios).map(([value, label]) => ({ value, label }))} />
        </label>
        <label>Resultado simulado del callback
          <SelectField className="mt-2" value={result} disabled={pending} onValueChange={value => {
            setResult(value as "correctable" | "unconfirmed"); reset();
          }} options={[{ value: "correctable", label: "Error confirmado simulado: permite corregir" },
            { value: "unconfirmed", label: "Resultado incierto simulado: bloquea el formulario" }]} />
        </label>
      </div>
      <button type="button" disabled={pending} onClick={() => reset()}
        className="min-h-12 rounded-xl border border-border px-5 py-3 font-semibold text-primary disabled:opacity-50">Reiniciar simulación</button>
      <p className="text-sm text-muted">Reiniciar descarta solo esta captura local de demostración; no verifica ni modifica una inscripción real.</p>
      {notice && <p role="status" className="rounded-xl bg-soft p-4">{notice}</p>}
    </section>
    <TeamRegistrationForm key={revision} options={options} onSubmit={simulate} />
    <section aria-labelledby="demo-list-title" className="space-y-4">
      <h2 id="demo-list-title" className="text-xl font-semibold text-primary">Inscripciones de ejemplo · Sin datos oficiales</h2>
      <TeamRegistrationList items={scenario === "empty" ? [] : demoItems} />
    </section>
  </main>;
}
