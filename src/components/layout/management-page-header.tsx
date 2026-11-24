import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export function ManagementPageHeader({ title, description, back, context = [] }: {
  title: string;
  description: string;
  back: { href: string; label: string };
  context?: readonly { label: string; value: string }[];
}) {
  return <header className="space-y-3">
    <nav aria-label="Volver en gestión">
      <Link href={back.href} className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold text-primary underline-offset-4 hover:underline">
        <ChevronLeft aria-hidden="true" size={18} />{back.label}
      </Link>
    </nav>
    <h1 className="text-balance text-2xl font-semibold tracking-tight text-primary sm:text-3xl">{title}</h1>
    <p className="max-w-2xl text-sm leading-6 text-muted">{description}</p>
    {context.length > 0 && <dl aria-label="Contexto de la página" className="grid gap-x-6 gap-y-2 border-y border-border py-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      {context.map(({ label, value }) => <div key={label} className="min-w-0">
        <dt className="text-xs text-muted">{label}</dt><dd className="wrap-anywhere font-medium text-primary">{value}</dd>
      </div>)}
    </dl>}
  </header>;
}
