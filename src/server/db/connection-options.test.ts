import assert from "node:assert/strict";
import test from "node:test";
import { rootCertificates } from "node:tls";
import { Client } from "pg";
import { getDatabaseConnectionOptions } from "./connection-options";

const certificate = rootCertificates[0].trim();
const remote = "postgresql://runtime:synthetic-test-password@pooler.example.invalid:5432/postgres";

test("conserva la conexión local cuando no se configura una CA", () => {
  const connectionString = "postgresql://local:synthetic@localhost:5433/test?schema=public";
  assert.deepEqual(getDatabaseConnectionOptions({ DATABASE_URL: connectionString }), {
    connectionString, connectionTimeoutMillis: 5000,
  });
});

test("la CA configura TLS estricto sin permitir que la URI lo sustituya", () => {
  const options = getDatabaseConnectionOptions({
    DATABASE_URL: remote + "?sslmode=disable&ssl=no-verify&sslcert=missing-file&sslrootcert=missing-root&sslkey=missing-key&sslpassword=synthetic&uselibpqcompat=true&sslnegotiation=direct&schema=public&connect_timeout=30",
    DATABASE_CA_CERT: certificate,
  });
  const target = new URL(options.connectionString!);
  assert.deepEqual([...target.searchParams.keys()], ["schema", "connect_timeout"]);
  assert.equal(options.max, 2);
  assert.equal(options.connectionTimeoutMillis, 30_000);
  // Construir Client ejecuta el parser real de pg, sin abrir una conexión.
  const client = new Client(options) as Client & {
    connectionParameters: { ssl: { ca: string; rejectUnauthorized: boolean; servername: string } };
  };
  const ssl = client.connectionParameters.ssl;
  assert.equal(ssl.ca, certificate);
  assert.equal(ssl.rejectUnauthorized, true);
  assert.equal(ssl.servername, "pooler.example.invalid");
});

test("admite certificados pegados con saltos literales y con saltos reales", () => {
  const literal = certificate.replaceAll("\n", "\\n");
  assert.deepEqual(
    getDatabaseConnectionOptions({ DATABASE_URL: remote, DATABASE_CA_CERT: literal }),
    getDatabaseConnectionOptions({ DATABASE_URL: remote, DATABASE_CA_CERT: certificate }),
  );
});

test("una CA vacía o inválida detiene la conexión sin revelar secretos", () => {
  for (const value of ["", "synthetic-sensitive-invalid-ca", "-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----"]) {
    assert.throws(() => getDatabaseConnectionOptions({ DATABASE_URL: remote, DATABASE_CA_CERT: value }), {
      message: "DATABASE_CA_CERT debe contener un certificado CA válido en formato PEM.",
    });
  }
});

test("rechaza URL inválida o de otro protocolo con un error controlado", () => {
  for (const value of ["synthetic-sensitive-invalid-url", "https://example.invalid", remote + "#fragment"]) {
    assert.throws(() => getDatabaseConnectionOptions({ DATABASE_URL: value, DATABASE_CA_CERT: certificate }), {
      message: "DATABASE_URL debe ser una URL PostgreSQL válida.",
    });
  }
});

test("no inventa una conexión cuando falta DATABASE_URL", () => {
  assert.throws(() => getDatabaseConnectionOptions({}), { message: "DATABASE_URL no configurada." });
});
