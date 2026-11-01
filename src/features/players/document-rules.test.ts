import assert from "node:assert/strict";
import test from "node:test";
import {summarizeDossier,minorAtDate} from "./document-rules";
test("minoría por edad cumplida en la fecha de registro, sin cambiar al consultar después",()=>{
  assert.equal(minorAtDate("2008-10-27","2026-10-26"),true);
  assert.equal(minorAtDate("2008-10-27","2026-10-27"),false);
  assert.equal(minorAtDate(null,"2026-10-27"),null);
});
test("sin configuración nunca equivale a expediente aprobado",()=>{
  assert.equal(summarizeDossier([],[]).configuration,"MISSING");
  assert.equal(summarizeDossier([],[]).approvalAllowed,false);
});
test("respeta cantidades configuradas, distingue revisión y excluye rechazados",()=>{
  const result=summarizeDossier([{id:"r",typeId:"photo",quantity:2,required:true}],
    [{id:"a",typeId:"photo",status:"PENDING",storageConfirmed:true},{id:"b",typeId:"photo",status:"REJECTED",storageConfirmed:true}]);
  assert.equal(result.requirements[0].missing,1);assert.equal(result.requirements[0].approved,0);
  assert.equal(result.approvalAllowed,false);
});
test("credencial opcional y archivos históricos no acreditan requisitos obligatorios",()=>{
  const result=summarizeDossier([{id:"r",typeId:"CURP",quantity:1,required:true},{id:"s",typeId:"STUDENT_ID",quantity:1,required:false}],
    [{id:"old",typeId:"CURP",status:"VALIDATED"}]);
  assert.equal(result.requirements[0].missing,1);assert.equal(result.requirements[1].missing,0);
});
