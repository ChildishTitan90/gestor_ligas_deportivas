import "server-only";

import { X509Certificate } from "node:crypto";
import type { PoolConfig } from "pg";

/** Opciones exclusivas del servidor; no incluir conexiones o certificados en DTOs. */
export function getDatabaseConnectionOptions(environment: Record<string, string | undefined> = process.env): PoolConfig {
  const connectionString = environment.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL no configurada.");

  // Mantener el comportamiento de Docker y despliegues sin CA personalizada.
  if (environment.DATABASE_CA_CERT === undefined) {
    return { connectionString, connectionTimeoutMillis: 5000 };
  }

  const certificate = environment.DATABASE_CA_CERT.replace(/\\n/g, "\n").trim();
  try {
    if (!new X509Certificate(certificate).ca) throw new Error();
  } catch {
    throw new Error("DATABASE_CA_CERT debe contener un certificado CA válido en formato PEM.");
  }

  let target: URL;
  try {
    target = new URL(connectionString);
    if (!["postgres:", "postgresql:"].includes(target.protocol) || !target.hostname || target.hash) {
      throw new Error();
    }
  } catch {
    throw new Error("DATABASE_URL debe ser una URL PostgreSQL válida.");
  }

  // pg interpreta estos parámetros después de PoolConfig y puede reemplazar ssl
  // o intentar abrir rutas de archivos que solo existen en la computadora local.
  const sslParameters = new Set([
    "ssl", "sslmode", "sslcert", "sslrootcert", "sslkey", "sslpassword",
    "uselibpqcompat", "sslnegotiation",
  ]);
  for (const key of [...target.searchParams.keys()]) {
    if (sslParameters.has(key.toLowerCase())) target.searchParams.delete(key);
  }

  return {
    connectionString: target.href,
    connectionTimeoutMillis: 30_000,
    max: 2,
    ssl: { ca: certificate, rejectUnauthorized: true, servername: target.hostname },
  };
}
