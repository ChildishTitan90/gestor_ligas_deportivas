import {z} from "zod";
export const playerDossierSchema=z.object({
  identityVerification:z.object({curpVerified:z.boolean(),ineAttemptId:z.uuid().nullable()}).optional(),
  player:z.object({displayName:z.string(),teamName:z.string(),clubName:z.string(),categoryName:z.string().optional(),seasonName:z.string()}).optional(),
  registrationId:z.uuid(),configuration:z.enum(["CONFIGURED","MISSING"]),configurationIssues:z.array(z.string()),approvalAllowed:z.boolean(),
  originDossierComplete:z.boolean().optional(),
  registrationStatus:z.string().optional(),
  dossierComplete:z.boolean().optional(),
  eligibilityDocumentsComplete:z.boolean().optional(),
  documentPolicyFingerprint:z.string().nullable().optional(),documentPolicyApproved:z.boolean().optional(),
  activationMode:z.enum(["ADMINISTRATIVE","VERIFIED_ADULT_CURP"]).optional(),
  documentGroups:z.array(z.object({categoryName:z.string().optional(),categoryId:z.uuid().optional(),scope:z.enum(["ORIGIN","SUPERIOR"]).optional(),key:z.string(),typeIds:z.array(z.uuid()),quantity:z.number().int().positive(),requiredForDossier:z.boolean(),requiredForEligibility:z.boolean(),recorded:z.number().int().min(0),approved:z.number().int().min(0),ready:z.boolean()})).optional(),
  minorDocumentFlow:z.boolean().nullable().optional(),
  school:z.object({required:z.boolean(),received:z.boolean(),approved:z.boolean()}).optional(),
  referenceDate:z.string(),minorAtRegistration:z.boolean().nullable(),canUpload:z.boolean(),guardianConsent:z.string(),
  requirements:z.array(z.object({id:z.uuid(),typeId:z.uuid(),quantity:z.number().int().positive(),required:z.boolean(),recorded:z.number().int().min(0),approved:z.number().int().min(0),missing:z.number().int().min(0)})),
  documentTypes:z.array(z.object({id:z.uuid(),name:z.string(),code:z.string()})),
  documents:z.array(z.object({id:z.uuid(),typeId:z.uuid(),reviewStatus:z.string(),superseded:z.boolean(),requirementId:z.uuid().optional(),slot:z.number().int().positive().optional(),storageConfirmation:z.string()})),
});
export type PlayerDossier=z.infer<typeof playerDossierSchema>;
