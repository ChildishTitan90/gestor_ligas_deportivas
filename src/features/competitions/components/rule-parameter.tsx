const labels: Record<string, string> = {
  announcement: "Convocatoria", calendar: "Calendario", points: "Puntuación",
  tieBreakers: "Criterios de desempate (en orden)", rounds: "Vueltas",
  matchDurationMinutes: "Duración del partido", win: "Victoria", draw: "Empate", loss: "Derrota",
  POINTS: "Puntos", GOAL_DIFFERENCE: "Diferencia de goles", GOALS_FOR: "Goles a favor",
  GOALS_AGAINST: "Goles en contra", HEAD_TO_HEAD: "Enfrentamiento directo", FAIR_PLAY: "Juego limpio",
  RED_CARDS: "Tarjetas rojas · menos es mejor", YELLOW_CARDS: "Tarjetas amarillas · menos es mejor",
};

function Value({ value, field }: { value: unknown; field: string }) {
  if (Array.isArray(value)) return <ol className="list-decimal space-y-1 pl-6">{value.map((item, index) => <li key={index}><Value value={item} field={field} /></li>)}</ol>;
  if (value !== null && typeof value === "object") return <dl className="grid gap-3 sm:grid-cols-2">{Object.entries(value).map(([key, item]) => <div key={key} className="rounded-xl bg-background p-3"><dt className="text-sm text-muted">{labels[key] ?? key}</dt><dd className="mt-1 font-medium"><Value value={item} field={key} /></dd></div>)}</dl>;
  if (typeof value === "number") return <>{value}{field === "matchDurationMinutes" ? " minutos" : ["win", "draw", "loss"].includes(field) ? (value === 1 ? " punto" : " puntos") : ""}</>;
  if (typeof value === "string") return <span className="whitespace-pre-wrap break-words">{labels[value] ?? value}</span>;
  return <>{value === null ? "Sin especificar" : value === true ? "Sí" : value === false ? "No" : "Dato no disponible"}</>;
}

export function RuleParameter({ parameter }: { parameter: { key: string; value: unknown; requiresValidation: boolean } }) {
  return <section className="mt-5 space-y-2"><h4 className="font-semibold">{labels[parameter.key] ?? parameter.key}</h4>
    {parameter.requiresValidation && <p className="text-sm text-muted">Pendiente de validación</p>}
    <Value value={parameter.value} field={parameter.key} />
  </section>;
}
