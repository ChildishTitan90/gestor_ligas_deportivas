import assert from 'node:assert/strict';
import { cp, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

export const accountAppFiles = ['src', 'public', 'prisma', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'next-env.d.ts'];
export function accountCopyAllowed(name) {
  return name !== '.env' && !name.startsWith('.env.') && !['.git', '.next', '.next-auth-tests', 'compose.yml', 'prisma.config.ts'].includes(name);
}

/** Source copy, never a mount; Next may only load env files from this empty root. */
export async function createAccountAppCopy(root, directory, { dependencies = 'linked' } = {}) {
  assert.ok(['linked', 'independent'].includes(dependencies));
  await mkdir(directory, { mode: 0o700 });
  try {
    for (const name of accountAppFiles) {
      try { await lstat(join(root, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      await cp(join(root, name), join(directory, name), { recursive: true, filter: async source => {
        if (!accountCopyAllowed(basename(source))) return false;
        if ((await lstat(source)).isSymbolicLink()) throw new Error('La copia de aplicación no admite symlinks de origen.');
        return true;
      } });
    }
    // Reuse installed dependencies, not application sources or environment files.
    if (dependencies === 'linked') await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    return directory;
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}

/** Next 16.4 additional roots: only installed dependencies, never the repo root. */
export async function configureAccountTurbopack(directory, sourceRoot, { dependencies = 'linked' } = {}) {
  assert.ok(['linked', 'independent'].includes(dependencies));
  const file = join(directory, 'next.config.ts');
  const config = await readFile(file, 'utf8');
  const marker = 'export default nextConfig;';
  if (config.split(marker).length !== 2) throw new Error('Revisar configuración Next antes de preparar navegador.');
  const additions = `nextConfig.turbopack = { ...nextConfig.turbopack, root: ${JSON.stringify(directory)} };\n` +
    (dependencies === 'independent' ? '' : `nextConfig.experimental = { ...nextConfig.experimental, turbopackAdditionalRoots: { installedDependencies: { path: ${JSON.stringify(join(sourceRoot, 'node_modules'))} } } };\n`);
  await writeFile(file, config.replace(marker, additions + marker));
}
