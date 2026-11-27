import test from "node:test";
import assert from "node:assert/strict";
import { projectChanges, visibleText, actorLabel, actionLabel, reasonLabel } from "./projection";
import { auditFiltersSchema, auditHref } from "./contract";

test("la proyección selecciona campos visibles sin devolver datos privados ni objetos anidados",()=>{
  const result=projectChanges("users",{is_active:true,password_hash:"old-private"},{is_active:false,password_hash:"new-private",email:"private@example.test",encrypted_mfa_secret:"private",parameters:{token:"private"}});
  assert.deepEqual(result,[{field:"Cuenta activa",before:"Sí",after:"No"}]);
  assert.deepEqual(projectChanges("player_registrations",{curp:"private",status:"ACTIVE"},{curp:"other-private",status:"INELIGIBLE"}),[{field:"Estado deportivo",before:"Activo",after:"No habilitado"}]);
  assert.equal(visibleText("api_token=contenido-reservado","Reservado"),"Reservado");
  assert.equal(visibleText("correo private@example.test","Reservado"),"Reservado");
  assert.equal(visibleText("Cambio de estado autorizado","Reservado"),"Cambio de estado autorizado");
  assert.equal(actorLabel("persona@example.test"),"Usuario registrado");
});
test("los motivos solo permiten literales autorizados para la entidad y acción exactas",()=>{
  const personal="Se corrigió el registro de Marina Robles Soto por una situación familiar";
  for(const action of ["UPDATE","AFFILIATION_APPROVE","AFFILIATION_REQUEST_CORRECTIONS","UNKNOWN","constructor","__proto__"])
    assert.equal(reasonLabel("club_affiliations",action,personal),"Motivo reservado por privacidad.");
  const allowed="PDGLD-60: revisión de afiliación";
  assert.equal(reasonLabel("club_affiliations","AFFILIATION_APPROVE",allowed),allowed);
  assert.equal(reasonLabel("club_affiliations","AFFILIATION_REQUEST_CORRECTIONS",allowed),allowed);
  for(const value of [allowed+" Marina Robles Soto",{reason:allowed},null])
    assert.equal(reasonLabel("club_affiliations","AFFILIATION_APPROVE",value),"Motivo reservado por privacidad.");
  assert.equal(reasonLabel("users","AFFILIATION_APPROVE",allowed),"Motivo reservado por privacidad.");
});
test("las acciones de afiliación identifican aprobación, correcciones y reenvío",()=>{
  assert.equal(actionLabel("AFFILIATION_APPROVE"),"Afiliación aprobada");
  assert.equal(actionLabel("AFFILIATION_REQUEST_CORRECTIONS"),"Correcciones de afiliación solicitadas");
  assert.equal(actionLabel("AFFILIATION_RESUBMIT"),"Correcciones de afiliación reenviadas");
  assert.equal(actionLabel("UNKNOWN"),"Operación registrada");
  assert.equal(actionLabel("constructor"),"Operación registrada");
});
test("filtros estrictos conservan la consulta al navegar y rechazan fechas, ámbitos o campos no válidos",()=>{
  const filters=auditFiltersSchema.parse({scope:"general",actor:"@auditor",from:"2030-01-01",to:"2030-01-02",entity:"users"});
  assert.equal(filters.actor,"auditor");
  const href=auditHref({...filters,after:"cursor"},"");
  assert.ok(href.includes("scope=general") && !href.includes("after="));
  for(const value of [{from:"2030-02-30"},{from:"2030-02-03",to:"2030-01-01"},{scope:"all"},{actorId:"forged"},{entity:"people"},{actor:["one","two"]}])
    assert.equal(auditFiltersSchema.safeParse(value).success,false);
});
