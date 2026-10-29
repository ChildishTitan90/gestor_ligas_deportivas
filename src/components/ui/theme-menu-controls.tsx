"use client";

import { useSyncExternalStore } from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { getResolvedTheme, getThemePreference, setThemePreference, subscribeToThemePreference } from "./theme-preference.client";
import type { ThemePreference } from "@/lib/theme";

const serverPreference = (): ThemePreference => "system";
const serverTheme = () => "light" as const;

export function ThemeMenuControls() {
  const preference = useSyncExternalStore(subscribeToThemePreference, getThemePreference, serverPreference);
  const dark = useSyncExternalStore(subscribeToThemePreference, getResolvedTheme, serverTheme) === "dark";
  return <>
    <button type="button" role="menuitemcheckbox" tabIndex={-1} aria-checked={dark}
      onClick={() => setThemePreference(dark ? "light" : "dark")}
      className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium text-primary hover:bg-soft focus:bg-soft">
      <span>Modo oscuro</span>
      <span aria-hidden="true" className="theme-switch-track" data-checked={dark}>
        <Moon size={16} className="theme-switch-moon" />
        <Sun size={16} className="theme-switch-sun" />
        <span className="theme-switch-thumb" />
      </span>
    </button>
    <button type="button" role="menuitemcheckbox" tabIndex={-1} aria-checked={preference === "system"}
      onClick={() => setThemePreference(preference === "system" ? dark ? "dark" : "light" : "system")}
      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-xs text-muted hover:bg-soft focus:bg-soft">
      <Monitor size={17} aria-hidden="true" className="shrink-0" />
      <span className="flex-1">Usar tema del sistema</span>
      {preference === "system" && <Check size={16} aria-hidden="true" />}
    </button>
  </>;
}
