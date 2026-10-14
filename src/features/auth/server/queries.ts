import "server-only";

import { requireOperationalUser } from "@/server/auth/session";

export async function getAccessIdentity() {
  return requireOperationalUser();
}
