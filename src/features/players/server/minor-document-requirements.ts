import "server-only";
import {createHash} from "node:crypto";
import type {Prisma} from "@prisma/client";
export const minorDocumentCodes = ["GUARDIAN_CONSENT", "STUDENT_ID", "STUDENT_CERTIFICATE"];
export function minorRequirementId(categoryId:string,code:string) {
  const h=createHash("sha256").update(`minor-document:v1:${categoryId}:${code}`).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export async function minorDocumentRequirements(tx:Prisma.TransactionClient,categoryId:string) {
  const types=await tx.document_types.findMany({where:{code:{in:minorDocumentCodes}},select:{id:true,name:true,code:true}});
  const configured=await tx.document_requirements.findMany({where:{season_category_id:categoryId},select:{document_type_id:true}});
  return types.filter(t=>!configured.some(r=>r.document_type_id===t.id)).map(t=>({id:minorRequirementId(categoryId,t.code),season_category_id:categoryId,document_type_id:t.id,quantity:1,is_required:t.code==="GUARDIAN_CONSENT",document_types:{name:t.name,code:t.code}}));
}
