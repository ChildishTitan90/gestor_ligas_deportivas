/** Define qué acciones se muestran; el servidor vuelve a autorizar cada escritura. */
export function proposalActions({ status, seasonOpen, canUpdate, canApprove, generated, operationalCount }: {
  status: string; seasonOpen: boolean; canUpdate: boolean; canApprove: boolean; generated: boolean; operationalCount: number;
}) {
  return {
    canEdit: seasonOpen && status === "DRAFT" && canUpdate,
    canReview: seasonOpen && status === "IN_REVIEW" && canApprove,
    canActivate: seasonOpen && status === "APPROVED" && generated && operationalCount === 0 && canApprove,
  };
}
