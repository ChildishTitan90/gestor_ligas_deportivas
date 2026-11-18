import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { listSavedScheduleProposals } from "../../src/features/scheduling/server/saved-proposals";
import { getPrisma } from "../../src/server/db/prisma";
import { generateScheduleForActor } from "../../src/features/scheduling/server/service";

test("Preview con RLS genera y recupera una propuesta con préstamos aprobados", async () => {
  const fixture = JSON.parse(process.env.SCHEDULING_PREVIEW_FIXTURE!);
  const db = getPrisma();
  try {
    const input = { seasonId: fixture.season, categoryId: fixture.category, groupId: fixture.group_id,
      operationId: randomUUID(), expectedSeasonVersion: 1, reason: "Prueba Preview sintetica" };
    await assert.rejects(generateScheduleForActor(fixture.outsider, input), { message: "FORBIDDEN" });
    const first = await generateScheduleForActor(fixture.actor, input);
    assert.ok(first.ok);
    if (first.ok) assert.equal((first.proposal as { matches: unknown[] }).matches.length, 190);
    const saved = await listSavedScheduleProposals(fixture.actor, fixture.season, fixture.group_id);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].id, input.operationId);
    await assert.rejects(listSavedScheduleProposals(fixture.outsider, fixture.season, fixture.group_id), { message: "FORBIDDEN" });
    const retry = await generateScheduleForActor(fixture.actor, input);
    assert.ok(retry.ok && retry.replayed);
  } finally {
    await db.$disconnect();
  }
});
