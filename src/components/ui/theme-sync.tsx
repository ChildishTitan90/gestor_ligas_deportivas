"use client";

import { useEffect } from "react";
import { synchronizeThemePreference } from "./theme-preference.client";

export function ThemeSync() {
  useEffect(synchronizeThemePreference, []);
  return null;
}
