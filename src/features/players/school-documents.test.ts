import assert from "node:assert/strict";
import test from "node:test";
import {schoolDocumentStatus} from "./school-documents";
test("Escolar: credencial o constancia cubren una sola alternativa obligatoria",()=>{
 const types=[{id:"id",code:"STUDENT_ID"},{id:"certificate",code:"STUDENT_CERTIFICATE"}];
 assert.equal(schoolDocumentStatus(true,types,[]).required,true);
 for(const typeId of ["id","certificate"]){
  const doc={typeId,reviewStatus:"VALIDATED",superseded:false,storageConfirmation:"CONFIRMED"};
  assert.equal(schoolDocumentStatus(true,types,[doc]).approved,true);
  for(const invalid of [{...doc,superseded:true},{...doc,reviewStatus:"REJECTED"},{...doc,storageConfirmation:"NOT_CHECKED"}])assert.equal(schoolDocumentStatus(true,types,[invalid]).received,false);
 }
 assert.equal(schoolDocumentStatus(false,types,[]).required,false);
});
