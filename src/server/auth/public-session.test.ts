import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { getAuthOptions } from "./options";

test("la sesión pública no incluye versión, sid ni campos privados del JWT", async () => {
  const previous = process.env.NEXTAUTH_SECRET;
  process.env.NEXTAUTH_SECRET = randomBytes(48).toString("base64url");
  try {
    const callback = getAuthOptions().callbacks!.session!;
    const id = randomUUID();
    const result = await callback({ session: { expires: new Date().toISOString() },
      token: { sub: id, userVersion: 123, sid: "synthetic-private-session", mustChangePassword: true, idleExpiresAt: Date.now() + 10000 },
    } as Parameters<typeof callback>[0]);
    assert.deepEqual(Object.keys(result.user!).sort(), ["id", "mustChangePassword"]);
    assert.equal(JSON.stringify(result).includes("userVersion"), false);
    assert.equal(JSON.stringify(result).includes("synthetic-private-session"), false);
  } finally {
    if (previous === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = previous;
  }
});
