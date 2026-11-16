import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { createReportSignatureStorage } from "./signatures";

const local = { NODE_ENV: "development", DATABASE_URL: "postgresql://synthetic:synthetic@127.0.0.1:5433/gestor_ligas_dev", REPORT_SIGNATURE_LOCAL_DIRECTORY: resolve(".codex-attachments/profile-test") };
test("Storage privado local solo se habilita en Docker de desarrollo verificado", () => {
  assert.equal(typeof createReportSignatureStorage(local).put, "function");
  for (const change of [
    { NODE_ENV: "production" },
    { DATABASE_URL: "postgresql://synthetic:synthetic@db.example.test:5433/gestor_ligas_dev" },
    { DATABASE_URL: local.DATABASE_URL + "?host=db.example.test" },
    { DATABASE_URL: local.DATABASE_URL.replace("5433", "5432") },
    { DATABASE_URL: local.DATABASE_URL.replace("gestor_ligas_dev", "postgres") },
    { REPORT_SIGNATURE_LOCAL_DIRECTORY: resolve("public/signatures") },
  ]) assert.throws(() => createReportSignatureStorage({ ...local, ...change }), /STORAGE_UNAVAILABLE/);
});
