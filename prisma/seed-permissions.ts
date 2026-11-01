import { createHash } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { SEED_ACTOR } from "./seed-data";
import { readSeedDatabaseUrl, SeedConfigurationError } from "./seed-env";
import { seedBaseDatabase } from "./seed-runner";
import { validatePermissionCatalog, type PermissionGrant } from "./permissions-catalog";

export const MATRIX_INSTALLATION = {
  id: "54000000-0000-4000-8000-000000000051",
  tableName: "seed_permission_matrix",
  action: "INSTALL",
  reason: "PDGLD-54: instalación inicial de la matriz RF22 de PDGLD-55",
} as const;

function fingerprint(catalog: readonly PermissionGrant[]) {
  const sorted = [...catalog].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256").update(JSON.stringify(sorted)).digest("hex");
}

/** Extensión independiente de RF22; se instala una vez y nunca restaura revocaciones. */
export async function installLeagueCreationPermission(tx: Prisma.TransactionClient, actorId: string) {
  await installSecretaryCompetitionPermissions(tx, actorId);
  const id = "54000000-0000-4000-8000-000000000053";
  const tableName = "seed_league_creation_permission";
  const existing = await tx.audit_logs.findUnique({ where: { id } });
  if (existing) {
    if (existing.table_name !== tableName || existing.action !== "INSTALL") throw new SeedConfigurationError("Marcador de permiso de ligas ocupado; no se modificó.");
    return;
  }
  const reason = "Instalación inicial del permiso global de creación de ligas";
  await tx.$queryRaw`SELECT set_config('app.user_id', ${actorId}, true), set_config('app.reason', ${reason}, true)`;
  if (await tx.permissions.findUnique({ where: { module_action: { module: "leagues", action: "CREATE" } } }))
    throw new SeedConfigurationError("El permiso para crear ligas ya existe sin marcador; revisa su procedencia.");
  const permission = await tx.permissions.create({ data: { module: "leagues", action: "CREATE" } });
  for (const code of ["SUPERADMIN", "SECRETARY"]) {
    const role = await tx.roles.findUniqueOrThrow({ where: { code }, select: { id: true } });
    await tx.role_permissions.create({ data: { role_id: role.id, permission_id: permission.id, context_only: false } });
  }
  await tx.audit_logs.create({ data: { id, user_id: actorId, action: "INSTALL", table_name: tableName,
    entity_id: id, reason, new_data: { module: "leagues", action: "CREATE", roles: ["SUPERADMIN", "SECRETARY"] } } });
}

/** Ampliación autorizada en PDGLD-38, independiente de la matriz inicial RF22. */
export async function installSecretaryCompetitionPermissions(tx: Prisma.TransactionClient, actorId: string) {
  const id = "54000000-0000-4000-8000-000000000054";
  const tableName = "seed_secretary_competition_permissions";
  const previous = await tx.audit_logs.findUnique({ where: { id } });
  if (previous) {
    if (previous.table_name !== tableName || previous.action !== "INSTALL")
      throw new SeedConfigurationError("Marcador de permisos de Secretaría ocupado; no se modificó.");
    return;
  }
  const reason = "PDGLD-38: habilitar gestión de temporadas para Secretaría dentro de sus ámbitos asignados";
  await tx.$queryRaw`SELECT set_config('app.user_id', ${actorId}, true), set_config('app.reason', ${reason}, true)`;
  const role = await tx.roles.findUniqueOrThrow({ where: { code: "SECRETARY" }, select: { id: true } });
  for (const action of ["CREATE", "UPDATE"] as const) {
    const permission = await tx.permissions.findUniqueOrThrow({ where: { module_action: { module: "competitions", action } }, select: { id: true } });
    const existing = await tx.role_permissions.findFirst({ where: { role_id: role.id, permission_id: permission.id } });
    if (!existing) await tx.role_permissions.create({ data: { role_id: role.id, permission_id: permission.id, context_only: false } });
  }
  await tx.audit_logs.create({ data: { id, user_id: actorId, action: "INSTALL", table_name: tableName,
    entity_id: id, reason, new_data: { role: "SECRETARY", module: "competitions", actions: ["CREATE", "UPDATE"], source: "PDGLD-38" } } });
}

/** El llamador mantiene el bloqueo (54,2026) y la transacción de instalación. */
export async function installPermissionCatalog(tx: Prisma.TransactionClient, catalog: readonly PermissionGrant[], actorId: string) {
  const previous = await tx.audit_logs.findUnique({ where: { id: MATRIX_INSTALLATION.id } });
  const catalogFingerprint = fingerprint(catalog);
  if (previous) {
    if (previous.table_name !== MATRIX_INSTALLATION.tableName || previous.action !== MATRIX_INSTALLATION.action) {
      throw new SeedConfigurationError("El identificador reservado de instalación pertenece a otro evento; no se modificó.");
    }
    // Un historial inmutable distingue instalar de reconciliar/restaurar concesiones.
    return { installed: false, fingerprint: catalogFingerprint };
  }
  if (await tx.role_permissions.count() !== 0 ||
      await tx.audit_logs.count({ where: { table_name: "role_permissions" } }) !== 0) {
    throw new SeedConfigurationError("Existen concesiones o historial de permisos sin marcador de instalación; revisa su procedencia antes de instalar RF22. No se restauraron permisos.");
  }
  await tx.$queryRaw`SELECT set_config('app.user_id', ${actorId}, true),
    set_config('app.reason', ${MATRIX_INSTALLATION.reason}, true)`;
  for (const grant of catalog) {
    const role = await tx.roles.findUniqueOrThrow({ where: { code: grant.roleCode }, select: { id: true } });
    const permission = await tx.permissions.upsert({
      where: { module_action: { module: grant.module, action: grant.action } },
      update: {}, create: { module: grant.module, action: grant.action }, select: { id: true },
    });
    await tx.role_permissions.create({ data: {
      role_id: role.id, permission_id: permission.id, context_only: grant.contextOnly,
    } });
  }
  // role_permissions ya tiene record_audit; este evento documenta exclusivamente
  // la instalación completa y actúa como marcador inmutable, no duplica cambios.
  await tx.audit_logs.create({ data: {
    id: MATRIX_INSTALLATION.id, user_id: actorId, action: MATRIX_INSTALLATION.action,
    table_name: MATRIX_INSTALLATION.tableName, entity_id: MATRIX_INSTALLATION.id,
    reason: MATRIX_INSTALLATION.reason,
    new_data: { fingerprint: catalogFingerprint, grantCount: catalog.length, source: "prisma/permissions-data.ts", references: [...new Set(catalog.map(grant => grant.ersReference))] },
  } });
  return { installed: true, fingerprint: catalogFingerprint };
}

export async function seedPermissionDatabase(prisma: PrismaClient, input: unknown, environment = process.env) {
  readSeedDatabaseUrl(environment);
  const catalog = validatePermissionCatalog(input);
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(47, 2026)::text`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(54, 2026)::text`;
    await seedBaseDatabase(tx);
    const actor = await tx.users.findUniqueOrThrow({ where: { person_id: SEED_ACTOR.personId }, select: { id: true } });
    const matrix = await installPermissionCatalog(tx, catalog, actor.id);
    await installLeagueCreationPermission(tx, actor.id);
    return matrix;
  }, { maxWait: 10_000, timeout: 30_000 });
}
