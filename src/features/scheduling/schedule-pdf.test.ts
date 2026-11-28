import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFRawStream, decodePDFRawStream } from "pdf-lib";
import { createSchedulePdf } from "./schedule-pdf";

test("PDF incluye jornadas, horarios, canchas y descansos, y pagina calendarios grandes",async()=>{
  const matches=Array.from({length:48},(_,index)=>({round:Math.floor(index/4)+1,home:`Equipo ${index+1}`,
    away:`Rival ${index+1}`,venue:"Cancha municipal",start:"2030-01-06T15:00:00.000Z"}));
  const bytes=await createSchedulePdf({league:"Liga Morelia",season:"Temporada 2030",category:"Abierta",group:"General",
    timezone:"America/Mexico_City",version:4,generatedAt:new Date("2029-12-01T12:00:00Z"),matches,byes:[{round:1,team:"Descanso A"}]});
  const pdf=await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount()>1);
  assert.equal(pdf.getTitle(),"Programación de jornadas");
  const streams=pdf.context.enumerateIndirectObjects().flatMap(([,object])=>object instanceof PDFRawStream ? [new TextDecoder().decode(decodePDFRawStream(object).decode())] : []).join("\n");
  const encoded=(value:string)=>Buffer.from(value,"latin1").toString("hex").toUpperCase();
  for(const value of ["JORNADA 1","JORNADA 12","LOCAL","VISITANTE","CANCHA","FECHA Y HORA","Cancha municipal","Descanso A","DESCANSA","Equipo 1","Rival 1"]) assert.ok(streams.includes(encoded(value)),value);
});
