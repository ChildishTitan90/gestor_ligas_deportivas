"use server";
import { revalidatePath } from "next/cache";
import { rescheduleAbsentMatch, transitionMatch } from "./server/service";
import { MatchTransitionError } from "./transition-rules";
import { AuthorizationError } from "@/server/auth/authorization";

export async function transitionMatchAction(input: unknown) {
  try {
    await transitionMatch(input);
    revalidatePath("/matches");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, code: error instanceof MatchTransitionError || error instanceof AuthorizationError ? error.code : "UNAVAILABLE" };
  }
}

export async function rescheduleAbsentMatchAction(input:unknown) {
  try {
    await rescheduleAbsentMatch(input);
    revalidatePath("/matches"); revalidatePath("/matches/recording");
    return {ok:true as const};
  } catch(error) {
    return {ok:false as const,code:error instanceof MatchTransitionError || error instanceof AuthorizationError ? error.code : "UNAVAILABLE"};
  }
}
