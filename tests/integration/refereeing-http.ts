import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {request as httpRequest} from "node:http";
import type pg from "pg";
import {mutateRefereeing} from "../../src/features/referees/server/service";
// Cookie jar real compartido con las regresiones de NextAuth existentes.
import {Browser} from "./auth.test.mjs";

export async function verifyRefereeingHttp(c:{db:pg.Client;actors:Record<string,string>;league:string;season:string;referee:string;base:string;newMatch:()=>Promise<string>}){
  const clients:Record<string,Browser>={};
  for(const role of ["comision","programador","arbitro","lector","ajeno"]){const client=new Browser(c.base);await client.login(`${role}@example.test`,"Arbitraje-Local-141!");assert.equal((await client.session()).user.id,c.actors[role]);clients[role]=client;}
  const post=(role:string,body:unknown)=>clients[role].request("/api/referees",{method:"POST",headers:{origin:c.base,"content-type":"application/json","X-Expected-Actor-Id":c.actors[role]},body:JSON.stringify(body)});
  const command=(kind:string,more:Record<string,unknown>)=>({kind,operationKey:randomUUID(),leagueId:c.league,seasonId:c.season,reason:"Recorrido HTTP sintético autorizado",...more});
  assert.equal((await new Browser(c.base).request("/api/referees")).status,401);
  assert.equal((await clients.ajeno.request(`/api/referees?league=${c.league}&season=${c.season}`)).status,403);
  assert.equal((await clients.arbitro.request(`/api/referees?league=${c.league}&season=${c.season}`)).status,403);
  const rows=await clients.comision.request(`/api/referees?league=${c.league}&season=${c.season}`);assert.equal(rows.status,200);const workspace=await rows.json();
  assert.ok(workspace.data.referees.some((r:{id:string})=>r.id===c.referee));
  const ref=workspace.data.referees.find((r:{id:string})=>r.id===c.referee);
  await mutateRefereeing(c.actors.comision,command("availability",{refereeId:c.referee,expectedVersion:ref.version,startsAt:"2026-12-05T00:00:00Z",endsAt:"2026-12-11T00:00:00Z",available:true}));
  const match=await c.newMatch(),proposalCommand=command("propose",{matchId:match,refereeId:c.referee,expectedMatchVersion:1});
  const proposalResponse=await post("programador",proposalCommand);assert.equal(proposalResponse.status,200);const proposal=await proposalResponse.json();
  const matchPath=`/matches/${match}/lineup`;
  const denied=await clients.arbitro.request(matchPath);assert.equal(denied.status,200);assert.ok((await denied.text()).includes("Acceso denegado"));
  assert.equal((await post("programador",command("approve",{assignmentId:proposal.id,expectedVersion:proposal.version,expectedMatchVersion:1}))).status,403);
  const approveCommand=command("approve",{assignmentId:proposal.id,expectedVersion:proposal.version,expectedMatchVersion:1});
  // Destruir la conexión al recibir las cabeceras, sin consumir el acuse. El
  // servicio ya confirmó la transacción antes de emitir la respuesta HTTP.
  await new Promise<void>((resolve,reject)=>{
    const request=httpRequest(`${c.base}/api/referees`,{method:"POST",headers:{origin:c.base,"content-type":"application/json","X-Expected-Actor-Id":c.actors.comision,cookie:[...clients.comision.cookies].map(([k,v])=>`${k}=${v}`).join("; ")}},response=>{
      const status=response.statusCode;response.destroy();request.destroy();
      if(status===200)resolve();else reject(Error(`APPROVAL_HTTP_${status}`));
    });request.once("error",reject);request.end(JSON.stringify(approveCommand));
  });
  const recovery=await clients.comision.request(`/api/referees?operationKey=${approveCommand.operationKey}`);assert.equal(recovery.status,200);const approved=(await recovery.json()).receipt;assert.equal(approved.id,proposal.id);
  const events=Number((await c.db.query("SELECT count(*) FROM sports_management.referee_operations WHERE assignment_id=$1",[approved.id])).rows[0].count);
  const replay=await post("comision",approveCommand);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),approved);
  assert.equal(Number((await c.db.query("SELECT count(*) FROM sports_management.referee_operations WHERE assignment_id=$1",[approved.id])).rows[0].count),events);
  const effective=await clients.arbitro.request(matchPath);assert.equal(effective.status,200);assert.ok((await effective.text()).includes("143-"));
  await assert.rejects(c.db.query("UPDATE sports_management.referees SET is_active=false WHERE id=$1",[c.referee]),/APPROVED_ASSIGNMENT_CONFLICT:INACTIVE/);
  const wrong=await clients.ajeno.request(matchPath);assert.equal(wrong.status,200);assert.ok((await wrong.text()).includes("Acceso denegado"));
  const revoke=await post("comision",command("revoke",{assignmentId:approved.id,expectedVersion:approved.version,expectedMatchVersion:1}));assert.equal(revoke.status,200);
  const revoked=await clients.arbitro.request(matchPath);assert.equal(revoked.status,200);assert.ok((await revoked.text()).includes("Acceso denegado"));
  // Mismo usuario y misma cookie; retirar APPROVE no debe conservar autoridad.
  const grant=(await c.db.query("SELECT rp.role_id,rp.permission_id,rp.context_only FROM sports_management.role_permissions rp JOIN sports_management.roles r ON r.id=rp.role_id JOIN sports_management.permissions p ON p.id=rp.permission_id WHERE r.code='REFEREE_MANAGER' AND p.module='refereeing' AND p.action='APPROVE'")).rows[0];assert.ok(grant);
  await c.db.query("DELETE FROM sports_management.role_permissions WHERE role_id=$1 AND permission_id=$2",[grant.role_id,grant.permission_id]);
  try{assert.equal((await post("comision",command("assign",{matchId:match,refereeId:c.referee,expectedMatchVersion:1}))).status,403);const navigation=await clients.comision.request("/referees");assert.equal(navigation.status,200);}finally{await c.db.query("INSERT INTO sports_management.role_permissions(role_id,permission_id,context_only) VALUES($1,$2,$3)",[grant.role_id,grant.permission_id,grant.context_only]);}
  console.log(JSON.stringify({suite:"PDGLD-143 HTTP",realSession:true,realPostgres:true,runtimeRole:"gestor_ligas_preview",checks:["padron-autorizado","propuesta-sin-acceso","aprobacion-RF22","acuse-tras-commit","partido-propio","revocacion-revalida","permiso-retirado-misma-sesion"]}));
  const {verifyRealRefereeingBrowser}=await import("../e2e/refereeing-real.mjs");
  await verifyRealRefereeingBrowser({base:c.base,league:c.league,season:c.season,commission:clients.comision,referee:clients.arbitro,match});
  return {clients,match};
}
