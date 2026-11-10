import { z } from "zod";

export const dashboardContextSchema = z.strictObject({
  kind: z.enum(["league", "club"]), id: z.uuid().transform(value => value.toLowerCase()),
});
export type DashboardContext = z.infer<typeof dashboardContextSchema>;

export function parseDashboardContext(value: unknown): DashboardContext | null {
  if (typeof value !== "string") return null;
  const [kind, id, extra] = value.split(":");
  if (extra !== undefined) return null;
  return dashboardContextSchema.safeParse({ kind, id }).data ?? null;
}

export type DashboardSummary = {
  context: DashboardContext;
  name: string;
  awaitingReview: number;
  correctionsRequested: number;
  approved: number;
  enrollments: number | null;
};
