import assert from "node:assert/strict";
import test from "node:test";
import { evaluatePlayerAge, isPlayerRegistrationDay } from "./player-policy";
import { playerPolicySchema } from "./schemas";
const policy = playerPolicySchema.parse({referenceYear:2026,minimumAge:14,maximumAge:16,exceptionMinimumAge:13,documents:["PHOTO","CURP"],registrationDays:[1,2,3],timezone:"America/Mexico_City",playersOnField:11,maximumCalledUp:18,maximumRoster:null});
test("edad por año: límites Sub-16 y carta sin aprobación implícita",()=>{
  for(const birthday of ["2010-01-01","2010-12-31","2012-12-31"]) assert.equal(evaluatePlayerAge(policy,birthday).status,"ORDINARY_RANGE");
  assert.equal(evaluatePlayerAge(policy,"2013-01-01").status,"REQUIRES_ADMIN_APPROVAL");
  for(const birthday of ["2009-12-31","2014-01-01"]) assert.equal(evaluatePlayerAge(policy,birthday).status,"OUTSIDE_RANGE");
  assert.equal(evaluatePlayerAge(policy,"2010-02-30").status,"INVALID_BIRTH_DATE");
});
test("Sub-8 sin excepción; libre y veteranos sin máximo",()=>{
  const small={...policy,minimumAge:7,maximumAge:8,exceptionMinimumAge:null};
  assert.equal(evaluatePlayerAge(small,"2020-01-01").status,"OUTSIDE_RANGE");
  assert.equal(evaluatePlayerAge(small,"2019-12-31").status,"ORDINARY_RANGE");
  assert.equal(evaluatePlayerAge({...policy,minimumAge:18,maximumAge:null,exceptionMinimumAge:null},"2008-12-31").status,"ORDINARY_RANGE");
  assert.equal(evaluatePlayerAge({...policy,minimumAge:35,maximumAge:null,exceptionMinimumAge:null},"1991-12-31").status,"ORDINARY_RANGE");
});
test("ventana semanal respeta el cambio de miércoles a jueves en la zona de la liga",()=>{
  assert.equal(isPlayerRegistrationDay(policy,new Date("2026-10-29T05:59:59Z")),true);
  assert.equal(isPlayerRegistrationDay(policy,new Date("2026-10-29T06:00:00Z")),false);
  assert.equal(isPlayerRegistrationDay(policy,new Date("2026-11-02T06:00:00Z")),true);
});
