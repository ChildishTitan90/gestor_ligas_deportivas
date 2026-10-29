export type ThemePreference = "light" | "dark" | "system";
export const themeStorageKey = "liga-theme";

export function parseThemePreference(value: unknown): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(preference: ThemePreference, systemIsDark: boolean): "light" | "dark" {
  return preference === "system" ? systemIsDark ? "dark" : "light" : preference;
}

// Constante local: nunca interpolar contenido de cuentas o peticiones en este script.
// Se ejecuta al analizar <head>, antes de pintar o hidratar la página.
export const themeInitializationScript = `(()=>{let p="system";try{const s=localStorage.getItem(${JSON.stringify(themeStorageKey)});if(s==="light"||s==="dark")p=s}catch{}let d=false;try{d=window.matchMedia("(prefers-color-scheme: dark)").matches}catch{}const r=document.documentElement;r.dataset.themePreference=p;r.dataset.theme=p==="system"?(d?"dark":"light"):p})()`;
