import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as theme from "./theme";

function browserTheme(saved: unknown = null, dark = false, blocked = false) {
  const root = { dataset: {} as Record<string, string> };
  const events = new EventTarget();
  const media = Object.assign(new EventTarget(), { matches: dark });
  let stored = saved;
  const localStorage = {
    getItem() { if (blocked) throw new Error("STORAGE_BLOCKED"); return stored; },
    setItem(key: string, value: string) { assert.equal(key, theme.themeStorageKey); if (blocked) throw new Error("STORAGE_BLOCKED"); stored = value; },
  };
  const context = vm.createContext({ document: { documentElement: root }, localStorage, Event,
    window: { localStorage, matchMedia: () => media,
      addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events) },
  });
  vm.runInContext(theme.themeInitializationScript, context);
  const source = readFileSync(new URL("../components/ui/theme-preference.client.ts", import.meta.url), "utf8");
  const sandboxModule = { exports: {} as typeof import("../components/ui/theme-preference.client") };
  Object.assign(context, { module: sandboxModule, exports: sandboxModule.exports,
    require(name: string) { assert.equal(name, "@/lib/theme"); return theme; } });
  vm.runInContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, context);
  return { root, media, events, actions: sandboxModule.exports, stored: () => stored };
}

test("la carga inicial aplica la elección guardada antes de la hidratación", () => {
  for (const preference of ["light", "dark", "system", null, "invalid"]) {
    for (const dark of [false, true]) {
      const browser = browserTheme(preference, dark);
      const expected = theme.parseThemePreference(preference);
      assert.equal(browser.root.dataset.themePreference, expected);
      assert.equal(browser.root.dataset.theme, theme.resolveTheme(expected, dark));
    }
  }
});

test("el selector persiste, comunica el cambio y conserva la elección al recargar", () => {
  const browser = browserTheme();
  let changes = 0;
  const unsubscribe = browser.actions.subscribeToThemePreference(() => changes++);
  browser.actions.setThemePreference("dark");
  assert.equal(browser.root.dataset.theme, "dark");
  assert.equal(browser.stored(), "dark");
  assert.equal(changes, 1);
  assert.equal(browserTheme(browser.stored()).root.dataset.theme, "dark");
  unsubscribe();
  browser.actions.setThemePreference("light");
  assert.equal(changes, 1);
});

test("Sistema sigue al dispositivo; una elección explícita se mantiene", () => {
  const browser = browserTheme();
  const stop = browser.actions.synchronizeThemePreference();
  browser.media.matches = true;
  browser.media.dispatchEvent(new Event("change"));
  assert.equal(browser.root.dataset.theme, "dark");
  browser.actions.setThemePreference("light");
  browser.media.dispatchEvent(new Event("change"));
  assert.equal(browser.root.dataset.theme, "light");
  browser.actions.setThemePreference("system");
  assert.equal(browser.root.dataset.theme, "dark");
  stop();
  browser.media.matches = false;
  browser.media.dispatchEvent(new Event("change"));
  assert.equal(browser.root.dataset.theme, "dark");
});

test("el interruptor recibe cambios del dispositivo aunque la preferencia siga en Sistema", () => {
  const browser = browserTheme("system", false);
  const stop = browser.actions.synchronizeThemePreference();
  const observed: string[] = [];
  const unsubscribe = browser.actions.subscribeToThemePreference(() => observed.push(browser.actions.getResolvedTheme()));
  browser.media.matches = true;
  browser.media.dispatchEvent(new Event("change"));
  assert.equal(browser.actions.getThemePreference(), "system");
  browser.actions.setThemePreference("light");
  assert.deepEqual(observed, ["dark", "light"]);
  unsubscribe();
  stop();
});

test("otra pestaña actualiza el tema sin volver a escribir almacenamiento", () => {
  const browser = browserTheme("dark", false);
  const stop = browser.actions.synchronizeThemePreference();
  const send = (key: string | null, newValue: string | null) => browser.events.dispatchEvent(
    Object.assign(new Event("storage"), { key, newValue }));
  send("unrelated", "light");
  assert.equal(browser.root.dataset.theme, "dark");
  send(theme.themeStorageKey, "light");
  assert.equal(browser.actions.getThemePreference(), "light");
  assert.equal(browser.root.dataset.theme, "light");
  assert.equal(browser.stored(), "dark");
  send(null, null);
  assert.equal(browser.actions.getThemePreference(), "system");
  stop();
  send(theme.themeStorageKey, "dark");
  assert.equal(browser.root.dataset.theme, "light");
});

test("el almacenamiento bloqueado conserva Sistema y permite cambiar en la página", () => {
  const browser = browserTheme("light", true, true);
  assert.equal(browser.root.dataset.theme, "dark");
  browser.actions.setThemePreference("light");
  assert.equal(browser.root.dataset.theme, "light");
  assert.equal(browser.actions.getThemePreference(), "light");
});

function contrast(a: string, b: string) {
  const luminance = (color: string) => {
    const [r, g, b] = color.match(/[a-f\d]{2}/gi)!.map(value => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return r * 0.2126 + g * 0.7152 + b * 0.0722;
  };
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("textos, botones, errores y estados positivos mantienen contraste en ambas paletas", () => {
  const css = readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
  for (const block of css.matchAll(/:root[^\{]*\{([^}]+)\}/g)) {
    const tokens = Object.fromEntries([...block[1].matchAll(/--([\w-]+):\s*(#[\da-f]{6})/gi)].map(match => [match[1], match[2]]));
    for (const [foreground, background] of [["foreground", "background"], ["foreground", "surface"],
      ["primary", "soft"], ["muted", "surface"], ["muted", "background"], ["on-action", "action"],
      ["on-action", "action-hover"], ["sidebar-foreground", "sidebar"], ["danger", "danger-surface"],
      ["sidebar-foreground", "sidebar-active"], ["positive", "positive-surface"]]) {
      assert.ok(contrast(tokens[foreground], tokens[background]) >= 4.5, `${foreground} sobre ${background}`);
    }
    assert.ok(contrast(tokens.action, tokens.surface) >= 3, "La acción principal debe distinguirse de su tarjeta.");
    assert.ok(contrast(tokens.sidebar, tokens.background) >= 1.3, "La sidebar debe distinguirse del fondo general.");
  }
});
