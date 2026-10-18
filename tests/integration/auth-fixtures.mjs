import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';

// Exclusivamente sintéticos. Se insertan en una base desechable del runner.
export const fixturePassword = 'Local-Demo-48!real-test';
export const paddedPassword = '  Clave local con espacios 48!  ';
export const fixtureEmails = {
  // Comprobar también cuentas almacenadas sin normalizar mayúsculas.
  operational: 'Operativa@Example.Test',
  temporary: 'temporal@example.test',
  inactive: 'inactiva@example.test',
  locked: 'bloqueada@example.test',
  unknownHash: 'legado@example.test',
  corruptHash: 'corrupta@example.test',
  padded: 'espacios@example.test',
  underscore: 'delegado_48@example.test',
  concurrent: 'concurrente@example.test',
  passwordChange: 'cambio@example.test',
  idle: 'inactividad@example.test',
};

export async function createAuthFixtures(client) {
  const options = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 };
  const passwordHash = await argon2.hash(fixturePassword, options);
  const paddedHash = await argon2.hash(paddedPassword, options);
  const fixtures = {};
  for (const [kind, email] of Object.entries(fixtureEmails)) {
    const personId = randomUUID();
    const id = randomUUID();
    let hash = kind === 'padded' ? paddedHash : passwordHash;
    if (kind === 'unknownHash') hash = 'synthetic-unsupported-format';
    if (kind === 'corruptHash') hash = '$argon2id$synthetic-corrupt-hash';
    await client.query(
      'INSERT INTO sports_management.people (id, first_name, paternal_surname) VALUES ($1, $2, $3)',
      [personId, 'Persona sintética', 'Prueba'],
    );
    await client.query(`
      INSERT INTO sports_management.users
        (id, person_id, username, email, password_hash, is_active,
         must_change_password, locked_until, encrypted_mfa_secret)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [id, personId, `pdgld48_${kind}`, email, hash, kind !== 'inactive',
      ['temporary', 'passwordChange'].includes(kind), kind === 'locked' ? new Date(Date.now() + 15 * 60_000) : null,
      'synthetic-mfa-value']);
    fixtures[kind] = { id, email };
  }
  return fixtures;
}
