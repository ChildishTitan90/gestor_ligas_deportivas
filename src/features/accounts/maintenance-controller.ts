import { administrativeResetSchema, type AdministrativeResetReceipt } from "./administrative-reset-contract";
import { accountIdentifiersSchema, accountStatusSchema } from "./maintenance-contract";
import { emailChangeRequestSchema, type EmailChangeResult } from "./email-change-contract";
import { MaintenanceClientError, maintenanceMessage, emailChangeMessage, type MaintenanceAccount, type MaintenanceDetail, type MaintenanceOperation } from "./maintenance-ui";

export type MaintenanceApi = {
  detail(id: string, editable: boolean, signal?: AbortSignal): Promise<MaintenanceDetail>;
  write(id: string, kind: MaintenanceOperation, payload: unknown): Promise<MaintenanceAccount | EmailChangeResult | AdministrativeResetReceipt>;
  emailStatus(id: string, key: string): Promise<EmailChangeResult>;
};
type Pending = { id: string; kind: MaintenanceOperation; payload: { expectedRevision: number; operationKey?: string } & Record<string, unknown> };
export function createMaintenanceController(api: MaintenanceApi, options: { actorId: string; canUpdate: boolean; uuid: () => string; online?: () => boolean; onSaved?: () => void }) {
  let state = { detail: null as MaintenanceDetail | null, targetId: "", visible: false, busy: false, error: "", notice: "",
    blocked: "" as "" | "UNAUTHENTICATED" | "PASSWORD_CHANGE_REQUIRED" | "FORBIDDEN", uncertain: false, reviewRequired: false,
    pending: null as Pending | null, email: null as EmailChangeResult | null };
  let live = true, generation = 0, reading: AbortController | undefined;
  const emails = new Map<string, { key: string; result?: EmailChangeResult }>();
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<typeof state>) => { if (live) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); } };
  function emailReceipt(email: EmailChangeResult) {
    return { email, reviewRequired: true, notice: emailChangeMessage(email),
      ...(email.status === "CONFIRMED" && state.detail ? { detail: { account: state.detail.account } } : {}) };
  }
  function failure(error: unknown) {
    const e = error instanceof MaintenanceClientError ? error : new MaintenanceClientError("NETWORK");
    if (["UNAUTHENTICATED", "PASSWORD_CHANGE_REQUIRED", "FORBIDDEN"].includes(e.code)) {
      emails.clear(); generation++; reading?.abort();
      publish({ detail: null, targetId: "", visible: false, pending: null, email: null, uncertain: false, busy: false,
        blocked: e.code as typeof state.blocked, error: maintenanceMessage(e.code) });
      return true;
    }
    publish({ error: maintenanceMessage(e.code) }); return false;
  }
  async function open(id: string) {
    if (!live || state.busy || state.blocked || state.uncertain) return;
    reading?.abort(); reading = new AbortController(); const version = ++generation;
    publish({ visible: true, targetId: id, detail: null, busy: true, error: "", notice: "", email: null, reviewRequired: false });
    try {
      const detail = await api.detail(id, options.canUpdate, reading.signal);
      if (!live || version !== generation) return;
      publish({ detail, email: emails.get(id)?.result ?? null });
    } catch (error) { if (version === generation) failure(error); }
    finally { if (version === generation) publish({ busy: false }); }
  }
  async function perform(pending: Pending) {
    const version = generation;
    publish({ pending, busy: true, error: "", uncertain: false });
    try {
      const result = await api.write(pending.id, pending.kind, pending.payload);
      if (!live || version !== generation) return;
      if (pending.kind === "email") {
        const email = result as EmailChangeResult;
        emails.set(pending.id, { key: pending.payload.operationKey!, result: email });
        publish({ ...emailReceipt(email), pending: null });
      } else if (pending.kind === "reset") {
        const receipt = result as AdministrativeResetReceipt;
        emails.delete(pending.id);
        publish({ pending: null, email: null, detail: state.detail ? { account: { ...state.detail.account, revision: receipt.revision } } : null, reviewRequired: true, notice: receipt.delivery === "ACCEPTED"
          ? "Acceso restablecido y sesiones revocadas. El transporte aceptó el mensaje; la recepción no está confirmada."
          : "Acceso restablecido y sesiones revocadas. La entrega no está confirmada. No se reenviará automáticamente." });
      } else if (pending.id === options.actorId) {
        emails.clear();
        publish({ detail: null, targetId: "", visible: false, pending: null, email: null, blocked: "UNAUTHENTICATED",
          notice: "Cambio guardado. Se revocaron tus sesiones anteriores; inicia sesión nuevamente.", error: "" });
      } else {
        publish({ detail: { account: result as MaintenanceAccount }, pending: null, reviewRequired: true,
          notice: "Cambio guardado. Se revocaron las sesiones anteriores de la cuenta. Consulta la versión actual antes de otra operación." });
      }
      try { options.onSaved?.(); } catch { /* A list refresh must never turn an acknowledged write into an uncertain one. */ }
    } catch (error) {
      if (!live || version !== generation || failure(error)) return;
      const e = error instanceof MaintenanceClientError ? error : new MaintenanceClientError("NETWORK");
      if (e.code !== "NOT_CONFIGURED" && (!e.status || e.status >= 500)) publish({ uncertain: true });
      else publish({ pending: null, reviewRequired: e.status === 409 });
    } finally { if (version === generation) publish({ busy: false }); }
  }
  return {
    getSnapshot: () => state,
    start() { live = true; publish({ busy: false, ...(state.pending ? { uncertain: true } : {}) }); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    open,
    close() { if (!state.busy) publish({ visible: false, ...(state.uncertain ? {} : { detail: null, targetId: "", email: null }) }); },
    reopen() { if (!state.blocked) publish({ visible: true }); },
    async submit(kind: MaintenanceOperation, input: { value?: string; reason: string; confirmed: boolean; identityVerified?: boolean; verificationMethod?: string }) {
      if (!live || state.busy || state.blocked || state.uncertain || state.reviewRequired || !state.detail || !options.canUpdate) return;
      if (options.online && !options.online()) { publish({ error: maintenanceMessage("OFFLINE") }); return; }
      const expectedRevision = state.detail.account.revision;
      const common = { expectedRevision, reason: input.reason, confirmed: input.confirmed };
      const parsed = kind === "email" ? emailChangeRequestSchema.safeParse({ ...common, email: input.value, operationKey: options.uuid() })
        : kind === "username" ? accountIdentifiersSchema.safeParse({ ...common, changes: { username: input.value } })
        : kind === "reset" ? administrativeResetSchema.safeParse({ ...common, identityVerified: input.identityVerified, verificationMethod: input.verificationMethod })
        : accountStatusSchema.safeParse({ ...common, isActive: !state.detail.account.isActive });
      if (!parsed.success) { publish({ error: maintenanceMessage("VALIDATION_ERROR") }); return; }
      const pending = { id: state.detail.account.id, kind, payload: parsed.data } as Pending;
      if (kind === "email") emails.set(pending.id, { key: pending.payload.operationKey! });
      await perform(pending);
    },
    async refresh() {
      if (!live || state.busy || state.blocked || !state.targetId) return;
      const id = state.targetId;
      if (!state.uncertain) { await open(id); return; }
      const version = generation;
      publish({ busy: true, error: "" });
      try {
        if (state.pending?.kind === "email") {
          const email = await api.emailStatus(id, state.pending.payload.operationKey!);
          if (!live || version !== generation) return;
          emails.set(id, { key: state.pending.payload.operationKey!, result: email });
          publish({ ...emailReceipt(email), pending: null, uncertain: false });
        } else {
          const detail = await api.detail(id, options.canUpdate);
          if (!live || version !== generation) return;
          publish({ detail, pending: null, uncertain: false, reviewRequired: true,
            notice: "Estado actual consultado. No acredita que el cambio anterior se haya aplicado. Revísalo y abre una nueva operación; no se reenvió la anterior." });
        }
      } catch (error) { if (live && version === generation) failure(error); }
      finally { if (version === generation) publish({ busy: false }); }
    },
    async pollEmail() {
      const id = state.detail?.account.id, operation = id ? emails.get(id) : undefined;
      if (!live || !id || !operation || state.busy || state.blocked || state.uncertain) return;
      const version = generation;
      publish({ busy: true, error: "" });
      try {
        const email = await api.emailStatus(id, operation.key);
        if (!live || version !== generation) return;
        emails.set(id, { ...operation, result: email });
        publish(emailReceipt(email));
      } catch (error) { if (live && version === generation) failure(error); }
      finally { if (version === generation) publish({ busy: false }); }
    },
    async retryEmail() { if (live && state.uncertain && !state.busy && !state.blocked && state.pending?.kind === "email") await perform(state.pending); },
    dispose() { live = false; generation++; reading?.abort(); listeners.clear(); emails.clear(); },
  };
}
export type MaintenanceController = ReturnType<typeof createMaintenanceController>;
