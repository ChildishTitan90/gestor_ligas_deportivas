"use client";

import { useId, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { getThemePreference, setThemePreference, subscribeToThemePreference } from "./theme-preference.client";
import { parseThemePreference, type ThemePreference } from "@/lib/theme";

const serverPreference = (): ThemePreference => "system";
const labels = { light: "Claro", dark: "Oscuro", system: "Sistema" };

export function ThemeSelector() {
  const id = useId();
  const preference = useSyncExternalStore(subscribeToThemePreference, getThemePreference, serverPreference);
  const Icon = preference === "dark" ? Moon : preference === "light" ? Sun : Monitor;
  return <div className="relative shrink-0" title={`Tema: ${labels[preference]}`}>
    <label htmlFor={id} className="sr-only">Tema de color</label>
    <Icon size={18} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-primary" />
    <select id={id} value={preference} onChange={event => setThemePreference(parseThemePreference(event.target.value))}
      className="min-h-11 w-11 cursor-pointer appearance-none rounded-xl border border-border bg-surface pl-10 text-[0px] text-primary hover:bg-soft sm:w-32 sm:pr-3 sm:text-sm">
      <option value="light" className="text-base">Claro</option>
      <option value="dark" className="text-base">Oscuro</option>
      <option value="system" className="text-base">Sistema</option>
    </select>
  </div>;
}
