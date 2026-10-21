import type { AccountPresentation } from "../types";

export function AccountIdentity({ account }: { account: AccountPresentation }) {
  return <div className="flex min-w-0 max-w-md items-start gap-3 text-sm">
    <span aria-hidden="true" className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-soft font-semibold text-primary">
      {account.initials}
    </span>
    <div className="min-w-0 wrap:anywhere">
      <p className="font-semibold text-primary">{account.name}</p>
      {account.username && <p className="text-muted">{`@${account.username}`}</p>}
      {account.assignments.length > 0 && <ul aria-label="Roles y ámbitos de la cuenta" className="mt-1 space-y-1 text-xs leading-5 text-muted">
        {account.assignments.map((assignment) => <li key={assignment}>{assignment}</li>)}
      </ul>}
    </div>
  </div>;
}
