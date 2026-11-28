export default function LoadingCharges() {
  return <div className="mx-auto max-w-6xl space-y-5" role="status">
    <p className="font-semibold text-primary">Cargando tesorería…</p>
    <div aria-hidden="true" className="h-20 rounded-2xl border border-border bg-surface motion-safe:animate-pulse" />
    <div aria-hidden="true" className="h-40 rounded-2xl border border-border bg-surface motion-safe:animate-pulse" />
  </div>;
}
