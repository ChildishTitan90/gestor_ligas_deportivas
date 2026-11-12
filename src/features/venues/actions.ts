"use server";

import { Prisma } from "@prisma/client";
import { redirect } from "next/navigation";
import { AuthorizationError } from "@/server/auth/authorization";
import { AuthAccessError } from "@/server/auth/session";
import { venueIdSchema } from "./schemas";
import { getVenueTimeZone, removeInterval, saveInterval, saveVenue, VenueInputError } from "./server/service";
import { venueTimeToIso } from "./time";

function venueUrl(league: unknown, venue: unknown, status: string, error = false) {
  const query = new URLSearchParams({ [error ? "error" : "saved"]: status });
  if (venueIdSchema.safeParse(league).success) query.set("league", String(league));
  if (venueIdSchema.safeParse(venue).success) query.set("venue", String(venue));
  return `/venues?${query}`;
}

function errorCode(error: unknown) {
  if (error instanceof AuthAccessError) redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
  if (error instanceof AuthorizationError) return "FORBIDDEN";
  if (error instanceof VenueInputError) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") return "DUPLICATE_CODE";
    if (error.code === "P2004" || error.message.includes("venue_availability_no_overlap")) return "INTERVAL_CONFLICT";
    if (error.code === "P2034") return "RETRY";
  }
  return "UNAVAILABLE";
}

export async function saveVenueAction(form: FormData) {
  let result: Awaited<ReturnType<typeof saveVenue>>;
  try {
    result = await saveVenue(Object.fromEntries(form));
  } catch (error) {
    redirect(venueUrl(form.get("leagueId"), form.get("venueId"), errorCode(error), true));
  }
  redirect(venueUrl(result.leagueId, result.venueId, "venue"));
}

export async function saveIntervalAction(form: FormData) {
  let result: Awaited<ReturnType<typeof saveInterval>>;
  try {
    const timeZone = await getVenueTimeZone(form.get("venueId"));
    result = await saveInterval({
      ...Object.fromEntries(form),
      start: venueTimeToIso(form.get("start"), timeZone),
      end: venueTimeToIso(form.get("end"), timeZone),
    });
  } catch (error) {
    redirect(venueUrl(form.get("leagueId"), form.get("venueId"), errorCode(error), true));
  }
  redirect(venueUrl(result.leagueId, result.venueId, "interval"));
}

export async function removeIntervalAction(form: FormData) {
  let result: Awaited<ReturnType<typeof removeInterval>>;
  try {
    result = await removeInterval(form.get("venueId"), form.get("intervalId"));
  } catch (error) {
    redirect(venueUrl(form.get("leagueId"), form.get("venueId"), errorCode(error), true));
  }
  redirect(venueUrl(result.leagueId, result.venueId, "removed"));
}
