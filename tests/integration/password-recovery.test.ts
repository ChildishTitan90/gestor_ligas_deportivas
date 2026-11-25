import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { completePasswordRecovery, requestPasswordRecovery } from "../../src/server/auth/password-recovery";
import { hashPassword, verifyPassword } from "../../src/server/auth/password";
import { getPrisma } from "../../src/server/db/prisma";
import type { AccountEmail } from "../../src/server/email/transport";

const admin = new URL(process.env.RECOVERY_TEST_ADMIN_URL ?? "");
const runtime = new URL(process.env.DATABASE_URL ?? "");
assert.equal(process.env.AUTH_TEST_RUN, "1");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(admin.hostname));
assert.match(admin.pathname, /^\/pdgld48_test_[a-f0-9]{16}$/);
assert.equal(runtime.host, admin.host);
assert.equal(runtime.pathname, admin.pathname);
assert.equal(runtime.username, "gestor_ligas_preview");

test("PDGLD-32: emisión privada, caducidad, consumo concurrente y revocación", async () => {
  const db = new pg.Client({ connectionString: admin.href });
  await db.connect();
  try {
    await db.query(`ALTER ROLE gestor_ligas_preview IN DATABASE "${admin.pathname.slice(1)}" SET timezone TO 'America/Mexico_City'`);
    const email = `${randomUUID()}@example.test`;
    const original = "Original!Synthetic123";
    const replacement = "Replacement!Synthetic456";
    const person = (await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Fixture','Recuperación') RETURNING id")).rows[0].id;
    const id = (await db.query(
      "INSERT INTO sports_management.users(person_id,username,email,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now()) RETURNING id",
      [person, randomUUID(), email, await hashPassword(original)],
    )).rows[0].id;
    await db.query("INSERT INTO sports_management.sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 hour')", [id, randomUUID()]);
    const sent: AccountEmail[] = [];
    const transport = { async send(message: AccountEmail) { sent.push(message); return "ACCEPTED" as const; } };
    const policy = { ttlMs: 900_000, maxPerHour: 2 };
    const snapshot = async () => (await db.query(
      "SELECT password_hash, version, (SELECT revoked_at FROM sports_management.sessions WHERE user_id=$1) AS revoked_at FROM sports_management.users WHERE id=$1", [id],
    )).rows[0];
    const initial = await snapshot();
    await requestPasswordRecovery("unknown@example.test", transport, policy);
    assert.equal(sent.length, 0);
    await Promise.all([requestPasswordRecovery(email, transport, policy), requestPasswordRecovery(email, transport, policy)]);
    assert.equal(sent.length, 1);
    const first = sent[0];
    assert.ok(first.kind === "PASSWORD_RECOVERY");
    assert.equal(first.to, email);
    const row = (await db.query("SELECT token_hash, expires_at FROM sports_management.password_resets WHERE id=$1", [first.idempotencyKey])).rows[0];
    assert.match(row.token_hash, /^[a-f0-9]{64}$/);
    assert.notEqual(row.token_hash, first.token);
    assert.equal(row.expires_at.toISOString(), first.expiresAt.toISOString());
    await db.query("UPDATE sports_management.password_resets SET created_at=now()-interval '2 minutes', expires_at=now()-interval '1 minute' WHERE id=$1", [first.idempotencyKey]);
    assert.equal(await completePasswordRecovery(first.token, replacement), false);
    assert.deepEqual(await snapshot(), initial);

    await requestPasswordRecovery(email, transport, policy);
    assert.equal(sent.length, 2);
    const second = sent[1];
    assert.ok(second.kind === "PASSWORD_RECOVERY");
    const failureName = `pdgld32_fail_${randomUUID().replaceAll("-", "")}`;
    await db.query(`CREATE FUNCTION public.${failureName}() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'SYNTHETIC_RECOVERY_ROLLBACK'; END $$`);
    try {
      await db.query(`CREATE TRIGGER ${failureName} BEFORE INSERT ON sports_management.authentication_events
        FOR EACH ROW WHEN (NEW.user_id='${id}'::uuid AND NEW.action='PASSWORD_CHANGED')
        EXECUTE FUNCTION public.${failureName}()`);
      await assert.rejects(completePasswordRecovery(second.token, replacement));
      assert.deepEqual(await snapshot(), initial, "Fallo de auditoría revierte contraseña, versión y revocación");
      assert.equal((await db.query("SELECT used_at FROM sports_management.password_resets WHERE id=$1", [second.idempotencyKey])).rows[0].used_at, null,
        "El token permanece disponible después del rollback");
    } finally {
      await db.query(`DROP TRIGGER IF EXISTS ${failureName} ON sports_management.authentication_events`);
      await db.query(`DROP FUNCTION public.${failureName}()`);
    }
    assert.equal(await completePasswordRecovery("x".repeat(43), replacement), false, "Un token manipulado no cambia la cuenta");
    assert.deepEqual(await snapshot(), initial);
    const outcomes = await Promise.all([completePasswordRecovery(second.token, replacement), completePasswordRecovery(second.token, replacement)]);
    assert.deepEqual(outcomes.sort(), [false, true]);
    assert.equal(await completePasswordRecovery(second.token, original), false);
    const updated = await snapshot();
    assert.equal(await verifyPassword(updated.password_hash, original), false);
    assert.equal(await verifyPassword(updated.password_hash, replacement), true);
    assert.equal(updated.version, initial.version + 1);
    assert.ok(updated.revoked_at instanceof Date);
    const audit = await db.query("SELECT action FROM sports_management.authentication_events WHERE user_id=$1 AND action='PASSWORD_CHANGED'", [id]);
    assert.equal(audit.rowCount, 1);
    await requestPasswordRecovery(email, transport, policy);
    assert.equal(sent.length, 2, "respeta el límite incluso después de consumir");
  } finally {
    await getPrisma().$disconnect();
    await db.end();
  }
});


test("PDGLD-32: rechazo confirmado permite nueva solicitud; incertidumbre conserva enlace y privacidad", async () => {
  const db = new pg.Client({ connectionString: admin.href });
  await db.connect();
  try {
    const email = `${randomUUID()}@example.test`;
    const person = (await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Fixture','Reintento') RETURNING id")).rows[0].id;
    const id = (await db.query(
      "INSERT INTO sports_management.users(person_id,username,email,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now()) RETURNING id",
      [person, randomUUID(), email, await hashPassword("Original!Synthetic123")],
    )).rows[0].id;
    const sent: AccountEmail[] = [];
    let outcome: "FAILED" | "ACCEPTED" | "UNKNOWN" = "FAILED";
    const transport = { async send(message: AccountEmail) { sent.push(message); return outcome; } };
    const policy = { ttlMs: 900_000, maxPerHour: 3 };
    const unknown = await requestPasswordRecovery("unknown@example.test", transport, policy);
    assert.equal(sent.length, 0);
    const rejected = await requestPasswordRecovery(email, transport, policy);
    assert.equal(rejected, unknown, "no revela existencia ni resultado de entrega");
    const first = sent[0];
    assert.ok(first.kind === "PASSWORD_RECOVERY");
    const failed = (await db.query("SELECT used_at, expires_at FROM sports_management.password_resets WHERE id=$1", [first.idempotencyKey])).rows[0];
    assert.ok(failed.used_at instanceof Date);
    assert.ok(failed.expires_at > new Date(), "no espera a que venza para liberar la solicitud");
    assert.equal(await completePasswordRecovery(first.token, "Rejected!Synthetic456"), false);

    outcome = "ACCEPTED";
    const retry = await requestPasswordRecovery(email, transport, policy);
    assert.equal(retry, unknown);
    assert.equal(sent.length, 2, "nueva solicitud sí contacta al proveedor");
    const second = sent[1];
    assert.ok(second.kind === "PASSWORD_RECOVERY");
    assert.notEqual(second.token, first.token);
    assert.equal(await completePasswordRecovery(second.token, "Replacement!Synthetic456"), true);

    outcome = "UNKNOWN";
    await requestPasswordRecovery(email, transport, policy);
    const uncertain = sent[2];
    assert.ok(uncertain.kind === "PASSWORD_RECOVERY");
    await requestPasswordRecovery(email, transport, policy);
    assert.equal(sent.length, 3, "no reenvía ante una entrega incierta");
    assert.equal(await completePasswordRecovery(uncertain.token, "Uncertain!Synthetic789"), true);
    await requestPasswordRecovery(email, transport, policy);
    assert.equal(sent.length, 3, "el rechazo sigue contando para el límite por hora");
    const count = await db.query("SELECT count(*)::int AS total FROM sports_management.password_resets WHERE user_id=$1", [id]);
    assert.equal(count.rows[0].total, 3);
  } finally {
    await getPrisma().$disconnect();
    await db.end();
  }
});

test("PDGLD-32: cuotas públicas compartidas, concurrencia y contrato sin enumeración", async () => {
  const {consumeRecoveryBudget}=await import("../../src/server/auth/recovery-abuse");
  const {recoveryPolicy}=await import("../../src/server/auth/password-recovery");
  const {handleRecoveryRequest,handleRecoveryCompletion}=await import("../../src/server/auth/recovery-handlers");
  const db=new pg.Client({connectionString:admin.href});await db.connect();
  try {
    const env={...process.env,PASSWORD_RECOVERY_ENABLED:"true",PASSWORD_RECOVERY_TTL_MINUTES:"15",PASSWORD_RECOVERY_MAX_PER_HOUR:"2",
      PASSWORD_RECOVERY_RATE_WINDOW_SECONDS:"60",PASSWORD_RECOVERY_REQUESTS_PER_IP:"3",PASSWORD_RECOVERY_COMPLETIONS_PER_IP:"3",
      PASSWORD_RECOVERY_REQUESTS_GLOBAL:"30",PASSWORD_RECOVERY_COMPLETIONS_GLOBAL:"30",PASSWORD_RECOVERY_CLIENT_IP_MODE:"local",
      NODE_ENV:"development",PASSWORD_RECOVERY_RATE_SECRET:"synthetic-public-budget-secret-not-for-production"};
    const policy=recoveryPolicy(env);assert.ok(policy);
    const clear=()=>db.query("DELETE FROM sports_management.password_recovery_budgets");
    await clear();
    const races=await Promise.all(Array.from({length:12},()=>consumeRecoveryBudget("request","synthetic-client","unknown@example.test",policy.abuse,2)));
    assert.equal(races.filter(Boolean).length,2,"Límite compartido y atómico aun con llamadas concurrentes");
    assert.equal(await consumeRecoveryBudget("request","another-client","unknown@example.test",policy.abuse,2),false,"Cambiar IP no evita la cuota por destinatario");
    await clear();
    const global={...policy.abuse,requestGlobal:4,requestIp:3};
    const distributed=await Promise.all(Array.from({length:10},(_,i)=>consumeRecoveryBudget("request",`client-${i}`,`unknown-${i}@example.test`,global,2)));
    assert.equal(distributed.filter(Boolean).length,4,"El presupuesto global limita identidades y orígenes rotatorios");
    assert.ok((await db.query("SELECT count(*)::int AS n FROM sports_management.password_recovery_budgets")).rows[0].n<=9,"No se crean claves adicionales tras agotar el presupuesto global");
    await clear();
    await db.query("INSERT INTO sports_management.password_recovery_budgets VALUES($1,now()-interval '3 hours',1)",["a".repeat(64)]);
    assert.equal(await consumeRecoveryBudget("request","cleaner","cleaner@example.test",policy.abuse,2),true);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.password_recovery_budgets WHERE bucket_key=$1",["a".repeat(64)])).rows[0].n,0);
    await clear();
    const person=(await db.query("INSERT INTO sports_management.people(first_name,paternal_surname) VALUES('Fixture','Público') RETURNING id")).rows[0].id;
    const email=`${randomUUID()}@example.test`,original="Public!Synthetic123",replacement="Public!Replacement456";
    const id=(await db.query("INSERT INTO sports_management.users(person_id,username,email,password_hash,email_verified_at) VALUES($1,$2,$3,$4,now()) RETURNING id",[person,randomUUID(),email,await hashPassword(original)])).rows[0].id;
    const sent:AccountEmail[]=[],jobs:Array<()=>Promise<void>>=[];
    const transport={async send(message:AccountEmail){sent.push(message);return "ACCEPTED" as const;}};
    const origin=new URL(process.env.NEXTAUTH_URL!).origin;
    const request=(body:unknown,headers:Record<string,string>={})=>new Request(`${origin}/api/auth/recovery/request`,{method:"POST",headers:{origin,"content-type":"application/json",...headers},body:JSON.stringify(body)});
    const settings={policy,transport};
    const unknown=await handleRecoveryRequest(request({email:"public-unknown@example.test"}),w=>jobs.push(w),settings);
    const known=await handleRecoveryRequest(request({email}),w=>jobs.push(w),settings);
    assert.equal(unknown.status,202);assert.equal(known.status,202);
    assert.equal(await unknown.text(),await known.text());assert.equal(known.headers.get("cache-control"),"no-store");
    assert.equal(sent.length,0,"La respuesta precede a la consulta y al envío");
    for(const job of jobs)await job();assert.equal(sent.length,1);assert.equal(sent[0].to,email);
    const queued=jobs.length;
    await handleRecoveryRequest(request({email:"third@example.test"}),w=>jobs.push(w),settings);
    const limited=await handleRecoveryRequest(request({email},{"x-forwarded-for":"8.8.8.8","x-vercel-forwarded-for":"9.9.9.9"}),w=>jobs.push(w),settings);
    assert.equal(limited.status,202);assert.equal((await limited.json()).code,"REQUEST_RECEIVED");
    assert.equal(jobs.length,queued+1,"Cambiar cabeceras en local no programa trabajo extra cuando se agota la cuota");
    assert.equal((await handleRecoveryRequest(request({email},{origin:"https://cross-site.example.test"}),w=>jobs.push(w),settings)).status,400);
    await clear();
    const message=sent[0];assert.equal(message.kind,"PASSWORD_RECOVERY");
    if(message.kind!=="PASSWORD_RECOVERY")throw Error("INVALID_FIXTURE");
    const completion=(token:string)=>request({token,newPassword:replacement,confirmPassword:replacement});
    for(let n=0;n<3;n++)assert.equal((await handleRecoveryCompletion(completion("z".repeat(43)),policy)).status,400);
    assert.equal((await handleRecoveryCompletion(completion(message.token),policy)).status,429);
    assert.equal(await verifyPassword((await db.query("SELECT password_hash FROM sports_management.users WHERE id=$1",[id])).rows[0].password_hash,original),true);
    await clear();
    assert.equal((await handleRecoveryCompletion(completion(message.token),policy)).status,200);
    assert.equal((await handleRecoveryCompletion(completion(message.token),policy)).status,400);
    assert.equal(await verifyPassword((await db.query("SELECT password_hash FROM sports_management.users WHERE id=$1",[id])).rows[0].password_hash,replacement),true);
    const snapshot=(await db.query("SELECT bucket_key,hits FROM sports_management.password_recovery_budgets")).rows;
    assert.ok(snapshot.every(r=>/^[a-f0-9]{64}$/.test(r.bucket_key)));
    assert.ok(!JSON.stringify(snapshot).includes(email));assert.ok(!JSON.stringify(snapshot).includes(message.token));
  } finally {await getPrisma().$disconnect();await db.end();}
});
