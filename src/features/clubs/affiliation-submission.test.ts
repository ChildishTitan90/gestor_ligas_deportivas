import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { affiliationSubmissionSchema, canonicalAffiliationSubmission } from "./affiliation-submission";
import { affiliationReviewSchema, affiliationResubmissionSchema, affiliationListSchema } from "./affiliation-review";

test("PDGLD-60: requiere versión, motivo de corrección y rechaza decisiones no acordadas", () => {
  assert.ok(affiliationReviewSchema.safeParse({ decision: "APPROVE", expectedVersion: 0 }).success);
  assert.ok(affiliationReviewSchema.safeParse({ decision: "REQUEST_CORRECTIONS", expectedVersion: 3, observations: "Corregir uniforme" }).success);
  for (const invalid of [
    { decision: "APPROVE" }, { decision: "APPROVE", expectedVersion: -1 },
    { decision: "REJECT", expectedVersion: 0 },
    { decision: "REQUEST_CORRECTIONS", expectedVersion: 0, observations: "  " },
    { decision: "APPROVE", expectedVersion: 0, reviewedBy: randomUUID() },
  ]) assert.equal(affiliationReviewSchema.safeParse(invalid).success, false);
});
test("PDGLD-60: limita consultas y exige envío completo para corregir", () => {
  assert.equal(affiliationListSchema.safeParse({}).success, false);
  assert.equal(affiliationListSchema.safeParse({ leagueId: randomUUID(), pageSize: "101" }).success, false);
  assert.equal(affiliationListSchema.parse({ leagueId: randomUUID() }).pageSize, 20);
  assert.ok(affiliationResubmissionSchema.safeParse({ ...input(), expectedVersion: 1 }).success);
  assert.equal(affiliationResubmissionSchema.safeParse({ expectedVersion: 1, uniformColors: "Azul" }).success, false);
});

function input() {
  const officer = () => ({ firstName: "Persona sintética", paternalSurname: "Prueba", maternalSurname: "", signatureFileId: randomUUID() });
  return { submissionKey: randomUUID(), clubId: randomUUID(), seasonId: randomUUID(),
    clubName: "Club sintético", uniformColors: "Azul", categoryIds: [randomUUID(), randomUUID()],
    officers: { PRESIDENT: officer(), SECRETARY: officer(), TREASURER: officer() } };
}

test("PDGLD-57: envío completo, normalización y huella estable por orden de categorías", () => {
  const raw = input();
  const parsed = affiliationSubmissionSchema.parse({ ...raw, clubName: "  Club sintético  " });
  assert.equal(parsed.clubName, "Club sintético");
  assert.equal(canonicalAffiliationSubmission(parsed), canonicalAffiliationSubmission({ ...parsed, categoryIds: [...parsed.categoryIds].reverse() }));
  assert.notEqual(canonicalAffiliationSubmission(parsed), canonicalAffiliationSubmission({ ...parsed, uniformColors: "Rojo" }));
});

test("PDGLD-57: rechaza contexto/identidad inventados, categorías duplicadas y datos sin firma", () => {
  const valid = input();
  for (const changes of [
    { clubId: "no-uuid" }, { seasonId: "" }, { submissionKey: "no-uuid" },
    { requestedBy: randomUUID() }, { leagueId: randomUUID() }, { status: "APPROVED" },
    { referenceNumber: "inventado" }, { clubName: " " }, { uniformColors: "x".repeat(201) },
    { categoryIds: [] }, { categoryIds: [valid.categoryIds[0], valid.categoryIds[0]] },
    { officers: { ...valid.officers, PRESIDENT: { ...valid.officers.PRESIDENT, signatureFileId: undefined } } },
    { officers: { PRESIDENT: valid.officers.PRESIDENT } },
  ]) assert.equal(affiliationSubmissionSchema.safeParse({ ...valid, ...changes }).success, false);
});
