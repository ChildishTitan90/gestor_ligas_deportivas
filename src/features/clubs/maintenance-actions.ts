"use server";
import { revalidatePath } from "next/cache";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { getMaintenanceHistory, maintainClubOrTeam, MaintenanceError } from "./server/maintenance";

export async function maintainClubOrTeamAction(input: unknown) {
  try {
    await maintainClubOrTeam(input);
    revalidatePath("/clubs");
    revalidatePath("/teams/registrations");
    revalidatePath("/access", "layout");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, code: error instanceof MaintenanceError || error instanceof AuthorizationError || error instanceof AuthAccessError ? error.code : "UNAVAILABLE" };
  }
}
export async function maintenanceHistoryAction(kind: "club" | "team", id: string) {
  try { return { ok: true as const, items: await getMaintenanceHistory(kind, id) }; }
  catch { return { ok: false as const, items: [] }; }
}
