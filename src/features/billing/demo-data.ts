import { chargeConcept } from "./schemas";
import type { ChargeDetail, ChargeFilters, ChargeRecipient, ChargeSeason } from "./types";

export type DemoSeason = ChargeSeason & { recipients: readonly ChargeRecipient[] };

const league = "Liga de demostración";
const vistaClub = { kind: "CLUB", id: "20000000-0000-4000-8000-000000000001", club: "Atlético Vista Verde", name: "Atlético Vista Verde" } as const;
const miradorClub = { kind: "CLUB", id: "20000000-0000-4000-8000-000000000002", club: "Deportivo Mirador", name: "Deportivo Mirador" } as const;
const vistaTeam = { kind: "TEAM", id: "30000000-0000-4000-8000-000000000001", club: vistaClub.name, name: "Vista Verde Mayor", category: "Mayor" } as const;
const miradorTeam = { kind: "TEAM", id: "30000000-0000-4000-8000-000000000002", club: miradorClub.name, name: "Mirador Juvenil", category: "Juvenil" } as const;
const apertura = { id: "10000000-0000-4000-8000-000000000001", name: "Apertura de prueba", league };
const clausura = { id: "10000000-0000-4000-8000-000000000002", name: "Clausura de prueba", league };

export const demoSeasons: readonly DemoSeason[] = [
  { ...apertura, recipients: [vistaClub, miradorClub, vistaTeam, miradorTeam] },
  { ...clausura, recipients: [vistaClub, miradorClub, { ...miradorTeam, id: "30000000-0000-4000-8000-000000000003", name: "Mirador Reserva", category: "Reserva" }] },
];
export const demoRecipients = [...new Map(
  demoSeasons.flatMap(season => season.recipients).map(recipient => [recipient.id, recipient]),
).values()];

export const demoCharges: readonly ChargeDetail[] = [
  {
    id: "40000000-0000-4000-8000-000000000001", version: 2,
    season: apertura, recipient: vistaClub, concept: "REGISTRATION", frequency: "ONCE",
    amount: "480.00", currency: "MXN", payment: { paid: "0.00", balance: "480.00" },
    issuedOn: "2026-11-02", dueOn: "2026-11-20", periodStart: "2026-11-01", periodEnd: "2026-11-30",
    history: [
      { id: "2", event: "UPDATED", at: "2026-11-04T16:05:00Z", actorLabel: "Tesorería de prueba",
        reason: "Corrección de la fecha de vencimiento en el expediente de prueba.", change: "Vencimiento del 18 al 20 de noviembre de 2026." },
      { id: "1", event: "CREATED", at: "2026-11-02T16:05:00Z", actorLabel: "Tesorería de prueba", reason: "Captura inicial de la inscripción de prueba." },
    ],
  },
  {
    id: "40000000-0000-4000-8000-000000000002", version: 1,
    season: apertura, recipient: miradorTeam, concept: "REFEREE_FEE", frequency: "WEEKLY",
    amount: "175.50", currency: "MXN", payment: { paid: "0.00", balance: "175.50" },
    issuedOn: "2026-11-09", dueOn: "2026-11-16", periodStart: "2026-11-09", periodEnd: "2026-11-15",
    billingPlanId: "50000000-0000-4000-8000-000000000001",
    history: [{ id: "1", event: "CREATED", at: "2026-11-09T16:05:00Z", actorLabel: "Tesorería de prueba", reason: "Ejemplo de cargo asociado a un plan semanal." }],
  },
  {
    id: "40000000-0000-4000-8000-000000000003", version: 1,
    season: clausura, recipient: miradorClub, concept: "VENUE", frequency: "ONCE",
    amount: "250.00", currency: "MXN", payment: { paid: "100.00", balance: "150.00" },
    issuedOn: "2026-10-01", dueOn: "2026-10-15", periodStart: "2026-10-01", periodEnd: "2026-10-31",
    history: [{ id: "1", event: "CREATED", at: "2026-10-01T16:05:00Z", actorLabel: "Tesorería de prueba", reason: "Captura inicial del uso de cancha de prueba." }],
  },
];

export const demoMonths = ["2026-11", "2026-10"] as const;
export const chargesPath = "/treasury/charges";
export type DemoQuery = Record<string, string | string[] | undefined>;

export function readChargeFilters(query: DemoQuery): ChargeFilters {
  const { season, recipient, concept, period } = query;
  const selectedSeason = demoSeasons.find(item => item.id === season);
  const parsedConcept = chargeConcept.safeParse(concept);
  return {
    season: selectedSeason?.id,
    recipient: demoRecipients.find(item => item.id === recipient)?.id,
    concept: parsedConcept.success ? parsedConcept.data : undefined,
    period: demoMonths.find(month => month === period),
  };
}

export function chargesUrl(path: string, filters: ChargeFilters) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value) params.set(name, value);
  return params.size ? `${path}?${params}` : path;
}

export function filterDemoCharges(filters: ChargeFilters) {
  return demoCharges.filter(charge =>
    (!filters.season || charge.season.id === filters.season)
    && (!filters.recipient || charge.recipient.id === filters.recipient)
    && (!filters.concept || charge.concept === filters.concept)
    && (!filters.period || (charge.periodStart.slice(0, 7) <= filters.period && charge.periodEnd.slice(0, 7) >= filters.period)),
  );
}

export function readDemoResponse(value: DemoQuery[string]) {
  return value === "error" || value === "uncertain" || value === "retry" ? value : "confirmed";
}

export type DemoResponse = ReturnType<typeof readDemoResponse>;
