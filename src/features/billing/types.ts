import type { ChargeCapture, CreateCharge } from "./schemas";

export type ChargeConcept = CreateCharge["concept"];
export type ChargeFrequency = CreateCharge["frequency"];
export type ChargeSeason = { id: string; name: string; league: string };
export type BillingSeason = ChargeSeason & { recipients: readonly ChargeRecipient[] };
export type ChargeRecipient =
  | { kind: "CLUB"; id: string; name: string; club: string }
  | { kind: "TEAM"; id: string; name: string; club: string; category: string };

export type ChargeTerms = Pick<ChargeCapture, "amount" | "dueOn" | "periodStart" | "periodEnd" | "frequency"> & {
  concept: ChargeConcept;
  currency: "MXN";
  season: ChargeSeason;
  recipient: ChargeRecipient;
  automation?: { label: string; revision: number };
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
  canModify?: boolean;
  modificationBlocked?: string;
};

export type ChargeFilters = { season?: string; recipient?: string; concept?: ChargeConcept; period?: string; league?: string; page?: string };

export type BillingReceipt = {
  operationId: string; chargeId?: string; planId?: string; version?: number; existing: boolean;
};
export type BillingResult =
  | { status: "CONFIRMED"; receipt: BillingReceipt }
  | { status: "REJECTED"; code: string }
  | { status: "UNCERTAIN" | "NOT_APPLIED" };
export type BillingPlan = ChargeTerms & { id: string; canGenerate?: boolean };
