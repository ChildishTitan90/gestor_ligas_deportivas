import "server-only";

import { SerialPrismaPg } from "./transaction-queue";
import { Prisma,PrismaClient } from "@prisma/client";
import {createHash} from "node:crypto";
import { getDatabaseConnectionOptions } from "./connection-options";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaCacheKey?:string };
// HMR conserva globalThis incluso cuando cambian los delegados generados.
// Incluir el modelo generado y la fábrica evita reutilizar un cliente anterior.
const cacheKey=createHash("sha256").update(JSON.stringify(["serial-pg-v1",Prisma.dmmf.datamodel])).digest("hex");
let client: PrismaClient | undefined;

export function getPrisma(): PrismaClient {
  if (client) return client;
  if (globalForPrisma.prisma && globalForPrisma.prismaCacheKey===cacheKey) return (client = globalForPrisma.prisma);
  const previous=globalForPrisma.prisma;

  client = new PrismaClient({
    adapter: new SerialPrismaPg(getDatabaseConnectionOptions()),
    log: [],
  });
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;globalForPrisma.prismaCacheKey=cacheKey;
    // Liberar el pool del singleton retirado, sin desconectar el compatible.
    if(previous)void previous.$disconnect().catch(()=>undefined);
  }
  return client;
}
