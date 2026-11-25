import type { ChargeFilters } from "./types";
export const chargesPath = "/treasury/charges";
export type BillingQuery = Record<string, string | string[] | undefined>;
export function chargesUrl(path: string, filters: ChargeFilters) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) if (value) params.set(name, value);
  return params.size ? `${path}?${params}` : path;
}
