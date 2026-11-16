import { formationSlots } from "./tactics";
import type { ReportDemoCase, ReportDemoData, ReportEventType, ReportPlayer } from "./types";

export const REPORT_DEMO_PATH = "/matches/report-demo";
export const REPORT_DEMO_MATCH_ID = "demo-018";
export const reportDemoCases: { value: ReportDemoCase; label: string; description: string }[] = [
  { value: "draft", label: "Captura en curso", description: "Alineaciones, dorsales, cambios y eventos editables; firmas pendientes." },
  { value: "empty", label: "Cédula vacía", description: "Iniciar sin alineaciones, tiempos, eventos ni marcador." },
  { value: "confirmed", label: "Confirmada · Solo consulta", description: "Evidencia de ejemplo, dorsales históricos y firmas sintéticas." },
  { value: "denied", label: "Acceso denegado", description: "Designación o permiso no vigente; sin captura disponible." },
  { value: "loading", label: "Carga", description: "Espera simulada con salida manual al partido." },
  { value: "error", label: "Error de consulta", description: "No se recibió la cédula; reintento manual." },
  { value: "stale", label: "Versión obsoleta", description: "Conservar captura y comparar con una versión de referencia." },
  { value: "uncertain", label: "Resultado incierto", description: "Conservar operación y consultar el resultado sin reenviar." },
  { value: "scheduled", label: "Partido programado", description: "Estado de ejemplo que todavía no permite capturar." },
];

/** Códigos del baseline; exigencias de selección solo ilustrativas hasta integrar PDGLD-26. */
const eventTypes: ReportEventType[] = [
  { code: "GOAL", label: "Gol", player: "required", team: "required", opensCase: false },
  { code: "INJURY", label: "Lesión", player: "required", team: "required", opensCase: false },
  { code: "CAUTION", label: "Amonestación", player: "required", team: "required", opensCase: false },
  { code: "SENDING_OFF", label: "Expulsión", player: "required", team: "required", opensCase: true },
  { code: "SERIOUS_INCIDENT", label: "Incidente grave", player: "optional", team: "optional", opensCase: true },
  { code: "SUBSTITUTION", label: "Cambio", player: "required", team: "required", opensCase: false },
];

function teamPlayers(teamId: string, names: string[]): ReportPlayer[] {
  return names.map((name, index) => ({
    id: `${teamId}-${index + 1}`, teamId, name, usualJersey: index + 1,
    eligible: index < 13,
    blockers: index === 13 ? [{ code: "PARTICIPATION_BLOCKED", message: "Sanción vigente en la fecha del partido (ejemplo)." }]
      : index === 14 ? [{ code: "PARTICIPATION_RULE_PENDING", message: "Coincidencia de horarios: falta precisar la regla de participación por mitades." }] : [],
  }));
}

// Trazo inventado y rotulado; nunca se presenta como firma obtenida de una persona.
const syntheticSignature = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200"><rect width="600" height="200" fill="white"/><path d="M95 130 Q160 20 170 120 T245 80 Q260 145 310 105 T440 100" stroke="#123b4a" stroke-width="4" fill="none"/><text x="160" y="176" fill="#526371" font-size="20">FIRMA SINTÉTICA · DEMO</text></svg>');

export function createReportDemo(scenario: ReportDemoCase = "draft"): ReportDemoData {
  const players = [
    ...teamPlayers("home", ["Adrián Solís", "Bruno Valle", "Camilo Ríos", "Darío Luna", "Emilio Prado", "Fabián Soto", "Gael Rivera", "Hugo Montes", "Iván Robles", "Julián Vega", "Kevin Duarte", "Leo Paz", "Mateo Reyes", "Nicolás Pino", "Óscar Cano"]),
    ...teamPlayers("away", ["Pablo Sierra", "Rafael Mora", "Samuel León", "Tomás Arias", "Ulises Lara", "Valentín Cruz", "Walter Gil", "Xavier Roca", "Yahir Peña", "Zaid Flores", "Álex Salas", "Benjamín Olmo", "Cristian Neri", "Damián Ruiz", "Esteban Vidal"]),
  ];
  const confirmed = scenario === "confirmed";
  const empty = scenario === "empty";
  return {
    scenario, players, eventTypes,
    match: {
      id: REPORT_DEMO_MATCH_ID, number: "DEMO-018", version: 3,
      status: confirmed ? { code: "FINISHED", label: "Finalizado", captureAllowed: false }
        : scenario === "scheduled" ? { code: "SCHEDULED", label: "Programado", captureAllowed: false }
          : { code: "IN_PROGRESS", label: "En curso", captureAllowed: true },
      season: "Apertura 2026 · Demostración", category: "Primera libre", group: "Grupo A", matchday: "Jornada 7",
      venue: "Unidad Deportiva · Cancha de ejemplo", startsAt: "2026-11-15T16:00:00-06:00",
      home: { id: "home", name: "Deportivo Encinos", shortName: "Encinos", initials: "DE" },
      away: { id: "away", name: "Atlético Cantera", shortName: "Cantera", initials: "AC" },
    },
    report: {
      tactics: Object.fromEntries(["home", "away"].map(team => [team, {formation:"4-4-2" as const, slots:formationSlots("4-4-2").map((slot,i)=>({...slot,playerId:!empty?`${team}-${i+1}`:null})),kitSource:null,kit:null}])),
      lineupsLock: scenario === "setup" ? null : {operationId:"54000000-0000-4000-8000-000000000099",lockedAt:"2026-11-15T16:00:00Z"},
      ...(scenario === "clock-due" ? { clock: {phase:"FIRST_HALF" as const,phaseStartedAt:new Date(Date.now()-45*60000-1000).toISOString(),endedAt:null,halfMinutes:45,breakMinutes:15,extraMinutes:0,extraDeclared:false}} : {}),
      id: "report-demo-018", matchId: REPORT_DEMO_MATCH_ID, version: 2, status: confirmed ? "CONFIRMED" : "DRAFT",
      lineups: players.map((player, index) => ({
        playerId: player.id, selected: !empty && player.eligible, starter: index % 15 < 11,
        matchJersey: player.id === "home-7" ? 17 : player.usualJersey,
        periods: !empty && index % 15 < 11 ? [{ periodNumber: 1, entryMinute: 0, exitMinute: player.id === "home-7" ? 18 : null }]
          : !empty && player.id === "home-12" ? [{ periodNumber: 1, entryMinute: 18, exitMinute: null }] : [],
      })),
      captains: empty ? {} : { home: "home-4", away: "away-4" },
      events: empty ? [] : [
        { id: "event-1", typeCode: "GOAL", teamId: "home", playerId: "home-9", outgoingPlayerId: null, periodNumber: 1, minute: 12, description: "" },
        { id: "event-2", typeCode: "SUBSTITUTION", teamId: "home", playerId: "home-12", outgoingPlayerId: "home-7", periodNumber: 1, minute: 18, description: "" },
        { id: "event-3", typeCode: "CAUTION", teamId: "away", playerId: "away-5", outgoingPlayerId: null, periodNumber: null, minute: null, description: "Conducta antideportiva (ejemplo)." },
      ],
      score: { home: empty ? null : 1, away: empty ? null : 0 },
      remarks: empty ? "" : "Captura de ejemplo para revisar la interfaz. Los tiempos incompletos no representan minutos totales jugados.",
      incidents: "", signatures: confirmed ? {
        home: { captainId: "home-4", image: syntheticSignature, source: "synthetic" },
        away: { captainId: "away-4", image: syntheticSignature, source: "synthetic" },
      } : { home: null, away: null }, confirmedAt: confirmed ? "2026-11-15T18:10:00-06:00" : null,
    },
  };
}
