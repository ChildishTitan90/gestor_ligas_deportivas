import "server-only";
import {z} from "zod";
import {getPrisma} from "@/server/db/prisma";
import {requireOperationalUser} from "@/server/auth/session";
import {AuthorizationError} from "@/server/auth/authorization";
import {assertPlayerRegistrationRead,lockPlayerTeamContext} from "./access";
import {summarizeDossier,minorAtDate} from "../document-rules";
import {canCompleteActivatedDossier} from "./automatic-activation";
import {schoolDocumentStatus} from "../school-documents";
import {readRegistrationLabels} from "./registration-labels";
import {readCategoryDocumentState} from "./category-document-requirements";
import {resolveRegistrationDocuments} from "./registration-document-requirements";
import {assessPlayerEligibility} from "./eligibility-assessment";

export async function getPlayerDossier(registrationId:string){
  return readPlayerDossierForActor((await requireOperationalUser()).id,registrationId);
}
/** Consulta autorizada. Recibir archivos no confirma identidad ni habilitación. */
export async function readPlayerDossierForActor(actorId:string,registrationId:string){
  if(!z.uuid().safeParse(registrationId).success) throw new AuthorizationError();
  return getPrisma().$transaction(async tx=>{
    const registration=await tx.player_registrations.findUnique({where:{id:registrationId},select:{season_team_id:true,status:true,withdrawn_at:true,registered_at:true,people:{select:{identity_version:true,birth_date:true}}}});
    if(!registration)throw new AuthorizationError();
    const context=await assertPlayerRegistrationRead(tx,actorId,registrationId,registration.season_team_id);
    const owner=await readRegistrationLabels(tx,registrationId);
    const player={displayName:owner.name,teamName:owner.team,clubName:owner.club,categoryName:owner.category,seasonName:owner.season};
    let canUpdate=true;try{await lockPlayerTeamContext(tx,actorId,registration.season_team_id,"UPDATE");}catch(error){if(!(error instanceof AuthorizationError))throw error;canUpdate=false;}
    const referenceDate=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Mexico_City"}).format(registration.registered_at);
    const actualMinor=minorAtDate(registration.people.birth_date?.toISOString().slice(0,10) ?? null,referenceDate);
    const minor=actualMinor;
    const {combined:resolved,source,scopes}=await resolveRegistrationDocuments(tx,actorId,registrationId,context,minor);
    const state=await readCategoryDocumentState(tx,registrationId,registration.people.identity_version,resolved);
    const requirements=resolved.requirements;
    const completingActive=registration.status==="ACTIVE" && await canCompleteActivatedDossier(tx,registrationId,registration.people.identity_version,resolved);
    const currentDocuments=state.documents.map(d=>({id:d.id,typeId:d.document_type_id,reviewStatus:d.status,superseded:state.superseded.has(d.id),storageConfirmation:state.confirmed.has(d.id)?"CONFIRMED":"NOT_CHECKED"}));
    const school=schoolDocumentStatus(minor,requirements.map(r=>({id:r.document_type_id,code:r.document_types.code})),currentDocuments);
    const summary=summarizeDossier(requirements.map(r=>({id:r.id,typeId:r.document_type_id,quantity:r.quantity,required:["STUDENT_ID","STUDENT_CERTIFICATE"].includes(r.document_types.code)?false:r.is_required})),
      state.documents.filter(d=>!state.superseded.has(d.id)).map(d=>({id:d.id,typeId:d.document_type_id,status:d.status,storageConfirmed:state.confirmed.has(d.id)})));
    let canApprove=false;try{await lockPlayerTeamContext(tx,actorId,registration.season_team_id,"APPROVE");canApprove=true;}catch(error){if(!(error instanceof AuthorizationError))throw error;}
    const originAssessment=canApprove && registration.status==="INELIGIBLE"?await assessPlayerEligibility(tx,registrationId,[context]):null;
    const sourceState=scopes.length===1?state:await readCategoryDocumentState(tx,registrationId,registration.people.identity_version,source);
    return {registrationId,player,...summary,approvalAllowed:!!originAssessment?.ready,dossierComplete:state.dossierComplete,
      originDossierComplete:sourceState.dossierComplete,eligibilityDocumentsComplete:sourceState.eligibilityDocumentsComplete,documentGroups:state.groups,
      documentPolicyFingerprint:resolved.fingerprint,documentPolicyApproved:resolved.approved,
      activationMode:resolved.activation,school,identityVerification:{curpVerified:!!state.identityEvidence.curp,ineAttemptId:state.identityEvidence.ine?.attemptId ?? null},
      configuration:resolved.approved?"CONFIGURED" as const:"MISSING" as const,
      registrationStatus:registration.status,configurationIssues:resolved.issues,
      minorAtRegistration:actualMinor,minorDocumentFlow:minor,referenceDate,
      canUpload:canUpdate && (registration.status==="INELIGIBLE" || completingActive) && !registration.withdrawn_at && context.seasonStatus!=="CLOSED" && context.teamStatus!=="WITHDRAWN" && context.affiliationStatus==="APPROVED" && (context.categoryAuthorized && context.operational),
      documentTypes:requirements.map(r=>({id:r.document_type_id,...r.document_types,...(r.document_types.code==="PHOTO"?{name:"Foto del jugador"}:{})})),
      documents:state.documents.map(d=>{const receipt=state.revisions.find(r=>r.documentId===d.id);return {id:d.id,typeId:d.document_type_id,reviewStatus:d.status,superseded:state.superseded.has(d.id),requirementId:receipt?.requirementId,slot:receipt?.slot,storageConfirmation:state.confirmed.has(d.id)?"CONFIRMED" as const:"NOT_CHECKED" as const};}),
      guardianConsent:minor===true?(state.guardianAccredited?"ACCREDITED" as const:"REQUIRES_ACCREDITATION" as const):minor===false?"NOT_REQUIRED" as const:"UNKNOWN_AGE" as const};
  },{isolationLevel:"RepeatableRead"});
}
