import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readSeedDatabaseUrl, SeedConfigurationError } from "./seed-env";
import { seedDatabase } from "./seed-runner";

config({ quiet: true });

async function main() {
  const connectionString = readSeedDatabaseUrl();
  // El adaptador administra el pool y lo cierra con $disconnect().
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5_000 }),
  });
  try {
    await seedDatabase(prisma);
    console.log("Seed PDGLD-47 completado. Verificación reproducible: npm run test:seed.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Los errores originales pueden incluir URL, datos o credenciales.
  if (error instanceof SeedConfigurationError) console.error(error.message);
  else console.error("El seed falló; comprueba la conexión local, las migraciones y las restricciones SQL.");
  process.exitCode = 1;
});
