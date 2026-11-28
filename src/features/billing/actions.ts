"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";
import { BillingError } from "./server/access";
import { executeBillingCommand, readBillingOperation } from "./server/service";
import type { BillingResult } from "./types";

function failure(error: unknown): BillingResult {
  if (error instanceof ZodError) return { status: "REJECTED", code: "INVALID_INPUT" };
  if (error instanceof AuthorizationError || error instanceof AuthAccessError) return { status: "REJECTED", code: "FORBIDDEN" };
  if (error instanceof BillingError) return { status: "REJECTED", code: error.message };
  return { status: "UNCERTAIN" };
}
export async function saveBillingCommand(input: unknown): Promise<BillingResult> {
  try {
    const receipt = await executeBillingCommand(input);
    revalidatePath("/treasury/charges");
    return { status: "CONFIRMED", receipt };
  } catch (error) { return failure(error); }
}
export async function consultBillingOperation(input: unknown): Promise<BillingResult> {
  try { return await readBillingOperation(input); }
  catch (error) { return failure(error); }
}
