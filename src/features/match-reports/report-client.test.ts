import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createReportDemo } from "./demo-data";
import { createReportClient } from "./report-client";

test("transportes sintéticos: recuperar subida y acuse sin cambiar intención ni contenido", async t => {
  const data=createReportDemo(), actor=randomUUID(), op=randomUUID(), file=randomUUID();
  data.report.signatures.home={captainId:"home-4",source:"device",image:"data:image/png;base64,c3ludGhldGlj"};
  const receipt={formatVersion:1,operationId:op,matchId:data.match.id,reportId:randomUUID(),reportVersion:3,matchVersion:3,status:"DRAFT"};
  const prior=global.fetch; t.after(()=>{global.fetch=prior;});
  const uploads: string[]=[]; const drafts: string[]=[];
  global.fetch=async(input,init)=>{
    const path=String(input),body=String(init?.body??"");
    if(path.endsWith("/signatures")){uploads.push(body);if(uploads.length===1)throw Error("Acuse de subida perdido · Sintético");return Response.json({fileId:file});}
    if(path.includes("operationId="))return Response.json({status:"APPLIED",receipt});
    drafts.push(body);if(drafts.length===1)throw Error("Acuse SQL perdido · Sintético");return Response.json(receipt);
  };
  const client=createReportClient(actor,data);
  const operation={id:op,kind:"save" as const,expectedReportVersion:2,expectedMatchVersion:3,snapshot:structuredClone(data.report)};
  await assert.rejects(client.send(operation));
  await assert.rejects(client.send(operation));
  assert.equal(uploads[0],uploads[1],"La subida conserva identificador, imagen y contenido");
  assert.deepEqual(await client.query(op),{status:"APPLIED",receipt});
  operation.snapshot.remarks="Otra captura posterior";
  assert.deepEqual(await client.send(operation),receipt);
  assert.equal(drafts[0],drafts[1],"Un reintento conserva exactamente la intención original");
  assert.equal(uploads.length,2,"No repite la subida ya acusada");
});

test("recarga sintética: la clave de subida y el comando sobreviven a otra instancia del cliente", async t => {
  const data = createReportDemo();
  data.report.signatures.home = { captainId: "home-4", source: "device", image: "data:image/png;base64,c3ludGhldGlj" };
  const operation = { id: randomUUID(), kind: "save" as const, expectedReportVersion: 2, expectedMatchVersion: 3, snapshot: structuredClone(data.report) };
  let persisted: import("./report-client").ReportAttempt | undefined;
  const durable = {
    async load() { return persisted && structuredClone(persisted); },
    async save(_id: string, attempt: import("./report-client").ReportAttempt) { persisted = structuredClone(attempt); },
  };
  const requests: string[] = [];
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async (_input, init) => {
    assert.ok(persisted, "La intención completa está persistida antes de la primera llamada");
    requests.push(String(init?.body));
    throw Error("Respuesta de subida perdida");
  };
  await assert.rejects(createReportClient("actor", data, durable).send(operation));
  operation.snapshot.remarks = "Edición posterior que debe permanecer fuera de la intención";
  await assert.rejects(createReportClient("actor", data, durable).send(operation));
  assert.equal(requests[0], requests[1]);
});
