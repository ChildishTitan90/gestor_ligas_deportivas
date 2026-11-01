import {z} from "zod";
export const playerDossierSchema=z.object({
  registrationId:z.uuid(),configuration:z.enum(["CONFIGURED","MISSING"]),configurationIssues:z.array(z.string()),approvalAllowed:z.literal(false),
  referenceDate:z.string(),minorAtRegistration:z.boolean().nullable(),canUpload:z.boolean(),guardianConsent:z.string(),
  requirements:z.array(z.object({id:z.uuid(),typeId:z.uuid(),quantity:z.number().int().positive(),required:z.boolean(),recorded:z.number().int().min(0),approved:z.number().int().min(0),missing:z.number().int().min(0)})),
  documentTypes:z.array(z.object({id:z.uuid(),name:z.string(),code:z.string()})),
  documents:z.array(z.object({id:z.uuid(),typeId:z.uuid(),reviewStatus:z.string(),superseded:z.boolean(),requirementId:z.uuid().optional(),slot:z.number().int().positive().optional(),storageConfirmation:z.string()})),
});
export type PlayerDossier=z.infer<typeof playerDossierSchema>;
