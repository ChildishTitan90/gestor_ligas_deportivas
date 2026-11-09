import assert from 'node:assert/strict';
import test from 'node:test';
import { requiredCorrectionEvidence, correctionDecisionSchema, correctionRequestSchema } from './identity-correction';
const before = { curp: 'synthetic', firstName: 'Nombre', paternalSurname: 'Apellido', maternalSurname: null, birthDate: '2000-01-01' };
test('la evidencia depende del campo y la duda: sin excepciones para menores', () => {
    assert.deepEqual(requiredCorrectionEvidence(before, { ...before, curp: 'other' }, false), ['CURP_CERTIFICATE']);
    assert.deepEqual(requiredCorrectionEvidence(before, { ...before, firstName: 'Otro' }, false), ['CIVIL_RECORD']);
    assert.deepEqual(requiredCorrectionEvidence(before, { ...before, birthDate: '2001-01-01', curp: 'other' }, true), ['CURP_CERTIFICATE', 'CIVIL_RECORD', 'LINK_DOCUMENT']);
    assert.deepEqual(requiredCorrectionEvidence(before, { ...before, firstName: 'Otro' }, false, true), ['CURP_CERTIFICATE', 'CIVIL_RECORD']);
});
test('decisión exige observaciones; cliente no puede dar autoridad ni habilitación', () => {
    const body = { operationKey: '117e2026-1107-4a18-8a15-000000000242', decision: 'RETURN', observations: 'Documentación insuficiente', evidenceChecked: false, samePersonChecked: false, curpDiscrepancy: false };
    assert.equal(correctionDecisionSchema.safeParse(body).success, true);
    for (const extra of [{ actorId: 'forged' }, { approved: true }, { role: 'SUPERADMIN' }, { status: 'ACTIVE' }])
        assert.equal(correctionDecisionSchema.safeParse({ ...body, ...extra }).success, false);
    assert.equal(correctionDecisionSchema.safeParse({ ...body, observations: '' }).success, false);
    assert.equal(correctionRequestSchema.safeParse({ identity: before, expectedIdentityVersion: 1, operationKey: body.operationKey, identityDoubt: false, reason: 'Motivo válido sintético' }).success, false);
});
