import { mkdir, writeFile } from 'node:fs/promises';

// Never serialize error.message, raw stack, logs, assertion objects or HTTP bodies.
const sources = /(?:scripts\/verification\/account-isolated-worker|tests\/e2e\/(?:account-delegates-browser|chrome-session)|tests\/integration\/(?:account-delegates-http|account-preview-runtime)|scripts\/verification\/account-(?:app-copy|independent-dependencies))\.mjs:\d+:\d+/;
const label = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,60}$/.test(value) ? value : 'unknown';
const scalar = value => typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
export function accountDiagnostic(error, context = {}) {
  const result = { case: label(context.case), stage: label(context.stage),
    code: error?.code === 'ERR_ASSERTION' ? 'ERR_ASSERTION' : 'ACCOUNT_SUITE_FAILED',
    location: error?.stack?.match(sources)?.[0] ?? null };
  // Generic strings/numbers can contain passwords, identifiers or tokens. Values
  // are opt-in by assertion site, with primitive-only types and no string output.
  if (context.safeValues === true && scalar(error?.expected) && scalar(error?.actual)) {
    result.expected = error.expected; result.actual = error.actual;
  }
  return result;
}

export function nextStartupObserver({ allowedModules = [] } = {}) {
  const allowed = new Set(allowedModules);
  let tail = '';
  const signals = new Set();
  const unresolved = new Set();
  let status = null; let exitCode = null;
  return {
    output(chunk) {
      tail = (tail + chunk.toString()).slice(-8192);
      // Keep only an exact module identifier already present in reviewed source
      // imports/package metadata. Never persist a raw diagnostic line or body.
      const plain = tail.replace(/\x1b\[[0-9;]*m/g, '').replace(/\\"/g, '"');
      for (const match of plain.matchAll(/(?:Can't resolve|Cannot find module|Cannot resolve module)\s+['"]([^'"\r\n]+)['"]/g)) {
        if (allowed.has(match[1])) unresolved.add(match[1]);
      }
      for (const [pattern, code] of [
        [/SecurityFatalError|upgrade recommendation/, 'upgrade-reminder'],
        [/outside of the filesystem root|outside.*root|not within.*root/i, 'filesystem-root'],
        [/Module not found|Cannot find module/i, 'module-resolution'],
        [/can't be external|cannot be external|could not be resolved from the project directory/i, 'external-package-resolution'],
        [/EADDRINUSE/, 'port-occupied'], [/Failed to fetch.*font|next\/font.*error/is, 'font-fetch'],
        [/Turbopack.*(?:error|panic)|FATAL.*Turbopack/is, 'turbopack-error'],
      ]) if (pattern.test(tail)) signals.add(code);
    },
    status(value) { if (Number.isInteger(value) && value >= 100 && value <= 599) status = value; },
    exit(value) { if (Number.isInteger(value)) exitCode = value; },
    summary() { return { signals: [...signals].sort(), httpStatus: status, exitCode,
      ...(allowedModules.length ? { unresolvedModules: [...unresolved].sort() } : {}) }; },
  };
}

export async function writeAccountDiagnostic(directory, diagnostic) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(`${directory}/failure.json`, JSON.stringify(diagnostic, null, 2), { mode: 0o600 });
}

// A failure screenshot is optional. Hide every text glyph and replaced content,
// rather than attempting to recognize secrets in a live authenticated page.
export async function captureMaskedFailure(command, directory) {
  try {
    const result = await command('Runtime.evaluate', { expression: `(() => {
      const style = document.createElement('style');
      style.textContent = '* , *::before, *::after { color: transparent !important; text-shadow: none !important; background-image: none !important; caret-color: transparent !important; } input, textarea, select, img, video, canvas, iframe, svg, [contenteditable] { visibility: hidden !important; }';
      document.head.append(style);
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      for (const node of nodes) node.textContent = '';
      return true;
    })()`, returnByValue: true });
    if (result.exceptionDetails || result.result?.value !== true) return false;
    const image = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(`${directory}/failure-masked.png`, Buffer.from(image.data, 'base64'), { mode: 0o600 });
    return true;
  } catch { return false; }
}
