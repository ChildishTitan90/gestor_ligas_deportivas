"use server";
import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";
import { CatalogError, mutateCatalog } from "./server/catalog";

export async function saveCatalog(input: unknown) {
  try {
    const result = await mutateCatalog(input);
    revalidatePath("/discipline/catalog");
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof CatalogError) return { ok: false as const, code: error.message };
    if (error instanceof AuthorizationError || error instanceof AuthAccessError) return { ok: false as const, code: "FORBIDDEN" };
    // Una escritura puede haber confirmado antes de perder la respuesta: conservar operación.
    return { ok: false as const, code: "UNCERTAIN" };
  }
}
