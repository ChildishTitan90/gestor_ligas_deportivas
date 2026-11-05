import {z} from "zod";
export const participationStatusSchema=z.enum(["PENDING_ELIGIBILITY","AUTHORIZED","WITHDRAWN"]);

export const playerPathwaySchema=z.strictObject({
  pathwayCode:z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/),expectedSeasonVersion:z.number().int().positive(),
  reason:z.string().trim().min(10).max(800),
  categories:z.array(z.strictObject({seasonCategoryId:z.uuid(),level:z.number().int().min(1).max(20)})).min(2).max(20),
}).superRefine((data,context)=>{
  const levels=data.categories.map(c=>c.level).sort((a,b)=>a-b);
  if(new Set(data.categories.map(c=>c.seasonCategoryId)).size!==levels.length || levels.some((level,i)=>level!==i+1))
    context.addIssue({code:"custom",path:["categories"],message:"Configura categorías distintas con niveles consecutivos desde 1."});
});
export const playerCategoryParticipationSchema=z.strictObject({operationKey:z.uuid(),targetSeasonTeamId:z.uuid(),reason:z.string().trim().min(10).max(800)});
export const participationReviewSchema=z.strictObject({operationKey:z.uuid(),expectedVersion:z.number().int().positive(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),decision:z.enum(["AUTHORIZE","WITHDRAW"]),reason:z.string().trim().min(10).max(800)});
export const originApprovalSchema=z.strictObject({operationKey:z.uuid(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().min(10).max(800)});
export type EligibilityBlocker={code:string;message:string;categoryId?:string};
export type EligibilityAssessment={ready:boolean;fingerprint:string;blockers:EligibilityBlocker[]};
