import test from "node:test";
import assert from "node:assert/strict";
import { noShowSchema, proposedNoShowScore } from "./no-show";

test("una ausencia propone 1–0 para el equipo presente; ambas no asignan ganador",()=>{
  assert.deepEqual(proposedNoShowScore({absent:"HOME",notes:"No se presentó"}),{home:0,away:1});
  assert.deepEqual(proposedNoShowScore({absent:"AWAY",notes:"No se presentó"}),{home:1,away:0});
  assert.equal(proposedNoShowScore({absent:"BOTH",notes:"No se presentaron"}),null);
  assert.equal(noShowSchema.safeParse({absent:"HOME",notes:" "}).success,false);
  assert.equal(noShowSchema.safeParse({absent:"OTHER",notes:"No se presentó"}).success,false);
});
