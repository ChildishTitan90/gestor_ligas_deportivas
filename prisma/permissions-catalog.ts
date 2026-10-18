import { access } from "node:fs/promises";
import { SEED_ROLES } from "./seed-data";
import { SeedConfigurationError } from "./seed-env";

/** Contrato de integración PDGLD-55. Este archivo valida; no define la matriz. */
export type PermissionGrant = Readonly<{
  roleCode: string;
  module: string;
  action: "CREATE" | "READ" | "UPDATE" | "APPROVE" | "PUBLISH" | "IMPORT";
  contextOnly: boolean;
  ersReference: string;
}>;

const actions = new Set(["CREATE", "READ", "UPDATE", "APPROVE", "PUBLISH", "IMPORT"]);
const roles = new Set<string>(SEED_ROLES.map(role => role.code));

export function validatePermissionCatalog(value: unknown): readonly PermissionGrant[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SeedConfigurationError("El catálogo PDGLD-55 debe exportar una matriz de concesiones no vacía.");
  }
  const keys = new Set<string>();
  return value.map((entry: unknown) => {
    if (entry === null || typeof entry !== "object") {
      throw new SeedConfigurationError("El catálogo PDGLD-55 contiene una concesión inválida.");
    }
    const grant = entry as Record<string, unknown>;
    if (typeof grant.roleCode !== "string" || !roles.has(grant.roleCode) ||
        typeof grant.module !== "string" || !grant.module.trim() || grant.module !== grant.module.trim() ||
        typeof grant.action !== "string" || !actions.has(grant.action) ||
        typeof grant.contextOnly !== "boolean" ||
        typeof grant.ersReference !== "string" || !grant.ersReference.trim()) {
      throw new SeedConfigurationError("El catálogo PDGLD-55 exige roleCode oficial, module, action válida, contextOnly y ersReference.");
    }
    const key = JSON.stringify([grant.roleCode, grant.module, grant.action]);
    if (keys.has(key)) {
      throw new SeedConfigurationError("El catálogo PDGLD-55 repite una concesión de rol, módulo y acción.");
    }
    keys.add(key);
    return { roleCode: grant.roleCode, module: grant.module,
      action: grant.action as PermissionGrant["action"], contextOnly: grant.contextOnly,
      ersReference: grant.ersReference };
  });
}

export async function loadPermissionCatalog(): Promise<readonly PermissionGrant[]> {
  // La ruta variable permite preparar el motor sin crear una matriz sustituta.
  const path = new URL("./permissions-data.ts", import.meta.url);
  try {
    await access(path);
  } catch {
    throw new SeedConfigurationError("Falta prisma/permissions-data.ts de PDGLD-55; el perfil no escribió datos ni inventó permisos.");
  }
  let loaded: Record<string, unknown>;
  try {
    loaded = await import(path.href) as Record<string, unknown>;
  } catch {
    throw new SeedConfigurationError("No se pudo cargar el catálogo PDGLD-55; revisa su exportación sin sustituir la matriz aprobada.");
  }
  return validatePermissionCatalog(loaded.PERMISSIONS_DATA ?? loaded.default);
}
