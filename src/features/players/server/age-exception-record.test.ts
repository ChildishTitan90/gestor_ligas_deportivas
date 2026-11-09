import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { readAgeExceptionRecord } from "./age-exception-record";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture() {
  const registration = { id: id(1), status: "INELIGIBLE", withdrawn_at: null, authorized_by: null as string | null,
    age_exception_reason: null as string | null, age_exception_file_id: null as string | null,
    people: { identity_version: 1, birth_date: new Date("2013-12-31T00:00:00Z") } };
  const category = { eligibility_pending: false, player_policy: { referenceYear: 2026, minimumAge: 14, maximumAge: 16,
    exceptionMinimumAge: 13, documents: ["CURP"], registrationDays: [1, 2, 3], timezone: "America/Mexico_City", playersOnField: 11,
    maximumCalledUp: null, maximumRoster: null } };
  const document = { id: id(3), file_id: id(4), status: "PENDING", files: { sha256: "a".repeat(64), size_bytes: BigInt(100) } };
  type Event = { id: string; action: string; reason: string; user_id: string; new_data: Record<string, unknown> };
  const events: Event[] = [
    { id: id(5), user_id: id(7), action: "PLAYER_AGE_EXCEPTION_CAPTURED", reason: "Captura", new_data: {} },
    { id: id(6), user_id: id(7), action: "PLAYER_DOCUMENT_CONFIRMED", reason: "Confirmación sintética", new_data: { documentId: document.id, replacesDocumentId: null, identityVersion: 1 } },
  ];
  const tx = {
    player_registrations: { findUniqueOrThrow: async () => registration }, season_categories: { findUniqueOrThrow: async () => category },
    audit_logs: { findMany: async () => events },
    player_documents: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.includes(document.id) ? [document] : [] },
  } as unknown as Prisma.TransactionClient;
  const read = () => readAgeExceptionRecord(tx, registration.id, id(2));
  async function submit() {
    const state = await read();
    events.push({ id: id(8), user_id: id(7), action: "PLAYER_AGE_EXCEPTION_REQUESTED", reason: "Petición", new_data: {
      version: 1, binding: state.binding, documentId: document.id, fileId: document.file_id, requestHash: "b".repeat(64),
    } });
    return read();
  }
  async function decide(decision: "APPROVE" | "REJECT") {
    const state = await submit();
    events.push({ id: id(9), user_id: id(10), action: "PLAYER_AGE_EXCEPTION_DECIDED", reason: "Revisión", new_data: {
      requestId: id(8), binding: state.binding, documentId: document.id, fileId: document.file_id, decision, requestHash: "c".repeat(64),
    } });
    document.status = decision === "APPROVE" ? "VALIDATED" : "REJECTED";
    if (decision === "APPROVE") { registration.authorized_by = id(10); registration.age_exception_file_id = document.file_id; registration.age_exception_reason = "Revisión"; }
  }
  return { registration, category, document, events, read, submit, decide };
}
test("cargar la carta no aprueba edad; una petición pendiente tampoco habilita", async () => {
  const f = fixture(); assert.equal((await f.read()).status, "DRAFT");
  assert.equal((await f.submit()).status, "PENDING"); assert.equal((await f.read()).validApproval, false);
});
test("la aceptación exige acuse, archivo, identidad y política coincidentes", async () => {
  const f = fixture(); await f.decide("APPROVE");
  assert.equal((await f.read()).validApproval, true); assert.equal(f.registration.status, "INELIGIBLE");
  f.registration.age_exception_file_id = id(99); assert.equal((await f.read()).validApproval, false);
});
test("cambio de identidad, política o carta retira la vigencia de la aceptación", async () => {
  for (const change of ["identity", "policy", "file"]) {
    const f = fixture(); await f.decide("APPROVE");
    if (change === "identity") f.registration.people.identity_version++;
    if (change === "policy") f.category.player_policy.registrationDays = [4];
    if (change === "file") f.document.files.sha256 = "d".repeat(64);
    const state = await f.read(); assert.equal(state.validApproval, false); assert.equal(state.status, "STALE");
  }
});
test("rechazo conserva la petición y ninguna autorización", async () => {
  const f = fixture(); await f.decide("REJECT");
  const state = await f.read(); assert.equal(state.status, "REJECTED"); assert.equal(state.validApproval, false);
  assert.equal(state.request?.reason, "Petición"); assert.equal(f.registration.authorized_by, null);
});
test("campos históricos o un documento de tutor no se convierten en excepción aprobada", async () => {
  const f = fixture(); f.events.splice(0); f.registration.authorized_by = id(10); f.registration.age_exception_file_id = id(4);
  const state = await f.read(); assert.equal(state.validApproval, false); assert.equal(state.status, "NOT_REQUIRED");
});
