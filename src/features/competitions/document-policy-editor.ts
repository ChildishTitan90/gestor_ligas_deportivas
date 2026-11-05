import {categoryDocumentPolicySchema,type CategoryDocumentPolicy} from "./document-policy";
export const documentGroupLabels={CURP:"Constancia CURP",PLAYER_PHOTO:"Foto para la credencial del jugador",PHOTO_IDENTIFICATION:"Identificación oficial con fotografía",BIRTH_EVIDENCE:"Evidencia de nacimiento",SCHOOL_EVIDENCE:"Documento escolar del menor",GUARDIAN_CONSENT:"Autorización del tutor"};
export const documentTypeLabels={CURP:"Constancia CURP",PHOTO:"Foto del jugador",INE:"INE",DRIVER_LICENSE:"Licencia de conducir",PASSPORT:"Pasaporte",BIRTH_CERTIFICATE:"Acta de nacimiento",STUDENT_ID:"Credencial escolar",STUDENT_CERTIFICATE:"Constancia de estudios",GUARDIAN_CONSENT:"Autorización del tutor"};
export const documentDecisionLabels={BIRTH_EVIDENCE_TYPES:"Falta confirmar los comprobantes de nacimiento aceptados",ADULT_SIGNATURE_SCOPE:"Falta confirmar si se requiere firma de adultos",CATEGORY_DOCUMENT_PROFILE:"Falta clasificar documentalmente esta categoría"};
export type DocumentRule=CategoryDocumentPolicy["requirements"][number];
export function newDocumentRule(key:DocumentRule["key"]):DocumentRule{
  const anyOf:DocumentRule["anyOf"]=key==="CURP"?["CURP"]:key==="PLAYER_PHOTO"?["PHOTO"]:key==="SCHOOL_EVIDENCE"?["STUDENT_ID","STUDENT_CERTIFICATE"]:key==="GUARDIAN_CONSENT"?["GUARDIAN_CONSENT"]:[];
  return {key,audience:["SCHOOL_EVIDENCE","GUARDIAN_CONSENT"].includes(key)?"MINORS":"ALL",anyOf,quantity:1,requiredForDossier:!["PLAYER_PHOTO","PHOTO_IDENTIFICATION"].includes(key),requiredForEligibility:!["PLAYER_PHOTO","PHOTO_IDENTIFICATION"].includes(key)};
}
/** Propuesta conservadora para revisión humana; nunca aprueba el listado anterior. */
export function initialDocumentPolicy(value:unknown,type:string):CategoryDocumentPolicy{
  const parsed=categoryDocumentPolicySchema.safeParse(value);
  if(parsed.success)return structuredClone(parsed.data);
  const policy:CategoryDocumentPolicy={version:1,profile:type==="OPEN"?"GENERAL":type==="VETERANS"?"VETERANS":"PENDING",status:"DRAFT",pendingDecisions:["ADULT_SIGNATURE_SCOPE"],activation:"ADMINISTRATIVE",requirements:[{...newDocumentRule("CURP"),audience:"ADULTS"},{...newDocumentRule("CURP"),audience:"MINORS"},newDocumentRule("PLAYER_PHOTO"),newDocumentRule("SCHOOL_EVIDENCE"),newDocumentRule("GUARDIAN_CONSENT")]};
  if(type==="VETERANS"){policy.pendingDecisions.push("BIRTH_EVIDENCE_TYPES");policy.requirements.push(newDocumentRule("BIRTH_EVIDENCE"));}
  if(type==="YOUTH")policy.pendingDecisions.push("CATEGORY_DOCUMENT_PROFILE");
  if(Array.isArray(value) && value.includes("INE"))policy.requirements.push({...newDocumentRule("PHOTO_IDENTIFICATION"),audience:"ADULTS",anyOf:["INE"],requiredForDossier:true,requiredForEligibility:true});
  return policy;
}
