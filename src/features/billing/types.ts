import type { ChargeCapture, CreateCharge } from "./schemas";

export type ChargeConcept = CreateCharge["concept"];
export type ChargeFrequency = CreateCharge["frequency"];
export type ChargeSeason = { id: string; name: string; league: string };
export type ChargeRecipient =
  | { kind: "CLUB"; id: string; name: string; club: string }
  | { kind: "TEAM"; id: string; name: string; club: string; category: string };

export type ChargeTerms = Pick<ChargeCapture, "amount" | "dueOn" | "periodStart" | "periodEnd" | "frequency"> & {
  concept: ChargeConcept;
  currency: "MXN";
  season: ChargeSeason;
  recipient: ChargeRecipient;
};

export type ChargeSummary = ChargeTerms & {
  id: string;
  version: number;
  payment: { paid: string; balance: string } | null;
};

export type ChargeHistoryEntry = {
  id: string;
  event: "CREATED" | "UPDATED" | "VOIDED";
  at: string;
  actorLabel: string;
  reason: string;
  change?: string;
};

export type ChargeDetail = ChargeSummary & {
  issuedOn: string;
  history: readonly ChargeHistoryEntry[];
  billingPlanId?: string;
  resolutionId?: string;
};

export type CreateChargeErrorCode =
  | "INVALID_INPUT" | "FORBIDDEN" | "CONTEXT_CHANGED" | "DUPLICATE_CHARGE"
  | "POLICY_UNCONFIRMED" | "RESOLUTION_UNAVAILABLE" | "UNAVAILABLE";

export type CreateChargeResult =
  | { status: "CONFIRMED"; operationId: string; chargeIds: readonly [string, ...string[]] }
  | { status: "REJECTED"; code: CreateChargeErrorCode; fieldErrors?: Partial<Record<keyof ChargeCapture, string>> };

export type ChargeOperationResult = CreateChargeResult | { status: "UNCONFIRMED" | "NOT_APPLIED" };

export type ChargeFilters = { season?: string; recipient?: string; concept?: ChargeConcept; period?: string };
