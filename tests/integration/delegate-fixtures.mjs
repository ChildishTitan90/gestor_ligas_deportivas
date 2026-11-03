import assert from 'node:assert/strict';

/** Disposable fixtures only: exercise validity without rewriting effective history. */
export async function withDelegateValidity(db, userId, mode, work) {
  assert.ok(['expired', 'future'].includes(mode));
  const target = await db.query('SELECT current_database() AS name');
  assert.match(target.rows[0].name, /^pdgld48_test_[a-f0-9]{16}$/);
  const current = (await db.query(`SELECT ur.* FROM sports_management.user_roles ur
    JOIN sports_management.roles r ON r.id=ur.role_id
    WHERE ur.user_id=$1 AND r.code='CLUB_DELEGATE' AND ur.ends_at IS NULL`, [userId])).rows;
  assert.equal(current.length, 1);
  const row = current[0];
  const insert = `INSERT INTO sports_management.user_roles
    (user_id,role_id,league_id,club_id,delegate_position,starts_at,ends_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`;
  const values = [row.user_id, row.role_id, row.league_id, row.club_id, row.delegate_position];
  await db.query('BEGIN');
  let invalid;
  try {
    await db.query('UPDATE sports_management.user_roles SET ends_at=clock_timestamp() WHERE id=$1', [row.id]);
    const start = mode === 'future' ? new Date(Date.now() + 86_400_000) : new Date('2020-01-01T00:00:00Z');
    const end = mode === 'future' ? null : new Date('2020-02-01T00:00:00Z');
    invalid = (await db.query(insert, [...values, start, end])).rows[0].id;
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  try { await work(); }
  finally {
    await db.query('BEGIN');
    try {
      // A future designation has not taken effect and can be cancelled.
      if (mode === 'future') await db.query('DELETE FROM sports_management.user_roles WHERE id=$1', [invalid]);
      await db.query(insert, [...values, new Date(), null]);
      await db.query('COMMIT');
    } catch (error) { await db.query('ROLLBACK'); throw error; }
  }
}
