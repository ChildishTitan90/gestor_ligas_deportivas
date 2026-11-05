import test from "node:test";
import assert from "node:assert/strict";
import {cameraCrop} from "./camera-framing";
test("INE horizontal sobre video vertical recorta exactamente el marco visible sin estirar",()=>{
 const c=cameraCrop(1080,1920,320,320/1.586,.06);
 assert.ok(Math.abs(c.width/c.height-1.586)<.00001);
 assert.ok(Math.abs(c.x+c.width/2-540)<.00001);assert.ok(Math.abs(c.y+c.height/2-960)<.00001);
 assert.ok(c.x>=0 && c.y>=0 && c.x+c.width<=1080 && c.y+c.height<=1920);
});
test("Selfie y foto de jugador conservan el área visible en retrato",()=>{
 const c=cameraCrop(1920,1080,300,400);
 assert.equal(c.width/c.height,.75);assert.equal(c.height,1080);assert.equal(c.x+c.width/2,960);
 assert.throws(()=>cameraCrop(0,1080,300,400));
});
test("Selfie cerrada conserva el centro y el rectángulo del óvalo 4:5",()=>{
 const c=cameraCrop(1080,1920,300,375,.08);
 assert.ok(Math.abs(c.width/c.height-.8)<.00001);
 assert.ok(Math.abs(c.x+c.width/2-540)<.00001);assert.ok(Math.abs(c.y+c.height/2-960)<.00001);
 assert.ok(c.width<1080 && c.height<1920);
});
