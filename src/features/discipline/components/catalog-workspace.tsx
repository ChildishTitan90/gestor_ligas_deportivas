"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FormDialog } from "@/components/ui/form-dialog";
import { ProcessSteps } from "@/components/ui/process-steps";
import { SelectField } from "@/components/ui/select-field";
import { articleSchema, consequences, consequenceLabel, type CatalogMutation, type ArticleInput } from "../contract";
import { saveCatalog } from "../actions";
import type { readCatalog } from "../server/catalog";

type Workspace = Awaited<ReturnType<typeof readCatalog>>;
type CatalogArticle = Workspace["articles"][number];
const ruleStatus: Record<string, string> = { DRAFT: "Borrador", APPROVED: "Aprobada" };
const versionSteps = ["Borrador", "Aprobada"];
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").trim();
const blank: ArticleInput = { number: "", description: "", configuration: { schemaVersion: 1, target: "PLAYER", consequence: { type: "MATCHES", quantity: 1 }, source: { origin: "SYNTHETIC", document: "Ejemplo de prueba", season: "", reference: "Ejemplo", confirmed: false } } };

function CatalogArticles({ articles, onEdit, disabled }: {
  articles: CatalogArticle[];
  onEdit?: (row: CatalogArticle) => void;
  disabled: boolean;
}) {
  const [search, setSearch] = useState("");
  const term = normalize(search);
  const visible = articles.filter(row => normalize(`${row.number} ${row.description}`).includes(term));
  return <section aria-labelledby="catalog-articles" className="space-y-4">
    <h2 id="catalog-articles" className="text-xl font-semibold text-primary">Artículos</h2>
    {!articles.length ? <p role="status" className="rounded-xl border border-border bg-surface p-4">Esta versión todavía no contiene artículos.</p> : <>
      <div className="max-w-sm">
        <label htmlFor="article-search" className="block text-sm font-medium">Buscar por código o descripción</label>
        <input id="article-search" type="search" value={search} maxLength={160} onChange={event => setSearch(event.target.value)}
          className="mt-1 min-h-12 w-full rounded-xl border border-border bg-surface px-3 py-2" />
      </div>
      {term && <p role="status" className="text-sm text-muted">{visible.length ? `${visible.length} de ${articles.length} artículos` : "No hay artículos que coincidan con la búsqueda."}</p>}
      {visible.length > 0 && <ul className="divide-y divide-border rounded-2xl border border-border bg-surface">
        {visible.map(row => {
          const parsed = articleSchema.safeParse({ number: row.number, description: row.description, configuration: row.parameters });
          const configuration = parsed.success ? parsed.data.configuration : null;
          return <li key={row.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="min-w-0 space-y-2">
              <h3 className="wrap-anywhere font-semibold text-primary">{row.number}</h3>
              <p className="wrap-anywhere">{row.description}</p>
              {configuration ? <p className="text-sm font-medium">{consequences[configuration.consequence.type]}
                {"quantity" in configuration.consequence || configuration.consequence.type === "FINE"
                  ? ` · ${consequenceLabel(configuration.consequence)}` : ""}</p>
                : <p className="text-sm font-medium">Formato anterior. Requiere revisión.</p>}
              <p className="text-sm text-muted">
                {configuration && <>{configuration.source.origin === "SYNTHETIC" ? "Ejemplo de prueba" : "Fuente documentada"} · </>}
                {row.referenced ? "Usado en un registro histórico" : "Sin referencias registradas"}
              </p>
            </div>
            {onEdit && !row.referenced && <button type="button" className="min-h-11 self-start rounded-xl border border-border px-4 text-sm font-semibold disabled:opacity-50"
              aria-label={`Editar artículo ${row.number}`} disabled={disabled} onClick={() => onEdit(row)}>Editar</button>}
          </li>;
        })}
      </ul>}
    </>}
  </section>;
}

export function CatalogWorkspace({ workspace }: { workspace: Workspace }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [editing, setEditing] = useState<{ id: string; revision: number } | null>(null);
  const [article, setArticle] = useState<ArticleInput>(blank);
  const [initialArticle, setInitialArticle] = useState<ArticleInput>(blank);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState<CatalogMutation | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const saving = useRef(false);
  const rule = workspace.rule;
  const field = "w-full rounded-xl border border-border bg-surface p-3";
  function updateSource(patch: Partial<ArticleInput["configuration"]["source"]>) { setArticle(a => ({ ...a, configuration: { ...a.configuration, source: { ...a.configuration.source, ...patch } } })); }
  function setType(type: keyof typeof consequences) {
    const consequence: ArticleInput["configuration"]["consequence"] = type === "FINE" ? { type, amount: "100.00", currency: "MXN" } : type === "TIME" ? { type, quantity: 1, unit: "DAYS" } : type === "MATCH_FORFEIT" || type === "TEAM_WITHDRAWAL" ? { type } : { type, quantity: 1 };
    setArticle(a => ({ ...a, configuration: { ...a.configuration, consequence, target: ["MATCH_FORFEIT", "POINTS_DEDUCTION", "TEAM_WITHDRAWAL"].includes(type) ? "TEAM" : a.configuration.target } }));
  }
  async function send(request: CatalogMutation) {
    if (saving.current) return;
    saving.current = true;
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
    finally { saving.current = false; setSending(false); }
  }
  function begin(row?: CatalogArticle) {
    if (saving.current || pending) return;
    const parsed = row && articleSchema.safeParse({ number: row.number, description: row.description, configuration: row.parameters });
    if (row && (!parsed || !parsed.success)) { setMessage("Este artículo usa un formato anterior; requiere revisión antes de editarse."); return; }
    const next = parsed && parsed.success ? parsed.data
      : { ...blank, configuration: { ...blank.configuration, source: { ...blank.configuration.source, season: workspace.season?.name ?? "" } } };
    setArticle(next); setInitialArticle(next);
    setEditing(row ? { id: row.id, revision: row.revision } : null); setReason(""); setMessage(""); setOpen(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault(); if (!rule || pending || sending) return;
    const parsed = articleSchema.safeParse(article);
    if (!parsed.success || !reason.trim()) { setMessage("Revisa los campos: el ejemplo debe usar DEMO-, tener valores positivos y un motivo."); return; }
    void send(editing ? { operation: "edit", operationId: crypto.randomUUID(), ruleId: rule.id, articleId: editing.id, expectedRevision: editing.revision, article: parsed.data, reason } : { operation: "create", operationId: crypto.randomUUID(), ruleId: rule.id, article: parsed.data, reason });
  }
  const c = article.configuration.consequence;
  const draft = rule?.status === "DRAFT";
  const approved = rule?.status === "APPROVED";
  const canEditArticles = workspace.canEdit && draft;
  return <div className="space-y-6">
    {rule ? <>
      <section aria-labelledby="catalog-version" className="space-y-4 rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <form method="get" className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="season" value={workspace.season?.id} />
          <div className="min-w-0 flex-1">
            <label htmlFor="catalog-rule" className="mb-1 block text-sm font-medium">Versión de convocatoria</label>
            <SelectField key={rule.id} id="catalog-rule" name="rule" defaultValue={rule.id}
              options={workspace.rules.map(r => ({ value: r.id, label: `Versión ${r.version_number} · ${ruleStatus[r.status] ?? r.status}` }))} />
          </div>
          <button className="min-h-12 rounded-xl border border-border px-5 font-semibold">Ver versión</button>
        </form>
        <h2 id="catalog-version" className="text-lg font-semibold text-primary">Versión {rule.version_number} · {ruleStatus[rule.status] ?? rule.status}</h2>
        {(draft || approved) && <ProcessSteps label="Etapas de la convocatoria" steps={versionSteps}
          current={approved ? 1 : 0} completedSteps={[approved, approved]} />}
        <p className="text-sm text-muted">{draft
          ? "Los artículos se guardan en borrador. La aprobación se realiza en la configuración de la temporada."
          : "Consulta los artículos de esta versión. Cada categoría usa el reglamento que tiene asociado."}</p>
        {workspace.canEdit && <div className="flex flex-wrap gap-3">
          {canEditArticles && <button className="primary-action min-h-12 rounded-xl px-5 font-semibold disabled:opacity-50"
            disabled={sending || !!pending} onClick={() => begin()}>Agregar artículo</button>}
          <button className="min-h-12 rounded-xl border border-border px-5 font-semibold disabled:opacity-50"
            disabled={sending || !!pending} onClick={() => { setReason(""); setMessage(""); setCloneOpen(true); }}>Crear nueva versión</button>
        </div>}
      </section>
      <div role="status" className="empty:sr-only">{!open && !cloneOpen && message}</div>
      {pending && !open && !cloneOpen && <button className="min-h-12 rounded-xl border border-border px-5"
        disabled={sending} onClick={() => void send(pending)}>Reintentar la misma solicitud</button>}
      <CatalogArticles key={rule.id} articles={workspace.articles} onEdit={canEditArticles ? begin : undefined} disabled={sending || !!pending} />
    </> : <p role="status">Esta temporada todavía no tiene convocatoria. Puedes consultar su configuración para crear la primera versión.</p>}
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
    <FormDialog open={open} title={editing ? "Editar artículo" : "Agregar artículo"} description="Los cambios permanecen en borrador hasta que la administración apruebe la convocatoria."
      dirty={!!reason || JSON.stringify(article) !== JSON.stringify(initialArticle)} pending={sending} uncertain={!!pending} onClose={() => setOpen(false)}><form onSubmit={submit} className="space-y-4"><p role="status">{message}</p><label className="block">Código<input className={field} required value={article.number} disabled={!!pending} onChange={e => setArticle({ ...article, number: e.target.value })} /></label><label className="block">Descripción<textarea className={field} required value={article.description} disabled={!!pending} onChange={e => setArticle({ ...article, description: e.target.value })} /></label><label className="block">Consecuencia</label><SelectField aria-label="Consecuencia" value={c.type} disabled={!!pending} options={Object.entries(consequences).map(([value,label]) => ({ value, label }))} onValueChange={v => setType(v as keyof typeof consequences)} />
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
