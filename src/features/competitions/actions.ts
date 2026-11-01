"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthAccessError } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { createSeason, SeasonInputError } from "./server/seasons";
import { createLeague } from "./server/leagues";
import { CompetitionError } from "./server/configuration";

export async function createLeagueAction(form: FormData) {
  let errorCode = "";
  try {
    await createLeague({ name: form.get("name"), timezone: form.get("timezone"), reason: form.get("reason") });
  } catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    errorCode = error instanceof CompetitionError ? error.code : error instanceof AuthorizationError ? "FORBIDDEN" : "UNAVAILABLE";
  }
  if (errorCode) redirect(`/competitions/leagues/new?error=${errorCode}`);
  revalidatePath("/competitions/seasons");
  redirect("/competitions/leagues/new?created=1");
}

export async function createSeasonAction(form: FormData) {
  let errorCode = "";
  try {
    await createSeason({ leagueId: form.get("leagueId"), name: form.get("name"), startDate: form.get("startDate"), endDate: form.get("endDate") });
  } catch (error) {
    if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
    errorCode = error instanceof SeasonInputError ? error.code : error instanceof AuthorizationError ? "FORBIDDEN" : "UNAVAILABLE";
  }
  if (errorCode) redirect(`/competitions/seasons?error=${errorCode}`);
  revalidatePath("/competitions/seasons");
  redirect("/competitions/seasons?created=1");
}
