import { evaluatePlayerAge } from "./player-policy";
import { isPlayerRegistrationDay } from "./player-policy";
import { playerPolicySchema } from "./schemas";

export type PlayerMovementInput =
  | { operation: "REGISTER"; policy: unknown; birthDate: string; now: Date }
  | { operation: "WITHDRAW" };

export type PlayerAdmissionBlocker = {
  code: "INVALID_OPERATION" | "PLAYER_POLICY_PENDING" | "INVALID_CLOCK"
    | "INVALID_BIRTH_DATE" | "AGE_OUTSIDE_RANGE" | "AGE_EXCEPTION_REQUIRED"
    | "REGISTRATION_WINDOW_CLOSED";
  message: string;
};

export type PlayerMovementEvaluation = {
  status: "RULES_SATISFIED" | "BLOCKED";
  blockers: PlayerAdmissionBlocker[];
};

/** Reglas puras, sin conceder permisos ni habilitación deportiva.
 * El consumidor obtiene política vigente y reloj del servidor, dentro de su
 * transacción autorizada. WITHDRAW solo omite estas restricciones de alta.
 */
export function evaluatePlayerMovement(input: PlayerMovementInput): PlayerMovementEvaluation {
  const blockers: PlayerAdmissionBlocker[] = [];
  const block = (code: PlayerAdmissionBlocker["code"], message: string) => {
    blockers.push({ code, message });
  };
  const result = (): PlayerMovementEvaluation => ({
    status: blockers.length ? "BLOCKED" : "RULES_SATISFIED", blockers,
  });

  if (input.operation === "WITHDRAW") return result();
  if (input.operation !== "REGISTER") {
    block("INVALID_OPERATION", "El trámite indicado no es válido.");
    return result();
  }

  const parsed = playerPolicySchema.safeParse(input.policy);
  if (!parsed.success) {
    block("PLAYER_POLICY_PENDING", "Falta una política deportiva válida para esta categoría y temporada.");
    return result();
  }
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    block("INVALID_CLOCK", "No fue posible comprobar la fecha del trámite. Intenta nuevamente.");
    return result();
  }

  const policy = parsed.data;
  const age = evaluatePlayerAge(policy, input.birthDate);
  if (age.status === "INVALID_BIRTH_DATE") {
    block("INVALID_BIRTH_DATE", "Indica una fecha de nacimiento válida.");
  } else {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: policy.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(input.now);
    const part = (name: string) => parts.find(item => item.type === name)?.value;
    const today = `${part("year")}-${part("month")}-${part("day")}`;
    if (input.birthDate > today) {
      block("INVALID_BIRTH_DATE", "La fecha de nacimiento no puede ser posterior a la fecha del trámite.");
    } else if (age.status === "OUTSIDE_RANGE") {
      block("AGE_OUTSIDE_RANGE", `La edad por año de nacimiento no cumple el rango configurado para ${policy.referenceYear}.`);
    } else if (age.status === "REQUIRES_ADMIN_APPROVAL") {
      block("AGE_EXCEPTION_REQUIRED", "La edad requiere una excepción autorizada; presentar una carta no constituye aprobación.");
    }
  }

  if (!isPlayerRegistrationDay(policy, input.now)) {
    block("REGISTRATION_WINDOW_CLOSED", `El alta está fuera de los días configurados para esta categoría (${policy.timezone}).`);
  }
  return result();
}
