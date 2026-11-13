import "server-only";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { transitionMatchInTransaction } from "./transition";

/** Entrada de servidor para las futuras acciones de programación de PDGLD-133. */
export async function transitionMatch(input: unknown) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(tx => transitionMatchInTransaction(tx, actor.id, input));
}
