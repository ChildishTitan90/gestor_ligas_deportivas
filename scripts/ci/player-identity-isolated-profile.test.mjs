import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDelegateArguments } from '../test-delegate-isolated.mjs';
import { accountApplicationPlan } from '../verification/account-independent-dependencies.mjs';
import { validateAccountProvisioningTarget } from '../verification/account-provisioning-entry.mjs';
const runId='d17a0000-0000-4000-8000-000000000117';
test('PDGLD-117: perfiles explícitos, dependencias propias y exclusión de perfiles incompatibles',()=>{
 for(const [flag,mode] of [['--player-identity-correction','identity-correction'],['--player-identity-age','identity-age-regression']]){
  const parsed=parseDelegateArguments(['--run-id',runId,flag]);assert.equal(parsed.mode,'plan');assert.equal(parsed.accountMode,mode);
  const plan=accountApplicationPlan({runId,major:15,verificationMode:mode});assert.equal(plan.dependencies,'independent');assert.equal(plan.major,15);
  assert.throws(()=>parseDelegateArguments(['--run-id',runId,flag,'--account-browser']));
 }
});
test('PDGLD-117: destino validado rechaza base local, host externo y otra versión antes de conectar',()=>{
 const config={databaseUrl:'postgresql://postgres:synthetic-not-a-secret@127.0.0.1:55415/pdgld48_test_d17a000000004015',baseUrl:'http://127.0.0.1:56515',suite:'identity-correction'};
 assert.equal(validateAccountProvisioningTarget(config).suite,'identity-correction');
 for(const databaseUrl of [config.databaseUrl.replace('55415','5434'),config.databaseUrl.replace('127.0.0.1','db.example.test'),config.databaseUrl.replace('pdgld48_test_d17a000000004015','gestor_ligas_dev'),config.databaseUrl.replace('004015','004017')]) assert.throws(()=>validateAccountProvisioningTarget({...config,databaseUrl}));
});
