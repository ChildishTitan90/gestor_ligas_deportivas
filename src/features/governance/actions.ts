"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";
import { governanceMutation } from "./contract";
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

export async function submitAppointment(request: unknown): Promise<
  { status: "saved"; body: string | null } | { status: "rejected" | "uncertain" }
> {
  const input = governanceMutation.safeParse(request);
  if (!input.success || input.data.operation !== "appoint") return { status: "rejected" };
  try {
    return { status: "saved", body: await changeGovernance(input.data) };
  } catch (error) {
    if (error instanceof GovernanceError || error instanceof AuthAccessError || error instanceof AuthorizationError) {
      return { status: "rejected" };
    }
    return { status: "uncertain" };
  }
}