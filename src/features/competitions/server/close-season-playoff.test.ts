import test from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { assertPlayoffsComplete } from './close-season';

const bracket = (number:number) => ({ number, team_a_id:'a', team_b_id:'b', winner_id:'a' });
function fixture(brackets: ReturnType<typeof bracket>[] | null, enabled = true) {
  return { season_categories: { findMany: async () => [{
    competition_rules: { competition_rule_parameters: [{ parameter_value: enabled ? {playoff:{}} : {} }] },
    competition_stages: brackets ? [{format:{kind:'PLAYOFF_8'},brackets}] : [],
  }] } } as unknown as Prisma.TransactionClient;
}
test('el cierre admite liguilla con sus siete ganadores y temporadas sin liguilla',async()=>{
  await assert.doesNotReject(assertPlayoffsComplete(fixture(Array.from({length:7},(_,i)=>bracket(i+1))),'season'));
  await assert.doesNotReject(assertPlayoffsComplete(fixture(null,false),'season'));
});
test('el cierre bloquea cuadro ausente, ronda faltante o desempate sin ganador',async()=>{
  const unresolved=Array.from({length:7},(_,i)=>bracket(i+1));
  unresolved[6].winner_id=null as unknown as string;
  for(const tx of [fixture(null),fixture(unresolved.slice(0,6)),fixture(unresolved)])
    await assert.rejects(assertPlayoffsComplete(tx,'season'),{code:'UNRESOLVED_PLAYOFF'});
});
