"use client";

import { useId, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { getThemePreference, setThemePreference, subscribeToThemePreference } from "./theme-preference.client";
import { parseThemePreference, type ThemePreference } from "@/lib/theme";
import { SelectField } from "./select-field";

const serverPreference = (): ThemePreference => "system";
const labels = { light: "Claro", dark: "Oscuro", system: "Sistema" };

export function ThemeSelector() {
  const id = useId();
  const preference = useSyncExternalStore(subscribeToThemePreference, getThemePreference, serverPreference);
  const Icon = preference === "dark" ? Moon : preference === "light" ? Sun : Monitor;
  return <div className="relative w-11 shrink-0 sm:w-36" title={`Tema: ${labels[preference]}`}>
    <label htmlFor={id} className="sr-only">Tema de color</label>
    <SelectField id={id} value={preference} onValueChange={value => setThemePreference(parseThemePreference(value))}
      className="theme-select" searchable={false} icon={<Icon size={18} />}
      options={Object.entries(labels).map(([value, label]) => ({ value, label }))} />
  </div>;
}
