export class SeedConfigurationError extends Error {}

export function parsePostgresUrl(value: string | undefined, variable: string): URL {
  if (!value?.trim()) throw new SeedConfigurationError(`${variable} es obligatoria.`);
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new SeedConfigurationError(`${variable} debe ser una URL PostgreSQL válida.`);
  }
  if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
      !target.username || !target.password || target.pathname.length <= 1 || target.hash) {
    throw new SeedConfigurationError(`${variable} debe identificar una base PostgreSQL con credenciales.`);
  }
  return target;
}

export function readSeedDatabaseUrl(environment = process.env): string {
  const target = parsePostgresUrl(environment.DATABASE_URL, "DATABASE_URL");
  const validateLocal = (url: URL, variable: string) => {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
      throw new SeedConfigurationError(`${variable}: el seed sintético solo admite PostgreSQL local.`);
    }
    for (const [key, value] of url.searchParams) {
      // pg admite parámetros capaces de sustituir host, usuario y base.
      // El entorno del equipo también declara ambos esquemas separados por coma.
      const schemas = value.split(',');
      if (key !== 'schema' || !schemas.every(schema => ['public', 'sports_management'].includes(schema))) {
        throw new SeedConfigurationError(`${variable}: parámetros de conexión no admitidos por el seed.`);
      }
    }
  };
  validateLocal(target, "DATABASE_URL");
  if (environment.DIRECT_URL) {
    const direct = parsePostgresUrl(environment.DIRECT_URL, "DIRECT_URL");
    validateLocal(direct, "DIRECT_URL");
    const normalizeHost = (host: string) => host === 'localhost' ? '127.0.0.1' : host;
    if (normalizeHost(direct.hostname) !== normalizeHost(target.hostname) ||
        (direct.port || '5432') !== (target.port || '5432') || direct.pathname !== target.pathname) {
      throw new SeedConfigurationError("DATABASE_URL y DIRECT_URL deben apuntar a la misma base local.");
    }
  }
  return target.href;
}
