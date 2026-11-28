import "server-only";
import { redirect } from "next/navigation";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { BillingError } from "./access";

export async function billingPageQuery<T>(read: () => Promise<T>) {
  try { return await read(); }
  catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    if (error instanceof AuthorizationError) return null;
    if (error instanceof BillingError && error.message === "INVALID_FILTERS") redirect("/treasury/charges");
    throw error;
  }
}
