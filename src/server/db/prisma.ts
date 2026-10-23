import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { getDatabaseConnectionOptions } from "./connection-options";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (client) return client;
  if (globalForPrisma.prisma) return (client = globalForPrisma.prisma);

  client = new PrismaClient({
    adapter: new PrismaPg(getDatabaseConnectionOptions()),
    log: [],
  });
  if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = client;
  return client;
}
