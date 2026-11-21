"use server";
import { revalidatePath } from "next/cache";
import { requireOperationalUser } from "@/server/auth/session";
import { activatePreviouslyApprovedProposalForActor } from "./server/adjustment";

export async function activateApprovedSchedule(input:unknown) {
  const actor=await requireOperationalUser();
  const result=await activatePreviouslyApprovedProposalForActor(actor.id,input);
  if(result.code==="SCHEDULE_ACTIVATED") { revalidatePath("/scheduling/proposals"); revalidatePath("/matches/recording"); }
  return result;
}
