"use client";

import { parseThemePreference, resolveTheme, themeStorageKey, type ThemePreference } from "@/lib/theme";

const themeChangeEvent = "liga-theme-change";

export function getThemePreference(): ThemePreference {
  return parseThemePreference(document.documentElement.dataset.themePreference);
}

export function getResolvedTheme(): "light" | "dark" {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function applyThemePreference(preference: ThemePreference) {
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = resolveTheme(preference, window.matchMedia("(prefers-color-scheme: dark)").matches);
  window.dispatchEvent(new Event(themeChangeEvent));
}

export function setThemePreference(preference: ThemePreference) {
  try { window.localStorage.setItem(themeStorageKey, preference); } catch { /* La elección sigue funcionando en esta página. */ }
  applyThemePreference(preference);
}

export function subscribeToThemePreference(onChange: () => void) {
  window.addEventListener(themeChangeEvent, onChange);
  return () => window.removeEventListener(themeChangeEvent, onChange);
}

/** Una sola sincronización global; no depende de sesión ni de rutas privadas. */
export function synchronizeThemePreference() {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  function onSystemChange() {
    if (getThemePreference() === "system") applyThemePreference("system");
  }
  function onStorageChange(event: StorageEvent) {
    if (event.key === themeStorageKey || event.key === null) applyThemePreference(parseThemePreference(event.newValue));
  }
  // El script inicial ya aplicó la preferencia antes del primer pintado.
  media.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorageChange);
  return () => {
    media.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorageChange);
  };
}
