import { ArrowRight, ClipboardPenLine, FlaskConical } from "lucide-react";
import { ActionLink } from "@/components/ui/action-link";
import { REPORT_DEMO_MATCH_ID, REPORT_DEMO_PATH, reportDemoCases } from "../demo-data";

export function ReportDemoList() {
  return <section className="mx-auto max-w-6xl space-y-7">
    <header className="space-y-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-muted"><FlaskConical size={18} aria-hidden="true" /> PDGLD-148 · Demostración local</p>
      <h1 className="text-3xl font-semibold tracking-tight text-primary">Cédula arbitral</h1>
      <p className="max-w-2xl text-muted">Del partido al cierre: revisa las alineaciones, registra lo ocurrido y reúne las firmas de los capitanes.</p>
    </header>
    <aside className="rounded-2xl border border-accent bg-surface p-5 text-sm leading-6">
      <strong>Datos y autorización de partido sintéticos.</strong> La sesión de la app sigue siendo obligatoria. Esta demostración solo existe en desarrollo.
      La captura vive en memoria mientras permanezcas en la página: no guarda en la base ni en el dispositivo y se pierde al recargar o salir.
    </aside>
    <article className="rounded-3xl border border-border bg-surface p-5 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted"><span>DEMO-018 · Jornada 7</span><span className="rounded-full border border-border px-3 py-1">Designación aprobada · Simulada</span></div>
      <div className="my-7 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-center">
        <div><span className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-soft font-bold text-primary">DE</span><h2 className="font-semibold text-primary sm:text-xl">Deportivo Encinos</h2><p className="text-sm text-muted">Local</p></div>
        <span className="text-sm font-semibold text-muted">vs.</span>
        <div><span className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl border border-accent font-bold text-primary">AC</span><h2 className="font-semibold text-primary sm:text-xl">Atlético Cantera</h2><p className="text-sm text-muted">Visitante</p></div>
      </div>
      <p className="mb-5 text-center text-sm text-muted">Apertura 2026 · Primera libre · Grupo A · 15 nov, 16:00 h (Morelia)</p>
      <ActionLink className="w-full sm:w-auto" href={`${REPORT_DEMO_PATH}/${REPORT_DEMO_MATCH_ID}`}><ClipboardPenLine size={19} aria-hidden="true" /> Abrir partido de demostración <ArrowRight size={18} aria-hidden="true" /></ActionLink>
    </article>
    <div><h2 className="mb-4 text-xl font-semibold text-primary">Casos para revisar</h2><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {reportDemoCases.map(item => <article key={item.value} className="flex flex-col rounded-2xl border border-border bg-surface p-5"><h3 className="font-semibold text-primary">{item.label}</h3><p className="mt-2 mb-4 flex-1 text-sm leading-6 text-muted">{item.description}</p><ActionLink variant="secondary" href={`${REPORT_DEMO_PATH}/${REPORT_DEMO_MATCH_ID}?case=${item.value}`}>Revisar caso <ArrowRight size={16} aria-hidden="true" /></ActionLink></article>)}
    </div></div>
  </section>;
}
