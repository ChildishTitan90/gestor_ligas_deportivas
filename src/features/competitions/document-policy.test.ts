import test from "node:test";
import assert from "node:assert/strict";
import {categoryDocumentPolicySchema,documentPolicyIssues} from "./document-policy";
import {syntheticDocumentPolicy} from "../../../tests/fixtures/player-document-policy";

test("la excepción de CURP es explícita, solo para adultos y no elimina su constancia del expediente",()=>{
  const p=syntheticDocumentPolicy();
  assert.equal(categoryDocumentPolicySchema.safeParse(p).success,true);
  assert.deepEqual(documentPolicyIssues(p,"OPEN",false),[]);
  p.requirements[0].audience="ALL";
  assert.equal(categoryDocumentPolicySchema.safeParse(p).success,false);
});
test("menores conservan credencial O constancia, CURP y autorización acreditada",()=>{
  const p=syntheticDocumentPolicy();
  assert.deepEqual(documentPolicyIssues(p,"OPEN",true),[]);
  p.requirements=p.requirements.filter(r=>r.key!=="GUARDIAN_CONSENT");
  assert.ok(documentPolicyIssues(p,"OPEN",true).includes("MISSING_GUARDIAN_REQUIREMENT"));
  const school=p.requirements.find(r=>r.key==="SCHOOL_EVIDENCE")!;school.anyOf=["STUDENT_ID"];
  assert.equal(categoryDocumentPolicySchema.safeParse(p).success,false);
});
test("no se aprueban políticas con decisiones pendientes ni se impone un acta por defecto",()=>{
  const p=syntheticDocumentPolicy();p.profile="VETERANS";p.status="DRAFT";p.pendingDecisions=["BIRTH_EVIDENCE_TYPES"];
  p.requirements.push({key:"BIRTH_EVIDENCE",audience:"ALL",anyOf:[],quantity:1,requiredForDossier:true,requiredForEligibility:true});
  assert.equal(categoryDocumentPolicySchema.safeParse(p).success,true);
  assert.ok(documentPolicyIssues(p,"VETERANS",false).includes("BIRTH_EVIDENCE_POLICY_PENDING"));
  p.status="APPROVED";assert.equal(categoryDocumentPolicySchema.safeParse(p).success,false);
});
test("el perfil infantil es explícito y no se deduce de nombres ni de toda la escala YOUTH",()=>{
  const p=syntheticDocumentPolicy();p.profile="YOUTH";
  assert.equal(documentPolicyIssues(p,"YOUTH",true).includes("BIRTH_EVIDENCE_POLICY_PENDING"),false);
  p.profile="CHILDREN";
  assert.ok(documentPolicyIssues(p,"YOUTH",true).includes("BIRTH_EVIDENCE_POLICY_PENDING"));
});
test("identificación oficial puede ser opcional y admite INE, licencia o pasaporte sin convertir la foto en identificación",()=>{
  const p=syntheticDocumentPolicy();assert.equal(categoryDocumentPolicySchema.safeParse(p).success,true);
  p.requirements.find(r=>r.key==="PHOTO_IDENTIFICATION")!.anyOf=["PHOTO"];
  assert.equal(categoryDocumentPolicySchema.safeParse(p).success,false);
  const other=syntheticDocumentPolicy();other.requirements.find(r=>r.key==="PLAYER_PHOTO")!.requiredForEligibility=true;
  assert.equal(categoryDocumentPolicySchema.safeParse(other).success,false);
});
