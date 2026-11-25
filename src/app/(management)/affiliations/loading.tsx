export default function AffiliationLoading() {
  return <section aria-busy="true" className="mx-auto max-w-5xl space-y-4">
    <p role="status" className="text-sm text-muted">Cargando afiliaciones…</p>
    <div aria-hidden="true" className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <div className="h-6 w-2/5 rounded bg-soft" />
      <div className="h-12 rounded-lg bg-soft" />
      <div className="h-24 rounded-lg bg-soft" />
    </div>
  </section>;
}
