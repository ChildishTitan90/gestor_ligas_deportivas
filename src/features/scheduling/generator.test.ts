import test from "node:test";
import assert from "node:assert/strict";
import { roundRobin, assignSlots, clashes } from "./generator";

test("pares únicos, descanso por equipo impar y localía inversa en segunda vuelta", () => {
  for (let count = 2; count <= 16; count++) {
    const ids = Array.from({ length: count }, (_, i) => String(i));
    const first = roundRobin(ids, 1), both = roundRobin(ids, 2);
    assert.equal(first.pairings.length, count * (count - 1) / 2);
    assert.equal(new Set(first.pairings.map(p => [p.home,p.away].sort().join("/"))).size, first.pairings.length);
    for (let round = 1; round <= (count % 2 ? count : count-1); round++) {
      const playing = first.pairings.filter(p=>p.round===round).flatMap(p=>[p.home,p.away]);
      const resting = first.byes.filter(b=>b.round===round).map(b=>b.teamId);
      assert.equal(new Set([...playing,...resting]).size,count);
      assert.equal(playing.length+resting.length,count);
    }
    for (const p of first.pairings) assert.ok(both.pairings.some(q=>q.round>p.round && q.home===p.away && q.away===p.home));
    assert.equal(first.byes.length,count % 2 ? count : 0);
  }
});
test("retrocede para reservar cancha compartida sin cambiar local y visitante", () => {
  const early = { venueId:"shared", start:0,end:60,reservedUntil:75,preference:0 };
  const late = { ...early,start:75,end:135,reservedUntil:150,preference:1 };
  const jobs = [{pairing:{round:1,home:"a",away:"b"},slots:[early,late]},
    {pairing:{round:1,home:"c",away:"d"},slots:[early]}];
  const result=assignSlots(jobs,[]);
  assert.equal(result.ok,true);
  if(result.ok) assert.equal(result.matches.find(m=>m.home==="a")?.start,75);
  assert.equal(assignSlots(jobs.map(j=>({...j,slots:[early]})),[]).ok,false);
});
test("conflicto de equipos entre canchas y límite de búsqueda no entregan partidos parciales",()=>{
  const pairing={round:1,home:"a",away:"b"};
  const slot={venueId:"v",start:0,end:60,reservedUntil:60,preference:0};
  assert.equal(assignSlots([{pairing,slots:[slot]}],[{...slot,...pairing,venueId:"other"}]).ok,false);
  const limited=assignSlots([{pairing,slots:[slot]}],[],{nodes:0,milliseconds:5000});
  assert.equal(limited.ok,false);
  if(!limited.ok) assert.equal(limited.code,"SEARCH_LIMIT");
});

test("20 equipos, dos vueltas y cuatro canchas: calendario completo sin cruces", t => {
  const start = performance.now();
  const calendar = roundRobin(Array.from({ length: 20 }, (_, i) => `team-${i}`), 2);
  const jobs = calendar.pairings.map(pairing => ({ pairing, slots: Array.from({ length: 12 }, (_, i) => {
    const at = pairing.round * 7 * 86400000 + Math.floor(i / 4) * 120 * 60000;
    return { venueId: `venue-${i % 4}`, start: at, end: at + 90 * 60000,
      reservedUntil: at + 120 * 60000, preference: 0 };
  }) }));
  const result = assignSlots(jobs, []);
  const elapsed = performance.now() - start;
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.matches.length, 380);
    for (let i = 0; i < result.matches.length; i++) {
      for (let j = i + 1; j < result.matches.length; j++) assert.equal(clashes(result.matches[i], result.matches[j]), false);
    }
  }
  assert.ok(elapsed < 30000);
  t.diagnostic(`20 equipos; 38 jornadas; 380 partidos; 4560 candidatos; ${elapsed.toFixed(1)} ms (motor puro).`);
});

test("retroceso real encuentra solución cuando la primera preferencia bloquea un ciclo", () => {
  const slot = (venueId: string, preference: number) => ({ venueId, start: 0, end: 60, reservedUntil: 60, preference });
  const jobs = [
    { pairing: { round: 1, home: "a", away: "b" }, slots: [slot("v1", 0), slot("v2", 1)] },
    { pairing: { round: 1, home: "c", away: "d" }, slots: [slot("v1", 0), slot("v3", 1)] },
    { pairing: { round: 1, home: "e", away: "f" }, slots: [slot("v1", 0), slot("v3", 1)] },
  ];
  const result = assignSlots(jobs, []);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.matches.find(m => m.home === "a")?.venueId, "v2");
});

test("compara soluciones y encuentra la combinación con menor costo de preferencias", () => {
  const slot = (venueId: string, preference: number) => ({ venueId, start: 0, end: 60, reservedUntil: 60, preference });
  const jobs = [
    { pairing: { round: 1, home: "a", away: "b" }, slots: [slot("shared", 0), slot("alternative-a", 1)] },
    { pairing: { round: 1, home: "c", away: "d" }, slots: [slot("shared", 0), slot("alternative-b", 10)] },
  ];
  const result = assignSlots(jobs, []);
  assert.ok(result.ok);
  assert.equal(result.matches.reduce((total, match) => total + match.preference, 0), 1);
  assert.equal(result.preferenceOptimal, true);
});

test("si se agota el límite conserva una solución completa sin afirmar que es óptima", () => {
  const jobs = [
    { pairing: { round: 1, home: "a", away: "b" }, slots: [
      { venueId: "v1", start: 0, end: 60, reservedUntil: 60, preference: 0 },
      { venueId: "v2", start: 0, end: 60, reservedUntil: 60, preference: 1 },
    ] },
  ];
  const result = assignSlots(jobs, [], { nodes: 3, milliseconds: 5000 });
  assert.ok(result.ok);
  assert.equal(result.matches.length, 1);
  assert.equal(result.preferenceOptimal, false);
});
