import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { readDevelopmentSeedDatabaseUrl, SeedConfigurationError } from '../prisma/seed-env.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });

try {
  readDevelopmentSeedDatabaseUrl();
  // Un solo perfil implementa seed:dev y la CLI; no mantiene cuentas ni matriz
  // de permisos independientes. Conserva la guarda histórica de la base de dev.
  const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), 'prisma/seed.ts', '--profile', 'demo'], {
    cwd: root, env: process.env, stdio: 'inherit', windowsHide: true,
  });
  if (result.error || result.status !== 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof SeedConfigurationError ? error.message :
    'No se pudo ejecutar el perfil local; verifica la configuración y docs/seed.md.');
  process.exitCode = 1;
}
