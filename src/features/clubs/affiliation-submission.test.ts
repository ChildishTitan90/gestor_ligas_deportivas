import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { affiliationSubmissionSchema, canonicalAffiliationSubmission } from "./affiliation-submission";

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
