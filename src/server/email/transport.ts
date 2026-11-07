import "server-only";

// El adaptador recibe el secreto solo en memoria. No debe registrar payloads.
export type AccountEmail =
  | { kind: "ADMINISTRATIVE_RESET"; to: string; temporaryPassword: string; expiresAt: Date; idempotencyKey: string }
  | { kind: "EMAIL_CHANGE_CONFIRMATION"; to: string; token: string; expiresAt: Date; idempotencyKey: string }
  | { kind: "EMAIL_CHANGE_REQUESTED" | "EMAIL_CHANGE_COMPLETED"; to: string; idempotencyKey: string };
export interface EmailTransport {
  // ACCEPTED significa aceptación del proveedor, nunca prueba de recepción/propiedad.
  send(message: AccountEmail): Promise<"ACCEPTED" | "FAILED" | "UNKNOWN">;
}
// Conexión real deliberadamente ausente. No hay fallback simulado en aplicación.
export function getEmailTransport(): EmailTransport | null { return null; }
