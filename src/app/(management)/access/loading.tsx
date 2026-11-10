export default function DashboardLoading() {
  return <div role="status" aria-busy="true" className="space-y-6">
    <p className="text-sm text-muted">Cargando tu panel…</p>
    <div aria-hidden="true" className="h-40 rounded-3xl border border-border bg-surface" />
    <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2">
      {[0, 1].map(item => <div key={item} className="h-44 rounded-2xl border border-border bg-surface" />)}
    </div>
  </div>;
}
