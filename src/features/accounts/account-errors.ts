export class AccountInputError extends Error {
  constructor(
    public readonly code: "VALIDATION_ERROR" | "INVALID_CONTEXT" | "PERSON_UNAVAILABLE" | "DUPLICATE_ACCOUNT" |
      "DELEGATE_POSITION_REQUIRED" | "INVALID_DELEGATE_POSITION" | "DELEGATE_POSITION_OCCUPIED" |
      "DELEGATE_ACCOUNT_OVERLAP" | "DELEGATE_LEGACY_OVERLAP",
    public readonly status: number = 400,
  ) { super(code); }
}

const constraints = {
  user_roles_delegate_position_overlap: ["23P01", "DELEGATE_POSITION_OCCUPIED", 409],
  user_roles_delegate_account_overlap: ["23P01", "DELEGATE_ACCOUNT_OVERLAP", 409],
  user_roles_delegate_legacy_overlap: ["23P01", "DELEGATE_LEGACY_OVERLAP", 409],
  user_roles_delegate_position_required: ["23514", "DELEGATE_POSITION_REQUIRED", 400],
  user_roles_delegate_position_value: ["23514", "INVALID_DELEGATE_POSITION", 400],
  user_roles_delegate_position_scope: ["23514", "INVALID_CONTEXT", 400],
  user_roles_delegate_role: ["23514", "INVALID_DELEGATE_POSITION", 400],
} as const;

/** pg, Prisma raw-query metadata and Prisma 7 adapter causes; never expose SQL/details. */
export function accountDatabaseError(error: unknown): AccountInputError | undefined {
  const pending: unknown[] = [error];
  const seen = new Set<object>();
  while (pending.length && seen.size < 16) {
    const value = pending.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const node = value as Record<string, unknown>;
    const code = node.originalCode ?? node.code;
    const message = node.originalMessage ?? node.message;
    for (const [name, [state, domain, status]] of Object.entries(constraints)) {
      // adapter-pg retains SQLSTATE/message but discards the pg constraint field
      // for these SQLSTATEs. Accept only an exact server identifier, not details.
      const named = node.constraint === name || (typeof message === "string" &&
        (message === name || message.includes(`"${name}"`)));
      if (code === state && named) return new AccountInputError(domain, status);
    }
    pending.push(node.meta, node.cause, node.driverAdapterError);
  }
}
