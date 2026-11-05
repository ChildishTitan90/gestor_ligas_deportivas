import assert from "node:assert/strict";
import test from "node:test";
import {matchIneIdentity,type IneReading} from "./ine-identity-match";
import {playerIdentitySchema} from "./schemas";

function curp(date:string){const p=`SIAA${date.slice(2).replaceAll("-","")}HMNLRR0`,a="0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";return p+(10-[...p].reduce((n,c,i)=>n+a.indexOf(c)*(18-i),0)%10)%10;}
const identity=playerIdentitySchema.parse({curp:curp("1980-02-29"),firstName:"José Luis",paternalSurname:"Muñoz",maternalSurname:"Díaz",birthDate:"1980-02-29"});
const readings:IneReading[]=[{field:"curp",value:identity.curp},{field:"firstName",value:" JOSE  LUIS "},{field:"paternalSurname",value:"MUÑOZ"},{field:"maternalSurname",value:"DIAZ"},{field:"birthDate",value:"29/02/1980"}];
test("cotejo INE: igualdad completa normaliza acentos, mayúsculas y espacios",()=>{
  assert.deepEqual(matchIneIdentity(identity,readings),{status:"IDENTITY_VERIFIED",missingFields:[],mismatchedFields:[]});
});
test("cotejo INE: ninguna diferencia se corrige para aprobar ni se confunde Ñ con N",()=>{
  for(const [field,value] of [["curp",curp("1980-03-01")],["firstName","José"],["paternalSurname","Munoz"],["maternalSurname","López"],["birthDate","01/03/1980"]] as const){
    const result=matchIneIdentity(identity,readings.map(r=>r.field===field?{field,value}:r));
    assert.equal(result.status,"ADMIN_REVIEW_REQUIRED");assert.ok(result.mismatchedFields.includes(field));
  }
});
test("cotejo INE: datos ausentes, ambiguos o de formato desconocido no se verifican",()=>{
  for(const field of ["curp","firstName","paternalSurname","maternalSurname","birthDate"] as const){
    assert.ok(matchIneIdentity(identity,readings.filter(r=>r.field!==field)).missingFields.includes(field));
  }
  for(const value of ["800229","29/02/1981","1980-02-29","29/02/80",""]){
    assert.ok(matchIneIdentity(identity,readings.map(r=>r.field==="birthDate"?{...r,value}:r)).missingFields.includes("birthDate"));
  }
  assert.equal(matchIneIdentity(identity,[...readings,{field:"firstName",value:"Otro nombre"}]).status,"ADMIN_REVIEW_REQUIRED");
  assert.equal(matchIneIdentity(identity,[...readings,{field:"birthDate",value:""}]).status,"ADMIN_REVIEW_REQUIRED");
});
test("cotejo INE: sin apellido materno exige una lectura explícita vacía",()=>{
  const expected={...identity,maternalSurname:null};
  assert.equal(matchIneIdentity(expected,readings.map(r=>r.field==="maternalSurname"?{...r,value:""}:r)).status,"IDENTITY_VERIFIED");
  assert.equal(matchIneIdentity(expected,readings.filter(r=>r.field!=="maternalSurname")).status,"ADMIN_REVIEW_REQUIRED");
});
