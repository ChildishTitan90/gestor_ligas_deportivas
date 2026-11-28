const labels: Record<string, string> = {
  announcement: "Convocatoria", calendar: "Calendario", points: "Puntuación",
  tieBreakers: "Criterios de desempate (en orden)", rounds: "Vueltas",
  complexOnlyFinalRounds: "Últimas jornadas solo en unidad deportiva",
  scheduling: "Programación", slotStepMinutes: "Intervalo entre horarios", venueStages: "Tramos de canchas",
  fromRound: "Desde la jornada", toRound: "Hasta la jornada", venueIds: "Canchas",
  matchDurationMinutes: "Duración del partido", win: "Victoria", draw: "Empate", loss: "Derrota",
  POINTS: "Puntos", GOAL_DIFFERENCE: "Diferencia de goles", GOALS_FOR: "Goles a favor",
  GOALS_AGAINST: "Goles en contra", HEAD_TO_HEAD: "Enfrentamiento directo", FAIR_PLAY: "Juego limpio",
  RED_CARDS: "Tarjetas rojas · menos es mejor", YELLOW_CARDS: "Tarjetas amarillas · menos es mejor",
};

function Value({ value, field, venueNames, depth = 0 }: { value: unknown; field: string; venueNames: Record<string, string>; depth?: number }) {
  if (Array.isArray(value)) return <ol className="min-w-0 list-decimal space-y-2 pl-6">{value.map((item, index) => <li key={index} className="min-w-0"><Value value={item} field={field} venueNames={venueNames} depth={depth + 1} /></li>)}</ol>;
  if (value !== null && typeof value === "object") return <dl className={`grid min-w-0 gap-3 ${depth === 0 ? "sm:grid-cols-2" : ""}`}>{Object.entries(value).map(([key, item]) => <div key={key} className={`min-w-0 ${item !== null && typeof item === "object" ? "col-span-full" : depth === 0 ? "rounded-xl bg-background p-3" : ""}`}><dt className="text-sm text-muted">{labels[key] ?? key}</dt><dd className="mt-1 min-w-0 font-medium"><Value value={item} field={key} venueNames={venueNames} depth={depth + 1} /></dd></div>)}</dl>;
  if (typeof value === "number") return <>{value}{["matchDurationMinutes", "slotStepMinutes"].includes(field) ? " minutos" : ["win", "draw", "loss"].includes(field) ? (value === 1 ? " punto" : " puntos") : ""}</>;
  if (typeof value === "string") return <span className="whitespace-pre-wrap break-words">{field === "venueIds" ? (venueNames[value] ?? "Cancha no disponible") : (labels[value] ?? value)}</span>;
  return <>{value === null ? "Sin especificar" : value === true ? "Sí" : value === false ? "No" : "Dato no disponible"}</>;
}

export function RuleParameter({ parameter, venueNames = {} }: { parameter: { key: string; value: unknown; requiresValidation: boolean }; venueNames?: Record<string, string> }) {
  return <section className="mt-5 space-y-2"><h4 className="font-semibold">{labels[parameter.key] ?? parameter.key}</h4>
    {parameter.requiresValidation && <p className="text-sm text-muted">Pendiente de validación</p>}
    <Value value={parameter.value} field={parameter.key} venueNames={venueNames} />
  </section>;
}
