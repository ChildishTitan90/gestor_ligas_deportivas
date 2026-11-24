import { ProcessSteps } from "@/components/ui/process-steps";

export function AffiliationReviewSteps({ phase }: {
  phase: "AWAITING_REVIEW" | "CORRECTIONS_REQUESTED" | "APPROVED" | "REJECTED";
}) {
  const resolved = phase === "APPROVED" || phase === "REJECTED";
  const review = phase === "CORRECTIONS_REQUESTED" ? "Corregir solicitud" : "Revisión de Secretaría";
  return <ProcessSteps steps={["Solicitud enviada", review, "Resolución"]}
    current={resolved ? 3 : 1} label="Avance de la afiliación" />;
}
