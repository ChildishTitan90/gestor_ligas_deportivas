import assert from "node:assert/strict";
import test from "node:test";
import { matchesSignatureBinding } from "./signature-binding";

const context = {
  actorId: "59000000-0000-4000-8000-000000000001",
  clubId: "59000000-0000-4000-8000-000000000002",
  seasonId: "59000000-0000-4000-8000-000000000003",
  office: "PRESIDENT" as const,
};

const file = {
  id: "59000000-0000-4000-8000-000000000004",
  uploaded_by: context.actorId,
  storage_key:
    "affiliation-signatures/v1/" +
    "59000000-0000-4000-8000-000000000002/" +
    "59000000-0000-4000-8000-000000000003/" +
    "59000000-0000-4000-8000-000000000001/" +
    "PRESIDENT/" +
    "59000000-0000-4000-8000-000000000004",
};

const otherId = "59000000-0000-4000-8000-000000000099";

test("acepta la firma del usuario, club, temporada y cargo correctos", () => {
  assert.equal(matchesSignatureBinding(file, context), true);
});

test("rechaza reutilizar la firma en otro club o temporada", () => {
  assert.equal(
    matchesSignatureBinding(file, {
      ...context,
      clubId: otherId,
    }),
    false,
  );

  assert.equal(
    matchesSignatureBinding(file, {
      ...context,
      seasonId: otherId,
    }),
    false,
  );
});

test("rechaza usar la firma del presidente para otro cargo", () => {
  assert.equal(
    matchesSignatureBinding(file, {
      ...context,
      office: "SECRETARY",
    }),
    false,
  );
});

test("rechaza otro propietario o una identidad de archivo distinta", () => {
  assert.equal(
    matchesSignatureBinding(
      { ...file, uploaded_by: otherId },
      context,
    ),
    false,
  );

  assert.equal(
    matchesSignatureBinding(
      { ...file, id: otherId },
      context,
    ),
    false,
  );
});