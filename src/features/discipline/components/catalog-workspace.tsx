"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { SelectField } from "@/components/ui/select-field";
import { articleSchema, consequences, consequenceLabel, type CatalogMutation, type ArticleInput } from "../contract";
import { saveCatalog } from "../actions";
import type { readCatalog } from "../server/catalog";

type Workspace = Awaited<ReturnType<typeof readCatalog>>;
const blank: ArticleInput = { number: "", description: "", configuration: { schemaVersion: 1, target: "PLAYER", consequence: { type: "MATCHES", quantity: 1 }, source: { origin: "SYNTHETIC", document: "Ejemplo de prueba", season: "", reference: "Ejemplo", confirmed: false } } };
export function CatalogWorkspace({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; revision: number } | null>(null);
  const [article, setArticle] = useState<ArticleInput>(blank);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<CatalogMutation | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const rule = workspace.rule;
  const field = "w-full rounded-xl border border-border bg-surface p-3";
  function updateSource(patch: Partial<ArticleInput["configuration"]["source"]>) { setArticle(a => ({ ...a, configuration: { ...a.configuration, source: { ...a.configuration.source, ...patch } } })); }
  function setType(type: keyof typeof consequences) {
    const consequence: ArticleInput["configuration"]["consequence"] = type === "FINE" ? { type, amount: "100.00", currency: "MXN" } : type === "TIME" ? { type, quantity: 1, unit: "DAYS" } : type === "MATCH_FORFEIT" || type === "TEAM_WITHDRAWAL" ? { type } : { type, quantity: 1 };
    setArticle(a => ({ ...a, configuration: { ...a.configuration, consequence, target: ["MATCH_FORFEIT", "POINTS_DEDUCTION", "TEAM_WITHDRAWAL"].includes(type) ? "TEAM" : a.configuration.target } }));
  }
  async function send(request: CatalogMutation) {
    if (sending) return;
    setSending(true); setMessage("");
    try {
      const result = await saveCatalog(request);
      if (result.ok) { setPending(null); setOpen(false); setCloneOpen(false); setMessage("Cambio guardado."); router.push(`/discipline/catalog?season=${result.seasonId}&rule=${result.ruleId}`); router.refresh(); }
      else if (result.code === "UNCERTAIN") { setPending(request); setMessage("No se confirmó el resultado. Puedes reintentar la misma solicitud."); }
      else if (result.code === "DUPLICATE_ARTICLE_NUMBER") {
        setPending(null);
        setMessage("Ya existe un artículo con ese código en esta versión. Escribe otro código.");
      }
      else { setPending(null); setMessage(result.code === "STALE" ? "El artículo cambió. Actualiza la consulta antes de editar." : "No se pudo guardar. Verifica los datos, permisos y versión."); }
    } catch { setPending(request); setMessage("No se confirmó el resultado. Puedes reintentar la misma solicitud."); }
    finally { setSending(false); }
  }
  function begin(row?: Workspace["articles"][number]) {
    const parsed = row && articleSchema.safeParse({ number: row.number, description: row.description, configuration: row.parameters });
    if (row && (!parsed || !parsed.success)) { setMessage("Este artículo usa un formato anterior; requiere revisión antes de editarse."); return; }
    setArticle(parsed && parsed.success ? parsed.data : { ...blank, configuration: { ...blank.configuration, source: { ...blank.configuration.source, season: workspace.season?.name ?? "" } } });
    setEditing(row ? { id: row.id, revision: row.revision } : null); setReason(""); setMessage(""); setOpen(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault(); if (!rule || pending || sending) return;
    const parsed = articleSchema.safeParse(article);
    if (!parsed.success || !reason.trim()) { setMessage("Revisa los campos: el ejemplo debe usar DEMO-, tener valores positivos y un motivo."); return; }
    void send(editing ? { operation: "edit", operationId: crypto.randomUUID(), ruleId: rule.id, articleId: editing.id, expectedRevision: editing.revision, article: parsed.data, reason } : { operation: "create", operationId: crypto.randomUUID(), ruleId: rule.id, article: parsed.data, reason });
  }
  const c = article.configuration.consequence;
  return <div className="space-y-5"><form method="get" className="flex flex-wrap items-end gap-3"><input type="hidden" name="season" value={workspace.season?.id} /><div className="min-w-64 flex-1"><label htmlFor="catalog-rule" className="mb-2 block">Versión de convocatoria</label><SelectField key={rule?.id ?? workspace.season?.id} id="catalog-rule" name="rule" defaultValue={rule?.id ?? ""} options={workspace.rules.map(r => ({ value: r.id, label: `Versión ${r.version_number} · ${r.status === "DRAFT" ? "Borrador" : r.status === "APPROVED" ? "Aprobada" : r.status}` }))} /></div><button className="min-h-12 rounded-xl border border-border px-5">Ver versión</button></form>
    {!rule ? <p>No hay versiones de convocatoria para esta temporada. Primero configura una convocatoria.</p> : <><p>Versión {rule.version_number} · {rule.status === "DRAFT" ? "Borrador" : rule.status === "APPROVED" ? "Aprobada" : rule.status}. Guardar artículos no aprueba la convocatoria.</p>
    {workspace.canEdit && <div className="flex flex-wrap gap-3">{rule.status === "DRAFT" && <button className="primary-action min-h-12 rounded-xl px-5" onClick={() => begin()}>Agregar artículo</button>}<button className="min-h-12 rounded-xl border border-border px-5" disabled={sending || !!pending} onClick={() => { setReason(""); setMessage(""); setCloneOpen(true); }}>Crear nueva versión</button></div>}
    <p role="status">{!open && !cloneOpen && message}</p>{pending && !open && !cloneOpen && <button className="min-h-12 rounded-xl border border-border px-5" disabled={sending} onClick={() => void send(pending)}>Reintentar la misma solicitud</button>}
    {!workspace.articles.length ? <p>Esta versión todavía no contiene artículos.</p> : <div className="space-y-3">{workspace.articles.map(row => { const parsed = articleSchema.safeParse({ number: row.number, description: row.description, configuration: row.parameters }); return <article className="rounded-xl border border-border p-5" key={row.id}><h2 className="font-semibold">{row.number}</h2><p className="mt-2">{row.description}</p>{parsed.success ? <p className="mt-2">{consequences[parsed.data.configuration.consequence.type]} · {consequenceLabel(parsed.data.configuration.consequence)} · {parsed.data.configuration.source.origin === "SYNTHETIC" ? "Ejemplo de prueba" : "Fuente documentada"}</p> : <p>Formato anterior: requiere revisión.</p>}<p className="mt-2 text-sm">{row.referenced ? "Usado en un registro histórico" : "Sin referencias registradas"}</p>{workspace.canEdit && rule.status === "DRAFT" && !row.referenced && <button className="mt-3 min-h-12 rounded-xl border border-border px-4" onClick={() => begin(row)}>Editar</button>}</article>; })}</div>}</>}
    <FormDialog
      open={cloneOpen}
      title="Crear nueva versión"
      description="La nueva versión quedará como borrador. Puedes seguir consultando la versión de origen."
      dirty={!!reason.trim()}
      pending={sending}
      uncertain={!!pending}
      onClose={() => setCloneOpen(false)}
      footer={pending ? (
        <button type="button" className="primary-action min-h-12 rounded-xl px-5" disabled={sending} onClick={() => void send(pending)}>Reintentar la misma solicitud</button>
      ) : (
        <button type="submit" form="catalog-clone-form" className="primary-action min-h-12 rounded-xl px-5" disabled={sending || !reason.trim()}>Crear borrador</button>
      )}
    >
      <form id="catalog-clone-form" className="space-y-4" onSubmit={event => {
        event.preventDefault();
        if (rule && reason.trim() && !pending && !sending) {
          void send({ operation: "clone", ruleId: rule.id, operationId: crypto.randomUUID(), reason });
        }
      }}>
        <p role="status">{message}</p>
        <label className="block">Motivo del cambio
          <input className={field} required disabled={sending || !!pending} value={reason} onChange={event => setReason(event.target.value)} />
        </label>
      </form>
    </FormDialog>
    <FormDialog open={open} title={editing ? "Editar artículo" : "Agregar artículo"} description="Los cambios permanecen en borrador hasta que la administración apruebe la convocatoria." dirty pending={sending} uncertain={!!pending} onClose={() => setOpen(false)}><form onSubmit={submit} className="space-y-4"><p role="status">{message}</p><label className="block">Código<input className={field} required value={article.number} disabled={!!pending} onChange={e => setArticle({ ...article, number: e.target.value })} /></label><label className="block">Descripción<textarea className={field} required value={article.description} disabled={!!pending} onChange={e => setArticle({ ...article, description: e.target.value })} /></label><label className="block">Consecuencia</label><SelectField aria-label="Consecuencia" value={c.type} disabled={!!pending} options={Object.entries(consequences).map(([value,label]) => ({ value, label }))} onValueChange={v => setType(v as keyof typeof consequences)} />
    {"quantity" in c && <label className="block">Cantidad<input className={field} type="number" min="1" required value={c.quantity} disabled={!!pending} onChange={e => setArticle(a => ({ ...a, configuration: { ...a.configuration, consequence: { ...c, quantity: Number(e.target.value) } } }))} /></label>}
    {c.type === "TIME" && <><label>Unidad de tiempo</label><SelectField aria-label="Unidad de tiempo" value={c.unit} options={[{value:"DAYS",label:"Días"},{value:"MONTHS",label:"Meses"},{value:"YEARS",label:"Años"}]} disabled={!!pending} onValueChange={v => setArticle(a => ({ ...a, configuration: { ...a.configuration, consequence: { ...c, unit: v as "DAYS" | "MONTHS" | "YEARS" } } }))} /></>}
    {c.type === "FINE" && <label className="block">Importe MXN<input className={field} value={c.amount} disabled={!!pending} onChange={e => setArticle(a => ({ ...a, configuration: { ...a.configuration, consequence: { ...c, amount: e.target.value } } }))} /></label>}
    <label>Destinatario</label><SelectField aria-label="Destinatario" value={article.configuration.target} disabled={!!pending} options={[{value:"PLAYER",label:"Jugador"},{value:"TEAM",label:"Equipo"}]} onValueChange={v => setArticle(a => ({ ...a, configuration: { ...a.configuration, target: v as "PLAYER" | "TEAM" } }))} />
    <label>Origen</label><SelectField aria-label="Origen" value={article.configuration.source.origin} disabled={!!pending} options={[{value:"SYNTHETIC",label:"Ejemplo de prueba"},{value:"DOCUMENTED",label:"Fuente documentada"}]} onValueChange={v => updateSource({ origin: v as "SYNTHETIC" | "DOCUMENTED", confirmed: false })} />
    {([ ["document", "Documento o descripción de fuente"], ["season", "Temporada de la fuente"], ["reference", "Sección o referencia"] ] as const).map(([key,label]) => <label className="block" key={key}>{label}<input className={field} required disabled={!!pending} value={article.configuration.source[key]} onChange={e => updateSource({ [key]: e.target.value })} /></label>)}
    {article.configuration.source.origin === "DOCUMENTED" && <label className="block"><input type="checkbox" checked={article.configuration.source.confirmed} disabled={!!pending} onChange={e => updateSource({ confirmed: e.target.checked })} /> Fuente revisada; esto no aprueba la convocatoria.</label>}
    <label className="block">Motivo del cambio<input className={field} required value={reason} disabled={!!pending} onChange={e => setReason(e.target.value)} /></label>{pending ? <button type="button" className="primary-action min-h-12 rounded-xl px-5" disabled={sending} onClick={() => void send(pending)}>Reintentar la misma solicitud</button> : <button className="primary-action min-h-12 rounded-xl px-5" disabled={sending}>Guardar borrador</button>}</form></FormDialog>
  </div>;
}
