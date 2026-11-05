export const schoolDocumentCodes = ["STUDENT_ID", "STUDENT_CERTIFICATE"] as const;
export function schoolDocumentStatus(minor: boolean | null, types: readonly {id:string;code:string}[], documents: readonly {typeId:string;reviewStatus:string;superseded:boolean;storageConfirmation:string}[]) {
  const ids = new Set(types.filter(t => schoolDocumentCodes.includes(t.code as typeof schoolDocumentCodes[number])).map(t => t.id));
  const current = documents.filter(d => ids.has(d.typeId) && !d.superseded && d.storageConfirmation === "CONFIRMED" && d.reviewStatus !== "REJECTED");
  return { required: minor === true, received: current.length > 0, approved: current.some(d => d.reviewStatus === "VALIDATED") };
}
