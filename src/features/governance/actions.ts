"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";
import { changeGovernance, GovernanceError } from "./server/service";

export async function saveGovernance(form: FormData) {
  const params = new URLSearchParams();
  const league = z.uuid().safeParse(form.get("leagueId"));
  if (league.success) params.set("league", league.data);
  try {
    const body = await changeGovernance(Object.fromEntries(form));
    if (body) params.set("body", body);
    params.set("saved", "1");
  } catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    const code = error instanceof GovernanceError ? error.message
      : error instanceof AuthorizationError ? "FORBIDDEN"
      : error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002" ? "DUPLICATE"
      : "UNAVAILABLE";
    params.set("error", code);
  }
  redirect(`/governance?${params}`);
}
