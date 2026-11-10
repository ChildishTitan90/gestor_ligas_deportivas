import assert from "node:assert/strict";
import test from "node:test";
import {randomUUID} from "node:crypto";
import {sendPlayerDocumentOperation,type PendingDocumentUpload} from "./document-upload.client";
const actor=randomUUID(),upload=randomUUID(),documentId=randomUUID(),path=`/api/player-documents/uploads/${upload}`;
function operation():PendingDocumentUpload{return {body:{operationKey:randomUUID()},bytes:new Uint8Array([1,2,3]),mimeType:"application/pdf",step:"PREPARE"};}
test("respuesta de preparación perdida conserva la intención y no crea otra clave",async()=>{
  const pending=operation(),bodies:string[]=[];let failed=false;
  const fetcher:typeof fetch=async(url,options)=>{
    if(String(url)==="/api/player-documents/uploads"){bodies.push(String(options?.body));if(!failed){failed=true;throw new Error("synthetic lost response");}return Response.json({uploadId:upload,uploadPath:path});}
    return String(url).endsWith('/confirm')?Response.json({documentId}):Response.json({stored:true});
  };
  await assert.rejects(sendPlayerDocumentOperation(actor,pending,fetcher));
  assert.equal((await sendPlayerDocumentOperation(actor,pending,fetcher)).documentId,documentId);assert.equal(bodies[0],bodies[1]);
});
test("acuse de confirmación perdido se recupera sin volver a cargar el archivo",async()=>{
  const pending=operation();let puts=0,confirmations=0;
  const fetcher:typeof fetch=async(url,options)=>{
    if(String(url)==="/api/player-documents/uploads")return Response.json({uploadId:upload,uploadPath:path});
    if(options?.method==='PUT'){puts++;return Response.json({stored:true});}
    if(++confirmations===1)throw new Error('synthetic response lost');return Response.json({documentId});
  };
  await assert.rejects(sendPlayerDocumentOperation(actor,pending,fetcher));assert.equal(pending.step,'CONFIRM');
  await sendPlayerDocumentOperation(actor,pending,fetcher);assert.equal(puts,1);assert.equal(confirmations,2);
});
test("rechaza rutas inesperadas antes de transmitir el archivo",async()=>{
  const pending=operation();let calls=0;
  const fetcher:typeof fetch=async()=>{calls++;return Response.json({uploadId:upload,uploadPath:'https://example.test/unexpected'});};
  await assert.rejects(sendPlayerDocumentOperation(actor,pending,fetcher));assert.equal(calls,1);assert.equal(pending.step,'PREPARE');
});
test("un fallo de Storage conserva los mismos bytes y no confirma recepción",async()=>{
  const pending=operation();let confirms=0;
  const fetcher:typeof fetch=async(url,options)=>{
    if(String(url)==="/api/player-documents/uploads")return Response.json({uploadId:upload,uploadPath:path});
    if(options?.method==='PUT')return Response.json({code:'STORAGE_UNAVAILABLE'},{status:503});
    confirms++;return Response.json({documentId});
  };
  await assert.rejects(sendPlayerDocumentOperation(actor,pending,fetcher));assert.equal(pending.step,'UPLOAD');assert.equal(confirms,0);assert.deepEqual([...pending.bytes],[1,2,3]);
});
