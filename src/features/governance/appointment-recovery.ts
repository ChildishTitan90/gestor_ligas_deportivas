import { governanceMutation } from "./contract";
import type { z } from "zod";

export type AppointmentRequest = Extract<z.infer<typeof governanceMutation>, { operation: "appoint" }>;

export function readAppointment(storage: Pick<Storage, "getItem">, key: string): AppointmentRequest | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  const result = governanceMutation.safeParse(JSON.parse(raw));
  if (!result.success || result.data.operation !== "appoint") throw new Error("Invalid pending appointment");
  return result.data;
}

export async function sendAppointment<T>(
  storage: Pick<Storage, "setItem">, key: string, request: AppointmentRequest,
  send: (request: AppointmentRequest) => Promise<T>,
): Promise<T> {
  storage.setItem(key, JSON.stringify(request));
  return send(request);
}
