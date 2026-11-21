"use server";
import { revalidatePath } from "next/cache";
import { cancelReviewedMatch, rescheduleAbsentMatch, transitionMatch } from "./server/service";
import { MatchTransitionError } from "./transition-rules";
import { AuthorizationError } from "@/server/auth/authorization";
import { getRescheduleSlots } from "./server/reschedule-slots";
import { confirmMatchday } from "./server/confirm-matchday";

export async function confirmMatchdayAction(input:unknown) {
  try {const result=await confirmMatchday(input);revalidatePath("/matches/recording");return {ok:true as const,result};}
  catch(error) {return {ok:false as const,code:error instanceof MatchTransitionError || error instanceof AuthorizationError ? error.code : "UNAVAILABLE"};}
}

export async function getRescheduleSlotsAction(input: unknown) {
  try { return { ok: true as const, slots: await getRescheduleSlots(input) }; }
  catch(error) { return { ok: false as const, code: error instanceof MatchTransitionError || error instanceof AuthorizationError ? error.code : "UNAVAILABLE" }; }
}

export async function transitionMatchAction(input: unknown) {
  try {
    await transitionMatch(input);
    revalidatePath("/matches");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, code: error instanceof MatchTransitionError || error instanceof AuthorizationError ? error.code : "UNAVAILABLE" };
  }
}

export async function cancelReviewedMatchAction(input:unknown) {
  try {await cancelReviewedMatch(input);revalidatePath("/matches/recording");return {ok:true as const};}
  catch(error) {return {ok:false as const,code:error instanceof MatchTransitionError || error instanceof AuthorizationError?error.code:"UNAVAILABLE"};}
}

export async function rescheduleAbsentMatchAction(input:unknown) {
  try {
    const result=await rescheduleAbsentMatch(input);
    revalidatePath("/matches"); revalidatePath("/matches/recording");
    return {ok:true as const,pdfVersion:result.pdfVersion};
  } catch(error) {
    return {ok:false as const,code:error instanceof MatchTransitionError || error instanceof AuthorizationError ? error.code : "UNAVAILABLE"};
  }
}
