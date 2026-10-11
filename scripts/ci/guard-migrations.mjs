import { spawnSync } from 'node:child_process';

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('No se pudo comparar el historial de Git. CI necesita fetch-depth: 0.');
  return result.stdout.trim();
}

try {
  let base = process.env.MIGRATION_BASE_SHA;
  if (!base || /^0+$/.test(base)) {
    const parent = spawnSync('git', ['rev-parse', '--verify', 'HEAD^'], { encoding: 'utf8' });
    if (parent.status !== 0) {
      console.log('Primer commit: no hay migraciones anteriores que comparar.');
      process.exit(0);
    }
    base = parent.stdout.trim();
  }
  if (!/^[a-f0-9]{40}$/.test(base)) throw new Error('La referencia base de CI no es válida.');
  git(['cat-file', '-e', `${base}^{commit}`]);
  const changed = git(['diff', '--name-status', '--diff-filter=MDR', '--find-renames', base, 'HEAD', '--', 'prisma/migrations/*/migration.sql']);
  if (changed) throw new Error(`Las migraciones compartidas son inmutables. Crea una nueva en vez de modificar, borrar o renombrar estas:\n${changed}`);
  console.log('Las migraciones existentes se conservaron intactas.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
