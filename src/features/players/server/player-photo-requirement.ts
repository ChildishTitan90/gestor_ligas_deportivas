import "server-only";
import {createHash} from "node:crypto";
import type {Prisma} from "@prisma/client";

/** Posición opcional de foto del expediente; no crea requisitos ni altera configuración de categoría. */
export function playerPhotoRequirementId(seasonCategoryId:string){
  const h=createHash("sha256").update(`player-photo:v1:${seasonCategoryId}`).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export async function optionalPlayerPhotoRequirement(tx:Prisma.TransactionClient,seasonCategoryId:string){
  const type=await tx.document_types.findUnique({where:{code:"PHOTO"},select:{id:true,name:true,code:true}});
  if(!type)return null;
  return {id:playerPhotoRequirementId(seasonCategoryId),season_category_id:seasonCategoryId,document_type_id:type.id,quantity:1,is_required:false,document_types:{name:"Foto del jugador",code:type.code}};
}
/** Constancia pedida para completar el expediente, independiente de habilitación por RENAPO. */
export function playerCurpRequirementId(seasonCategoryId:string){
  const h=createHash("sha256").update(`player-curp-document:v1:${seasonCategoryId}`).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export async function requiredPlayerCurpRequirement(tx:Prisma.TransactionClient,seasonCategoryId:string){
  const type=await tx.document_types.findUnique({where:{code:"CURP"},select:{id:true,name:true,code:true}});
  if(!type)return null;
  return {id:playerCurpRequirementId(seasonCategoryId),season_category_id:seasonCategoryId,document_type_id:type.id,quantity:1,is_required:true,document_types:{name:type.name,code:type.code}};
}
