import "server-only";

import { cache } from "react";
import { AuthorizationError, getActorPermissionGrants } from "@/server/auth/authorization";
import { AuthAccessError, requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { demoCharges, demoSeasons, filterDemoCharges, readChargeFilters, readDemoResponse, type DemoQuery } from "../demo-data";

/** La muestra abarca varios clubes ficticios. Su acceso no amplía el ámbito de una cuenta delegada. */
const getChargeDemoAccess = cache(async () => {
  try {
    const actor = await requireOperationalUser();
    const grants = await getPrisma().$transaction(tx => getActorPermissionGrants(tx, actor.id));
    const billing = grants.filter(grant => grant.module === "billing" && !grant.contextOnly && !grant.clubId);
    return {
      read: billing.some(grant => grant.action === "READ"),
      create: billing.some(grant => grant.action === "CREATE"),
    };
  } catch (error) {
    if (error instanceof AuthAccessError || error instanceof AuthorizationError) return { read: false, create: false };
    throw error;
  }
});

export async function canReadChargeDemo() {
  return (await getChargeDemoAccess()).read;
}

export async function getChargeDemoList(query: DemoQuery) {
  const access = await getChargeDemoAccess();
  if (!access.read) return null;
  const filters = readChargeFilters(query);
  return {
    filters,
    canCreate: access.create,
    league: demoSeasons[0].league,
    season: demoSeasons.find(item => item.id === filters.season),
    charges: query.demo === "error" ? null : filterDemoCharges(filters),
  };
}

export async function getChargeDemoCapture(query: DemoQuery) {
  const access = await getChargeDemoAccess();
  if (!access.read) return { status: "DENIED" } as const;
  const filters = readChargeFilters(query);
  if (!access.create) return { status: "READ_ONLY", filters } as const;
  return { status: "READY", filters, seasons: demoSeasons, response: readDemoResponse(query.response) } as const;
}

export async function getChargeDemoDetail(chargeId: string) {
  if (!(await getChargeDemoAccess()).read) return { status: "DENIED" } as const;
  return { status: "READ", charge: demoCharges.find(item => item.id === chargeId) } as const;
}
