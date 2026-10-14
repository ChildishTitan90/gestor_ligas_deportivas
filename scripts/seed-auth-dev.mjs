import { fileURLToPath } from 'node:url';
import nextEnv from '@next/env';
import { getPrisma } from '../src/server/db/prisma.ts';
import { hashPassword } from '../src/server/auth/password.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });

function validateDevelopmentTarget() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('El seed de desarrollo no se ejecuta en producción.');
  }
  let target;
  try { target = new URL(process.env.DATABASE_URL ?? ''); } catch {
    throw new Error('Configura DATABASE_URL para el PostgreSQL local.');
  }
  if (!['postgres:', 'postgresql:'].includes(target.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
      !['5432', '5433'].includes(target.port || '5432') ||
      target.pathname !== '/gestor_ligas_dev' || target.hash) {
    throw new Error('El seed solo admite gestor_ligas_dev en PostgreSQL loopback, puerto 5432/5433.');
  }
  for (const key of target.searchParams.keys()) {
    if (key !== 'schema') throw new Error('DATABASE_URL contiene parámetros no permitidos para el seed local.');
  }
}

// Datos públicos y sintéticos, sin roles administrativos ni datos personales.
const accounts = [
  { email: 'operativa@example.test', username: 'pdgld48_dev_operational', mustChangePassword: false },
  { email: 'temporal@example.test', username: 'pdgld48_dev_temporary', mustChangePassword: true },
];

let prisma;
try {
  validateDevelopmentTarget();
  prisma = getPrisma();
  const passwordHash = await hashPassword('Local-Demo-48!real-test');
  const result = await prisma.$transaction(async (tx) => {
    let created = 0;
    let existing = 0;
    for (const account of accounts) {
      const user = await tx.users.findFirst({
        where: { email: { in: [account.email], mode: 'insensitive' } },
        select: { id: true },
      });
      if (user) {
        existing++;
        continue; // Conservar contraseña, estado y cambios del desarrollador.
      }
      const usernameTaken = await tx.users.findFirst({
        where: { username: { in: [account.username], mode: 'insensitive' } },
        select: { id: true },
      });
      if (usernameTaken) throw new Error('Un nombre de usuario del seed ya está ocupado. No se modificaron las cuentas existentes.');
      await tx.users.create({
        data: {
          email: account.email,
          username: account.username,
          password_hash: passwordHash,
          must_change_password: account.mustChangePassword,
          people: { create: { first_name: 'Cuenta de prueba', paternal_surname: 'Local' } },
        },
        select: { id: true },
      });
      created++;
    }
    return { created, existing };
  }, { isolationLevel: 'Serializable' });
  console.log(`Cuentas de desarrollo: ${result.created} creadas, ${result.existing} ya existentes.`);
  console.log('Usa npm run dev y http://localhost:3000/login. Credenciales sintéticas en docs/authentication.md.');
} catch (error) {
  const safeMessages = new Set([
    'El seed de desarrollo no se ejecuta en producción.',
    'Configura DATABASE_URL para el PostgreSQL local.',
    'El seed solo admite gestor_ligas_dev en PostgreSQL loopback, puerto 5432/5433.',
    'DATABASE_URL contiene parámetros no permitidos para el seed local.',
    'Un nombre de usuario del seed ya está ocupado. No se modificaron las cuentas existentes.',
  ]);
  console.error(safeMessages.has(error.message) ? error.message :
    'No se pudieron cargar las cuentas locales. Verifica Docker y las migraciones; las cuentas existentes no se sobrescriben.');
  process.exitCode = 1;
} finally {
  if (prisma) await prisma.$disconnect();
}
