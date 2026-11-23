import { effectiveCaptain } from "../../src/features/match-reports/captaincy";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { Browser } from "./auth.test.mjs";
import type { ReportCommand } from "../../src/features/match-reports/contract";

export async function verifyReportHttp(base: string, actors: Record<string,string>, command: ReportCommand, signatureId: string, image: string, noShow:ReportCommand) {
  const own = new Browser(base), foreign = new Browser(base), referee = new Browser(base);
  for (const [client, email, id] of [[own,"capturista@example.test",actors.capturista],[foreign,"ajeno147@example.test",actors.capturistaAjeno],[referee,"arbitro@example.test",actors.arbitro]] as const) {
    await client.login(email,"Arbitraje-Local-141!"); assert.equal((await client.session()).user.id,id);
  }
  const path = `/api/match-reports/${command.matchId}`;
  const noShowPath=`/api/match-reports/${noShow.matchId}`;
  const noShowHeaders={origin:base,"content-type":"application/json","X-Expected-Actor-Id":actors.capturista};
  assert.equal((await foreign.request(noShowPath,{method:"POST",headers:{...noShowHeaders,"X-Expected-Actor-Id":actors.capturistaAjeno},body:JSON.stringify(noShow)})).status,403);
  const absence=await own.request(noShowPath,{method:"POST",headers:noShowHeaders,body:JSON.stringify(noShow)});
  assert.equal(absence.status,200);
  const absenceReceipt=await absence.json();
  const absenceRetry=await own.request(noShowPath,{method:"POST",headers:noShowHeaders,body:JSON.stringify(noShow)});
  assert.equal(absenceRetry.status,200);assert.deepEqual(await absenceRetry.json(),absenceReceipt);
  const absenceView=await own.request(noShowPath);assert.equal(absenceView.status,200);
  const savedAbsence=await absenceView.json();
  assert.equal(savedAbsence.match.status.code,"NO_SHOW");assert.equal(savedAbsence.report.noShow.absent,"BOTH");
  assert.equal(savedAbsence.match.status.captureAllowed,false);
  assert.equal((await new Browser(base).request(path)).status,401);
  assert.equal((await foreign.request(path)).status,403);
  const photoPath = `${path}/players/${command.draft.lineups[0].playerId}/photo`;
  assert.equal((await new Browser(base).request(photoPath)).status,401);
  assert.equal((await foreign.request(photoPath)).status,403);
  const readable=await referee.request(path);assert.equal(readable.status,200);
  assert.equal((await readable.json()).confirmation.available,true);
  const list = await own.request("/matches");assert.equal(list.status,200);const listing=await list.text();assert.match(listing,/PARTIDO|REAL-147/);assert.ok(!listing.includes("Demo · Cédula arbitral"));assert.ok(!listing.includes("FUERA-DE-AMBITO-"));
  const retired=await own.request("/matches/report-demo");if(retired.status===307)assert.equal(retired.headers.get("location"),"/matches");else{assert.equal(retired.status,200);assert.match(await retired.text(),/NEXT_REDIRECT[\s\S]*matches|http-equiv="refresh"/);}
  const page = await own.request(`/matches/${command.matchId}/report`);
  assert.equal(page.status,200); assert.match(await page.text(),/Prepara el partido antes de capturar/);
  const wrongActor = await own.request(path,{method:"POST",headers:{origin:base,"content-type":"application/json","X-Expected-Actor-Id":actors.arbitro},body:JSON.stringify(command)});
  assert.equal(wrongActor.status,403);
  // Se corta la conexión después del COMMIT y antes de consumir el acuse.
  await new Promise<void>((resolve,reject)=>{
    const req=httpRequest(base+path,{method:"POST",headers:{origin:base,"content-type":"application/json","X-Expected-Actor-Id":actors.capturista,cookie:[...own.cookies].map(([k,v])=>`${k}=${v}`).join("; ")}},response=>{
      const status=response.statusCode;response.destroy();req.destroy();if(status===200)resolve();else reject(Error(`REPORT_HTTP_${status}`));
    });req.once("error",reject);req.end(JSON.stringify(command));
  });
  const result=await own.request(`${path}?operationId=${command.operationId}`);assert.equal(result.status,200);
  const receipt=(await result.json()).receipt;assert.ok(receipt);assert.equal(receipt.reportVersion,command.expectedReportVersion+1);
  const replay=await own.request(path,{method:"POST",headers:{origin:base,"content-type":"application/json","X-Expected-Actor-Id":actors.capturista},body:JSON.stringify(command)});
  assert.equal(replay.status,200);assert.deepEqual(await replay.json(),receipt);
  const {randomUUID}=await import("node:crypto");
  const confirmation=await own.request(path,{method:"POST",headers:{origin:base,"content-type":"application/json","X-Expected-Actor-Id":actors.capturista},body:JSON.stringify({...command,operationId:randomUUID(),kind:"confirm",expectedReportVersion:receipt.reportVersion})});
  assert.equal(confirmation.status,409);assert.equal((await confirmation.json()).code,"STANDINGS_RULES_INCOMPLETE");
  const afterRejected=await own.request(path);const unchanged=await afterRejected.json();assert.equal(unchanged.report.version,receipt.reportVersion);assert.equal(unchanged.report.status,"DRAFT");assert.equal(unchanged.match.status.code,"IN_PROGRESS");
  const png=await referee.request(`${path}/signatures/${signatureId}`);assert.equal(png.status,200);assert.equal(png.headers.get("content-type"),"image/png");assert.match(png.headers.get("cache-control")!,/no-store/);
  assert.equal((await foreign.request(`${path}/signatures/${signatureId}`)).status,403);
  const teamId=Object.keys(command.draft.captains)[0];
  const upload={operationId:randomUUID(),matchId:command.matchId,teamId,captainId:effectiveCaptain(command.draft.captains[teamId],command.draft.events,teamId)!,expectedMatchVersion:command.expectedMatchVersion,expectedReportVersion:receipt.reportVersion,draft:command.draft,image};
  const postSignature=await own.request(path+"/signatures",{method:"POST",headers:{origin:base,"content-type":"application/json","X-Expected-Actor-Id":actors.capturista},body:JSON.stringify(upload)});
  assert.equal(postSignature.status,200);assert.ok((await postSignature.json()).fileId);
  const invalid=await own.request(path+"/signatures",{method:"POST",headers:{origin:base,"content-type":"application/json","X-Expected-Actor-Id":actors.capturista},body:JSON.stringify({...upload,operationId:randomUUID(),image:"data:image/png;base64,YWJj"})});assert.equal(invalid.status,400);
  console.log("PDGLD-147 HTTP OK: sesión NextAuth real, ámbito, protección de actor, página conectada, acuse perdido recuperado, replay y firma privada autenticada.");
}
