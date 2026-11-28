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
  playoff: "Liguilla de ocho equipos", regularDeadline: "Fin de fase regular", format: "Formato por ronda",
  quarterfinals: "Cuartos de final", semifinals: "Semifinales", final: "Final", preliminaryTiebreaker: "Desempate en cuartos y semifinales",
  SINGLE: "Partido único", HOME_AND_AWAY: "Ida y vuelta", STANDING_POSITION: "Mejor posición", PENALTIES: "Penales",
  dates: "Fechas previstas de liguilla",
  venuePolicy: "Cancha de liguilla", mode: "Modalidad", HOME: "Cancha del local", NEUTRAL: "Canchas neutrales",
};

function Value({ value, field, venueNames }: { value: unknown; field: string; venueNames: Record<string, string> }) {
  if (Array.isArray(value)) return <ol className="list-decimal space-y-1 pl-6">{value.map((item, index) => <li key={index}><Value value={item} field={field} venueNames={venueNames} /></li>)}</ol>;
  if (value !== null && typeof value === "object") return <dl className="grid gap-3 sm:grid-cols-2">{Object.entries(value).map(([key, item]) => <div key={key} className="rounded-xl bg-background p-3"><dt className="text-sm text-muted">{labels[key] ?? key}</dt><dd className="mt-1 font-medium"><Value value={item} field={key} venueNames={venueNames} /></dd></div>)}</dl>;
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
