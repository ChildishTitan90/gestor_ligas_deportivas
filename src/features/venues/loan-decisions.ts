/** Transiciones del préstamo entre clubes. La identidad se verifica en servidor. */
export type LoanStage = "OWNER_PENDING" | "LEAGUE_PENDING" | "APPROVED" | "REJECTED";
export type LoanDecision = "APPROVED" | "REJECTED";
export type LoanDecisionActor = "OWNER_DELEGATE" | "LEAGUE";

export function nextLoanStage(stage: LoanStage, actor: LoanDecisionActor, decision: LoanDecision): LoanStage {
  if (stage === "OWNER_PENDING" && actor === "OWNER_DELEGATE")
    return decision === "APPROVED" ? "LEAGUE_PENDING" : "REJECTED";
  if (stage === "LEAGUE_PENDING" && actor === "LEAGUE")
    return decision === "APPROVED" ? "APPROVED" : "REJECTED";
  throw new Error("LOAN_DECISION_NOT_ALLOWED");
}
