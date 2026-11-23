import Link from "next/link";

export function AuditJourney({ detail=false, back="/audit" }: { detail?: boolean; back?: string }) {
  return <nav aria-label="Recorrido de la bitácora" className="py-2">
    <ol className="flex max-w-xl items-center gap-3 text-sm">
      <li aria-current={detail?undefined:"step"} className={`flex items-center gap-2 ${detail?"text-muted":"font-semibold"}`}>
        <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border ${detail?"":"bg-action text-on-action"}`}>1</span>
        {detail?<Link className="rounded underline underline-offset-4" href={back}>Consultar operaciones</Link>:"Consultar operaciones"}
      </li>
      <li aria-hidden className="h-px min-w-4 flex-1 bg-border" />
      <li aria-current={detail?"step":undefined} className={`flex items-center gap-2 ${detail?"font-semibold":"text-muted"}`}>
        <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border ${detail?"bg-action text-on-action":""}`}>2</span>
        Detalle
      </li>
    </ol>
  </nav>;
}
