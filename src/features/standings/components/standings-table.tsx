import type { StandingTable } from '../types';

const columns = ['Posición', 'Equipo', 'PJ', 'PG', 'PE', 'PP', 'GF', 'GC', 'DG', 'Puntos'];
export function StandingsTable({ table }: { table: StandingTable }) {
  const pending = table.rows.some(row => row.rank === null);
  return <section aria-labelledby="standing-table-heading" className="space-y-4">
    <div className="space-y-2">
      <h2 id="standing-table-heading" className="text-xl font-semibold">{table.groupName}</h2>
      <p>Jornada {table.matchday} · Reglamento v{table.ruleVersion}</p>
      <p data-testid="standing-version">{table.version !== null ? `Clasificación v${table.version} · ${table.status === 'VALIDATED' ? 'Validada' : 'Cálculo interno sin validar'}` : 'Vista actual sin versión guardada'}</p>
      {table.calculatedAt && <p className="text-sm text-muted">Calculada: {new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Mexico_City' }).format(new Date(table.calculatedAt))}</p>}
      {table.version === null && <p className="text-sm text-muted">Consulta de solo lectura; no guarda ni valida una clasificación.
        {table.latestStoredVersion !== null && ` La última versión guardada (v${table.latestStoredVersion}) corresponde a otros insumos y no se muestra como vigente.`}</p>}
    </div>
    {!table.officialResults && <p role="status" className="rounded-xl border border-border bg-surface p-4">Grupo sin resultados oficiales en este corte. Los equipos se muestran con totales en cero.</p>}
    {!!table.officialResults && pending && <p role="status" className="rounded-xl border border-border bg-surface p-4">Hay posiciones pendientes de resolución reglamentaria. El orden visual no es un desempate oficial.</p>}
    {!table.rows.length ? <p>No hay equipos inscritos en este grupo.</p> : <>
      <div className="hidden overflow-x-auto rounded-2xl border border-border md:block">
        <table className="w-full text-sm" aria-describedby="standing-legend">
          <caption className="bg-surface px-4 py-3 text-left">Clasificación acumulada hasta la jornada {table.matchday}</caption>
          <thead className="bg-surface"><tr>{columns.map(column => <th key={column} scope="col" className="px-3 py-3 text-left">{column}</th>)}</tr></thead>
          <tbody>{table.rows.map(row => <tr key={row.teamId} data-testid="standing-row" className="border-t border-border">
            <td className="px-3 py-4">{row.rank ?? (table.officialResults ? 'Posición pendiente' : 'Sin resultados')}</td><th scope="row" className="px-3 py-4 text-left font-medium">{row.teamName}</th>
            {[row.played, row.won, row.drawn, row.lost, row.scoreFor, row.scoreAgainst, row.difference].map((value, index) => <td key={index} className="px-3 py-4 tabular-nums">{value}</td>)}
            <td className="px-3 py-4 font-semibold tabular-nums">{row.points}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <ul className="space-y-3 md:hidden" aria-label="Clasificación por equipo">{table.rows.map(row => <li key={row.teamId} className="rounded-2xl border border-border bg-surface p-4">
        <h3 className="font-semibold">{row.teamName}</h3><p className="text-sm">{row.rank !== null ? `Posición ${row.rank}` : table.officialResults ? 'Posición pendiente' : 'Sin resultados'}</p>
        <dl className="mt-3 grid grid-cols-4 gap-3 text-sm">{[['PJ', row.played], ['PG', row.won], ['PE', row.drawn], ['PP', row.lost], ['GF', row.scoreFor], ['GC', row.scoreAgainst], ['DG', row.difference], ['Puntos', row.points]].map(([label, value]) => <div key={label}><dt className="text-muted">{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}</dl>
      </li>)}</ul>
    </>}
    <p id="standing-legend" className="text-sm text-muted">PJ: jugados · PG: ganados · PE: empatados · PP: perdidos · GF: goles a favor · GC: goles en contra · DG: diferencia de goles.</p>
    <aside aria-label="Procedencia de resultados" className="rounded-xl border border-border p-4 text-sm">
      <h3 className="font-semibold">Procedencia de resultados</h3><p>{table.officialResults} resultados oficiales elegibles en este corte.</p>
      <ul>{table.sources.map(source => <li key={source.label}>{source.label}: {source.count}</li>)}</ul>
      <p className="mt-2 text-muted">Las estadísticas de tarjetas y goleadores no certifican captura completa; no se infieren del marcador. Esta consulta no confirma cédulas ni publica la tabla.</p>
    </aside>
  </section>;
}
