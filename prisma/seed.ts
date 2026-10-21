import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { readSeedDatabaseUrl, readSeedProfile, SeedConfigurationError } from "./seed-env";
import { seedDatabase } from "./seed-runner";
import { loadPermissionCatalog } from "./permissions-catalog";
import { seedPermissionDatabase } from "./seed-permissions";
import { seedDemoDatabase } from "./seed-demo";

config({ quiet: true });

async function main() {
  const connectionString = readSeedDatabaseUrl();
  const profile = readSeedProfile(process.argv.slice(2));
  // Validar PDGLD-55 antes de abrir conexión o escribir el perfil solicitado.
  const catalog = profile === "base" ? undefined : await loadPermissionCatalog();
  // El adaptador administra el pool y lo cierra con $disconnect().
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString, connectionTimeoutMillis: 5_000 }),
  });
  try {
    if (profile === "base") {
      await seedDatabase(prisma);
      console.log("Seed base PDGLD-47 completado. Verificación reproducible: npm run test:seed.");
    } else if (profile === "permissions") {
      const result = await seedPermissionDatabase(prisma, catalog);
      console.log(result.installed ? "Matriz RF22 instalada por primera vez." : "La matriz RF22 ya estaba instalada; no se restauraron concesiones.");
    } else {
      const result = await seedDemoDatabase(prisma, catalog);
      console.log(result.alreadyInstalled ? "Perfil DEMO ya instalado; se conservaron datos y revocaciones." : `Perfil DEMO instalado: ${result.createdAccounts} cuentas sintéticas creadas.`);
      console.log("Credenciales exclusivamente locales y casos de acceso: docs/seed.md.");
    }
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
