"use server";
import { revalidatePath } from "next/cache";
import { transitionMatch } from "./server/service";
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
