import { ActionLink } from '@/components/ui/action-link';
import type { StandingTable } from '../types';

const columns = ['PJ', 'PG', 'PE', 'PP', 'GF', 'GC', 'DG', 'Pts'];
export function StandingsTable({ table, context, fixedCutHref }: {
  table: StandingTable;
  context: readonly { label: string; value?: string }[];
  fixedCutHref?: string;
}) {
  const pending = table.rows.some(row => row.rank === null);
  const version = table.version === null ? 'Vista actual sin versión guardada'
    : `Clasificación v${table.version} · ${table.status === 'VALIDATED' ? 'Validada' : 'Cálculo interno sin validar'}`;
  return <section aria-labelledby="standing-table-heading" className="space-y-4">
    <div className="space-y-4 rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 space-y-1">
          <h2 id="standing-table-heading" className="text-xl font-semibold text-primary">Jornada {table.matchday} · {table.groupName}</h2>
          <p className="text-sm text-muted">{fixedCutHref ? 'Corte automático hasta la última jornada de la temporada' : 'Corte seleccionado'} · Reglamento v{table.ruleVersion}</p>
        </div>
        {fixedCutHref && <ActionLink href={fixedCutHref} variant="secondary" className="shrink-0">Fijar jornada {table.matchday}</ActionLink>}
      </div>
      <dl aria-label="Contexto de la clasificación" className="grid gap-x-5 gap-y-2 border-y border-border py-3 text-sm sm:grid-cols-3">
        {context.map(({ label, value }) => value && <div key={label} className="min-w-0">
          <dt className="text-xs text-muted">{label}</dt><dd className="wrap-anywhere font-semibold text-primary">{value}</dd>
        </div>)}
      </dl>
      <p data-testid="standing-version" className={`inline-block rounded-lg px-3 py-1.5 text-sm font-semibold ${table.status === 'VALIDATED' ? 'bg-positive-surface text-positive' : 'bg-soft text-primary'}`}>{version}</p>
      {table.calculatedAt && <p className="text-sm text-muted">Calculada el <time dateTime={table.calculatedAt}>{new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(table.calculatedAt))}</time></p>}
      {table.version === null && table.latestStoredVersion !== null && <p className="text-sm text-muted">
        La versión guardada v{table.latestStoredVersion} corresponde a datos distintos a los de esta consulta.
      </p>}
    </div>
    {!table.officialResults && <p role="status" className="rounded-xl border border-border bg-surface p-4">Grupo sin resultados oficiales en este corte. Los equipos se muestran con totales en cero.</p>}
    {!!table.officialResults && pending && <p role="status" className="rounded-xl border border-border bg-surface p-4">Hay posiciones pendientes de resolución reglamentaria. El orden visual no es un desempate oficial.</p>}
    {!table.rows.length ? <p role="status" className="rounded-xl border border-border bg-surface p-4">No hay equipos inscritos en este grupo.</p> : <>
      <p className="text-sm text-muted lg:hidden">Desliza la tabla hacia los lados para ver todas las estadísticas.</p>
      <div className="overflow-x-auto rounded-2xl border border-border" role="region" aria-label="Tabla de clasificación desplazable" tabIndex={0}>
        <table className="w-full min-w-[660px] border-separate border-spacing-0 bg-surface text-sm" aria-describedby="standing-legend">
          <caption className="sr-only">Clasificación acumulada hasta la jornada {table.matchday}</caption>
          <thead><tr className="text-muted"><th scope="col" className="sticky left-0 z-20 w-12 border-b border-border bg-background px-3 py-3 text-center" aria-label="Posición">#</th><th scope="col" className="sticky left-12 z-20 min-w-40 border-b border-border bg-background px-3 py-3 text-left">Equipo</th>{columns.map(column => <th key={column} scope="col" className={`border-b border-border bg-background px-2 py-3 text-center ${column === 'Pts' ? 'sticky right-0 z-20 border-l font-bold text-primary' : 'font-medium'}`}>{column}</th>)}</tr></thead>
          <tbody>{table.rows.map(row => <tr key={row.teamId} data-testid="standing-row">
            <td className="sticky left-0 z-10 w-12 border-b border-border bg-surface px-3 py-3.5 text-center font-semibold tabular-nums" aria-label={row.rank !== null ? `Posición ${row.rank}` : table.officialResults ? 'Posición pendiente' : 'Sin resultados'}>{row.rank ?? '—'}</td><th scope="row" className="sticky left-12 z-10 min-w-40 max-w-60 border-b border-border bg-surface px-3 py-3.5 text-left font-semibold text-primary">{row.teamName}</th>
            {[row.played, row.won, row.drawn, row.lost, row.scoreFor, row.scoreAgainst, row.difference].map((value, index) => <td key={index} className="border-b border-border px-2 py-3.5 text-center tabular-nums">{value}</td>)}
            <td className="sticky right-0 z-10 border-b border-l border-border bg-surface px-2 py-3.5 text-center font-bold text-primary tabular-nums">{row.points}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
    <p id="standing-legend" className="text-sm text-muted">PJ: jugados · PG: ganados · PE: empatados · PP: perdidos · GF: goles a favor · GC: goles en contra · DG: diferencia de goles.</p>
    <aside aria-label="Procedencia de resultados" className="rounded-xl border border-border p-4 text-sm">
      <h3 className="font-semibold">Procedencia de resultados</h3><p>{table.officialResults} resultados oficiales elegibles en este corte.</p>
      <ul>{table.sources.map(source => <li key={source.label}>{source.label}: {source.count}</li>)}</ul>
      <p className="mt-2 text-muted">Las estadísticas de tarjetas y goleadores no certifican captura completa; no se infieren del marcador. Esta consulta no confirma cédulas ni publica la tabla.</p>
    </aside>
  </section>;
}
