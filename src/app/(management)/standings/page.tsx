import { redirect } from 'next/navigation';
import { AuthAccessError } from '@/server/auth/session';
import { AuthorizationError } from '@/server/auth/authorization';
import { getStandingWorkspace, StandingFilterError } from '@/features/standings/server/queries';
import { StandingsFilters } from '@/features/standings/components/standings-filters';
import { StandingsTable } from '@/features/standings/components/standings-table';

export const metadata = { title: 'Clasificación' };
export default async function StandingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const input = Object.fromEntries(['competitionId', 'seasonId', 'categoryId', 'groupId', 'matchdayId'].map(key => [key, params[key]]));
  let data;
  try { data = await getStandingWorkspace(input); }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === 'PASSWORD_CHANGE_REQUIRED' ? '/change-password' : '/login');
    if (error instanceof AuthorizationError) return <div className="p-6"><h1 className="text-2xl font-semibold">Clasificación</h1><p role="alert" className="mt-4">No tienes permiso para consultar esta clasificación o su ámbito.</p></div>;
    if (error instanceof StandingFilterError) return <div className="p-6"><h1 className="text-2xl font-semibold">Clasificación</h1><p role="alert" className="mt-4">Los filtros no son válidos. Selecciona nuevamente la competencia y su contexto.</p><a href="/standings" className="mt-4 inline-block underline">Restablecer filtros</a></div>;
    throw error;
  }
  return <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8 sm:px-6">
    <header><p className="text-sm text-muted">CONSULTA INTERNA</p><h1 className="text-2xl font-semibold">Clasificación</h1><p className="mt-2 text-muted">Resultados acumulados por competencia, temporada, categoría y grupo.</p></header>
    {!data.catalog.competitions.length ? <p role="status">No hay competencias disponibles en tu ámbito.</p> : <>
      <StandingsFilters key={JSON.stringify(data.filters)} catalog={data.catalog} initial={data.filters} matchdays={data.matchdays} />
      {data.state === 'select' && <p role="status">Selecciona la competencia, temporada, categoría y grupo para consultar la clasificación.</p>}
      {data.state === 'no-matchdays' && <p role="status">Esta temporada todavía no tiene jornadas.</p>}
      {data.state === 'rules-pending' && <p role="status">El reglamento vinculado aún no está aprobado o tiene parámetros pendientes. La clasificación no está disponible.</p>}
      {data.table && <StandingsTable table={data.table} />}
    </>}
  </div>;
}
