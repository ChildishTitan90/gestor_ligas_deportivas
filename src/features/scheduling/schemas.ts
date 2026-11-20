import { z } from "zod";

export const schedulingPolicySchema = z.strictObject({
  slotStepMinutes: z.number().int().min(1).max(120),
  venueStages: z.array(z.strictObject({
    fromRound: z.number().int().positive(), toRound: z.number().int().positive(),
    venueIds: z.array(z.uuid()).min(1).max(100).refine(v=>new Set(v).size===v.length),
  }).refine(v=>v.toRound>=v.fromRound)).max(50),
}).refine(p=>!p.venueStages.some((a,i)=>p.venueStages.some((b,j)=>i<j && a.fromRound<=b.toRound && b.fromRound<=a.toRound)),
  "Los tramos de jornadas no deben superponerse.");

export const generateScheduleSchema = z.strictObject({
  seasonId:z.uuid(), categoryId:z.uuid(), groupId:z.uuid(), operationId:z.uuid(),
  expectedSeasonVersion:z.number().int().positive(), reason:z.string().trim().min(5).max(500), allowPending:z.boolean().optional(),
});
