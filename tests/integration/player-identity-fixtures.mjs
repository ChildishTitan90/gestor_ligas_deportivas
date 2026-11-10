import pg from 'pg';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tsImport } from 'tsx/esm/api';
import { createAuthFixtures } from './auth-fixtures.mjs';
// Actores sintéticos de PDGLD-117, solo mediante supervisor IPC validado.
export async function prepareIdentityActors({databaseUrl}) {
  const db = new pg.Client({connectionString:databaseUrl});
  const prisma = new PrismaClient({adapter:new PrismaPg({connectionString:databaseUrl})});
  await db.connect();
  try {
    const users = await createAuthFixtures(db);
    const {loadPermissionCatalog} = await tsImport('../../prisma/permissions-catalog.ts',import.meta.url);
    const {installPermissionCatalog} = await tsImport('../../prisma/seed-permissions.ts',import.meta.url);
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(54,2026)::text`;
      await installPermissionCatalog(tx,await loadPermissionCatalog(),users.operational.id);
    });
  } finally { await db.end(); await prisma.$disconnect(); }
}
