'use client';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { SelectField } from '@/components/ui/select-field';
import type { StandingCatalog, StandingFilters } from '../types';

function Submit() {
  const { pending } = useFormStatus();
  return <button className="primary-action min-h-12 rounded-xl px-5 py-3 font-semibold" disabled={pending}>
    {pending ? 'Consultando…' : 'Consultar clasificación'}
  </button>;
}
export function StandingsFilters({ catalog, initial, matchdays }: { catalog: StandingCatalog; initial: StandingFilters; matchdays: { id: string; number: number }[] }) {
  const [filters, setFilters] = useState(initial);
  const hierarchy = ['competitionId', 'seasonId', 'categoryId', 'groupId', 'matchdayId'] as const;
  function change(key: typeof hierarchy[number], value: string) {
    setFilters(previous => Object.fromEntries(hierarchy.map((name, index) => [name,
      index < hierarchy.indexOf(key) ? previous[name] : name === key ? value : undefined])));
  }
  const seasons = catalog.seasons.filter(s => s.competitionId === filters.competitionId);
  const categories = catalog.categories.filter(c => c.seasonId === filters.seasonId);
  const groups = catalog.groups.filter(g => g.categoryId === filters.categoryId);
  return <form action="/standings" method="get" aria-label="Filtros de clasificación" className="space-y-4 rounded-2xl border border-border bg-surface p-4 sm:p-6">
    <div className="grid gap-4 min-[380px]:grid-cols-2 xl:grid-cols-4">
      <label htmlFor="standing-competition">Competencia<SelectField id="standing-competition" name="competitionId" required value={filters.competitionId ?? ''}
        onValueChange={value => change('competitionId', value)} options={catalog.competitions.map(c => ({ value: c.id, label: c.name }))} /></label>
      <label htmlFor="standing-season">Temporada<SelectField id="standing-season" name="seasonId" required disabled={!filters.competitionId} value={filters.seasonId ?? ''}
        onValueChange={value => change('seasonId', value)} options={seasons.map(s => ({ value: s.id, label: s.name }))} /></label>
      <label htmlFor="standing-category">Categoría<SelectField id="standing-category" name="categoryId" required disabled={!filters.seasonId} value={filters.categoryId ?? ''}
        onValueChange={value => change('categoryId', value)} options={categories.map(c => ({ value: c.id, label: c.name }))} /></label>
      <label htmlFor="standing-group">Grupo<SelectField id="standing-group" name="groupId" required disabled={!filters.categoryId} value={filters.groupId ?? ''}
        onValueChange={value => change('groupId', value)} options={groups.map(g => ({ value: g.id, label: g.name }))} /></label>
    </div>
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
      <label htmlFor="standing-matchday" className="sm:min-w-60">Jornada de corte<SelectField id="standing-matchday" name="matchdayId"
        disabled={!filters.groupId || !initial.seasonId || filters.seasonId !== initial.seasonId || !matchdays.length} value={filters.matchdayId ?? ''}
        onValueChange={value => change('matchdayId', value)} placeholder="Última jornada de la temporada"
        options={[{ value: '', label: 'Última jornada de la temporada' }, ...matchdays.map(d => ({ value: d.id, label: `Jornada ${d.number}` }))]} /></label>
      <Submit />
    </div>
    {filters.groupId && filters.seasonId !== initial.seasonId && <p className="text-sm text-muted">
      Consulta la clasificación para cargar las jornadas de la temporada seleccionada.
    </p>}
  </form>;
}
