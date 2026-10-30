import assert from 'node:assert/strict';

/** Test-only SQL clock: real authorization queries still execute in PostgreSQL.
 * Keeps bind parameters intact; does not alter production code or database functions.
 */
export function authorizationAt(transaction, instant) {
  assert.match(instant, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
  let statements = 0;
  const tx = new Proxy(transaction, {
    get(target, key) {
      if (key === '$queryRaw') return (strings, ...values) => {
        assert.ok(Array.isArray(strings) && Array.isArray(strings.raw), 'Expected a parameterized SQL template');
        const replace = text => text.replaceAll('clock_timestamp()', `TIMESTAMPTZ '${instant}'`);
        if (strings.some(text => text.includes('clock_timestamp()'))) statements++;
        const rewritten = Object.assign(strings.map(replace), { raw: strings.raw.map(replace) });
        return target.$queryRaw(rewritten, ...values);
      };
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { tx, clockStatements: () => statements };
}
