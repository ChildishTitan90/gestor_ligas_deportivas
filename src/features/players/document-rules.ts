/** Una fila histórica no demuestra por sí sola la confirmación del objeto en Storage. */
export function minorAtDate(birthDate:string|null,referenceDate:string):boolean|null {
  if(!birthDate)return null;
  const age=Number(referenceDate.slice(0,4))-Number(birthDate.slice(0,4))-Number(referenceDate.slice(5)<birthDate.slice(5));
  return Number.isFinite(age) && age>=0?age<18:null;
}
export function summarizeDossier(requirements: readonly {id:string;typeId:string;quantity:number;required:boolean}[],
  documents:readonly {id:string;typeId:string;status:string;storageConfirmed?:boolean}[]) {
  const confirmed=documents.filter(d=>d.storageConfirmed);
  return { configuration:requirements.length ? "CONFIGURED" as const : "MISSING" as const,
    requirements:requirements.map(r=>({...r,recorded:confirmed.filter(d=>d.typeId===r.typeId && d.status!=="REJECTED").length,
      approved:confirmed.filter(d=>d.typeId===r.typeId && d.status==="VALIDATED").length,
      missing:r.required?Math.max(0,r.quantity-confirmed.filter(d=>d.typeId===r.typeId && d.status!=="REJECTED").length):0})),
    // PV-04 y la confirmación del almacenamiento aún no están implementadas en este avance.
    approvalAllowed:false as const, policyStatus:"CONFIGURATION_PENDING" as const };
}
