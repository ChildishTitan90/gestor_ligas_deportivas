import { redirect } from 'next/navigation';
import { ManagementPageHeader } from '@/components/layout/management-page-header';
import { ActionLink } from '@/components/ui/action-link';
import { AuthAccessError } from '@/server/auth/session';
import { AuthorizationError } from '@/server/auth/authorization';
import { getStandingWorkspace, StandingFilterError } from '@/features/standings/server/queries';
import { StandingsFilters } from '@/features/standings/components/standings-filters';
import { StandingsTable } from '@/features/standings/components/standings-table';

export const metadata = { title: 'Clasificación' };
const title = 'Clasificación';
const description = 'Consulta las posiciones y los resultados oficiales acumulados hasta una jornada.';
const back = { href: '/access', label: 'Volver al panel' };

export default async function StandingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const input = Object.fromEntries(['competitionId', 'seasonId', 'categoryId', 'groupId', 'matchdayId'].map(key => [key, params[key]]));
  let data;
  try { data = await getStandingWorkspace(input); }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === 'PASSWORD_CHANGE_REQUIRED' ? '/change-password' : '/login');
    if (error instanceof AuthorizationError || error instanceof StandingFilterError) return <div className="mx-auto max-w-7xl space-y-4">
      <ManagementPageHeader title={title} description={description} back={back} />
      <p role="alert">{error instanceof AuthorizationError ? 'No tienes permiso para consultar esta clasificación o su ámbito.'
        : 'Los filtros no son válidos. Selecciona nuevamente la competencia y su contexto.'}</p>
      {Object.values(input).some(Boolean) && <ActionLink href="/standings" variant="secondary">Restablecer filtros</ActionLink>}
    </div>;
    throw error;
  }
  const { catalog, filters, matchdays, table } = data;
  const context = [
    { label: 'Competencia', value: catalog.competitions.find(row => row.id === filters.competitionId)?.name },
    { label: 'Temporada', value: catalog.seasons.find(row => row.id === filters.seasonId)?.name },
    { label: 'Categoría', value: catalog.categories.find(row => row.id === filters.categoryId)?.name },
  ];
  const automaticCut = !filters.matchdayId && table ? matchdays.find(day => day.number === table.matchday) : undefined;
  const fixedCutHref = automaticCut && filters.competitionId && filters.seasonId && filters.categoryId && filters.groupId
    ? `/standings?${new URLSearchParams({
      competitionId: filters.competitionId, seasonId: filters.seasonId, categoryId: filters.categoryId,
      groupId: filters.groupId, matchdayId: automaticCut.id,
    })}` : undefined;
  return <div className="mx-auto w-full max-w-7xl space-y-6">
    <ManagementPageHeader title={title} description={description} back={back} />
    {!catalog.competitions.length ? <p role="status">No hay competencias disponibles en tu ámbito.</p> : <>
      <StandingsFilters key={JSON.stringify(filters)} catalog={catalog} initial={filters} matchdays={matchdays} />
      {data.state === 'select' && <p role="status">Selecciona la competencia, temporada, categoría y grupo para consultar la clasificación.</p>}
      {data.state === 'no-matchdays' && <p role="status">Esta temporada todavía no tiene jornadas.</p>}
      {data.state === 'rules-pending' && <p role="status">El reglamento vinculado aún no está aprobado o tiene parámetros pendientes. La clasificación no está disponible.</p>}
      {table && <StandingsTable table={table} context={context} fixedCutHref={fixedCutHref} />}
    </>}
  </div>;
}
