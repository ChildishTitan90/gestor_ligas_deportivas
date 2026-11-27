"use client";
import { DirectSignatureField } from "./direct-signature-field";
import { UniformKitFields } from "./uniform-kit-fields";
import { describeKits, uniformKitsSchema } from "../uniform-kits";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ActionLink } from "@/components/ui/action-link";
import { focusFormControl } from "@/components/ui/focus-form-control";
import { ProcessSteps } from "@/components/ui/process-steps";
import {
  affiliationFormSchema,
  affiliationOfficeCodes,
  type AffiliationFormValues,
} from "../schemas";
import { affiliationSubmissionSchema, type AffiliationSubmission } from "../affiliation-submission";
import { affiliationFollowUpHref, type AffiliationResult } from "../affiliation-feedback";
import { submitAffiliationRequest } from "../submit-affiliation.client";
import { resubmitAffiliationRequest } from "../resubmit-affiliation.client";
import { useAffiliationLeaveWarning } from "../use-affiliation-leave-warning";
import {
  createSignatureUploadTask,
  SignatureUploadClientError,
} from "../upload-signature.client";
import type {
  AffiliationFieldErrors,
  AffiliationFormProps,
} from "../types";

type Office = (typeof affiliationOfficeCodes)[number];
type UploadTask = ReturnType<typeof createSignatureUploadTask>;
type CaptureStage = 0 | 1 | 2;
type SubmissionPhase = "editing" | "sending" | "uncertain" | "rejected" | "blocked";
type SignatureState = {
  id?: string;
  message: string;
  failed?: boolean;
};

const officeNames = {
  PRESIDENT: "Presidente",
  SECRETARY: "Secretario",
  TREASURER: "Tesorero",
};

const personFields = [
  { key: "firstName", label: "Nombre(s)", required: true },
  { key: "paternalSurname", label: "Apellido paterno", required: true },
  {
    key: "maternalSurname",
    label: "Apellido materno (opcional)",
    required: false,
  },
] as const;

const inputClass =
  "mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-base focus:border-primary";

const buttonClass =
  "min-h-12 rounded-xl primary-action px-5 py-3 font-semibold disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButton = "min-h-12 rounded-xl border border-border px-5 py-3 text-sm font-semibold text-primary hover:bg-background disabled:opacity-50";
const steps = ["Datos y categorías", "Directivos y firmas", "Revisar solicitud"] as const;
const receiptStatus: Record<string, string> = { APPROVED: "Aprobada", REJECTED: "Rechazada", PENDING: "Pendiente" };

export function AffiliationForm(props: AffiliationFormProps) {
  const context = props.submissionContext;

  // Cambiar de cuenta, club o temporada descarta el estado anterior.
  const identity = context
    ? [
      context.actorId,
      context.clubId,
      context.seasonId,
      context.storageOrigin,
      props.correction?.id ?? "new",
      props.correction?.expectedVersion ?? "",
    ].join(":")
    : "capture-only";

  return <AffiliationFormContent key={identity} {...props} />;
}

function AffiliationFormContent({
  categories,
  initialValues,
  submissionContext,
  correction,
  contextLabels,
}: AffiliationFormProps) {
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const operationLock = useRef(false);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const receiptHeading = useRef<HTMLHeadingElement>(null);
  const tasks = useRef<Partial<Record<Office, UploadTask>>>({});
  const pendingSubmission = useRef<(AffiliationSubmission & { expectedVersion?: number }) | null>(null);
  const [signatureRevisions, setSignatureRevisions] = useState<
  Partial<Record<Office, number>>
>({});

  const [errors, setErrors] = useState<AffiliationFieldErrors>({});
  const [signatures, setSignatures] = useState<
    Partial<Record<Office, SignatureState>>
  >(() => Object.fromEntries(Object.entries(correction?.signatureFileIds ?? {}).map(([office, id]) =>
    [office, { id, message: "Firma registrada. Puedes conservarla o reemplazarla." }])));
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<CaptureStage>(0);
  const [review, setReview] = useState<AffiliationFormValues | null>(null);
  const [phase, setPhase] = useState<SubmissionPhase>("editing");
  const [receipt, setReceipt] = useState<AffiliationResult | null>(null);
  useEffect(() => {
    if (receipt) receiptHeading.current?.focus();
  }, [receipt]);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const finished = !!receipt;
  const frozen = phase !== "editing" || finished;
  const followUpHref = submissionContext && affiliationFollowUpHref(submissionContext.clubId, submissionContext.seasonId);
  const confirmedSignatures = affiliationOfficeCodes.filter(office => signatures[office]?.id).length;
  const signaturesUnavailable = !!submissionContext && !submissionContext.storageOrigin && confirmedSignatures !== affiliationOfficeCodes.length;
  useAffiliationLeaveWarning(finished ? null : phase === "uncertain" || phase === "sending"
    ? "La solicitud puede estar en proceso. Si sales perderás los datos para consultar o reintentar este mismo envío. ¿Salir de la captura?"
    : dirty ? "Los cambios de esta captura solo están en esta pantalla. ¿Salir y descartar los cambios?" : null);

  const categoryOptions = categories.filter(
    (option, index, all) =>
      option.id.trim() !== "" &&
      all.findIndex((item) => item.id === option.id) === index,
  );

  function errorFor(path: string) {
    return errors[path] ? (
      <p
        id={`${prefix}-${path}-error`}
        className="mt-2 text-sm text-danger"
      >
        {errors[path]}
      </p>
    ) : null;
  }

  function moveTo(nextStage: CaptureStage) {
    setStage(nextStage);
    requestAnimationFrame(() => stepHeading.current?.focus());
  }

  function showErrors(nextErrors: AffiliationFieldErrors) {
    setErrors(nextErrors);
    const path = Object.keys(nextErrors)[0];
    if (!path) return;

    setStage(path.startsWith("officers.") || path.startsWith("signature.") ? 1 : 0);
    requestAnimationFrame(() => {
      const form = formRef.current;
      if (!form) return;
      const office = affiliationOfficeCodes.find(code => path === `signature.${code}`);
      if (office) {
        (form.querySelector<HTMLElement>(`[data-signature-office="${office}"] canvas`) ?? stepHeading.current)?.focus();
      } else if (path === "categoryIds" || path === "uniformKits") {
        const selector = path === "categoryIds" ? "[name='categoryIds']" : "[data-affiliation-uniform] input[type='checkbox']";
        (form.querySelector<HTMLElement>(selector) ?? stepHeading.current)?.focus();
      } else if (!focusFormControl(form, path)) stepHeading.current?.focus();
    });
  }

  function field(
    path: string,
    label: string,
    value: string | undefined,
    required = true,
  ) {
    return (
      <div key={path}>
        <label
          htmlFor={`${prefix}-${path}`}
          className="block text-sm font-medium"
        >
          {label}
          {required && " *"}
        </label>
        <input
          id={`${prefix}-${path}`}
          name={path}
          defaultValue={value}
          required={required}
          aria-invalid={Boolean(errors[path])}
          aria-describedby={
            errors[path] ? `${prefix}-${path}-error` : undefined
          }
          className={inputClass}
        />
        {errorFor(path)}
      </div>
    );
  }

  function updateSignature(office: Office, state: SignatureState) {
    setSignatures((current) => ({
      ...current,
      [office]: state,
    }));
  }

  async function uploadSignature(office: Office) {
    const task = tasks.current[office];

    if (!task || operationLock.current || frozen) return;

    operationLock.current = true;
    setBusy(true);
    updateSignature(office, {
      message: "Cargando y validando firma…",
    });

    try {
      const id = await task.run();

      updateSignature(office, {
        id,
        message: "Firma cargada y validada.",
      });
    } catch (error) {
      updateSignature(office, {
        failed: true,
        message:
          error instanceof SignatureUploadClientError
            ? error.message
            : "No se pudo completar la carga. Reintenta.",
      });
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  }

  function selectSignature(office: Office, file: File | undefined) {
    if (!submissionContext?.storageOrigin || operationLock.current || frozen) return;

    setDirty(true);
    delete tasks.current[office];
    updateSignature(office, { message: "Firma pendiente." });

    if (!file) return;

    try {
      tasks.current[office] = createSignatureUploadTask({
        file,
        clubId: submissionContext.clubId,
        seasonId: submissionContext.seasonId,
        office,
        storageOrigin: submissionContext.storageOrigin,
      });

      void uploadSignature(office);
    } catch (error) {
      updateSignature(office, {
        failed: true,
        message:
          error instanceof SignatureUploadClientError
            ? error.message
            : "No se pudo preparar el archivo seleccionado.",
      });
    }
  }
function invalidateSignatureForOfficer(name: string) {
  const office = affiliationOfficeCodes.find((code) =>
    name.startsWith(`officers.${code}.`),
  );

  if (!office || operationLock.current || frozen) return;

  delete tasks.current[office];

  updateSignature(office, {
    message: "Cambiaste los datos del firmante. Captura y confirma su firma.",
  });

  setSignatureRevisions((current) => ({
    ...current,
    [office]: (current[office] ?? 0) + 1,
  }));
}
  function advance(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operationLock.current || frozen || stage === 2) return;

    const data = new FormData(event.currentTarget);
    const kitInput = String(data.get("uniformKits") ?? "");
    let uniformKits: unknown;
    try { uniformKits = kitInput ? JSON.parse(kitInput) : undefined; } catch { uniformKits = null; }
    const validKits = uniformKitsSchema.safeParse(uniformKits);
    const selectedCategories = data.getAll("categoryIds");
    const capture = affiliationFormSchema.safeParse({
      clubName: data.get("clubName"),
      uniformColors: validKits.success ? describeKits(validKits.data) : data.get("uniformColors"),
      ...(kitInput ? { uniformKits } : {}),
      categoryIds: selectedCategories,
      officers: Object.fromEntries(affiliationOfficeCodes.map(office => [office,
        Object.fromEntries(personFields.map(({ key }) => [key, data.get(`officers.${office}.${key}`)])),
      ])),
    });
    const nextErrors: AffiliationFieldErrors = {};
    if (!capture.success) {
      for (const issue of capture.error.issues) {
        if (stage === 0 && issue.path[0] === "officers") continue;
        const key = issue.path[0] === "categoryIds" || issue.path[0] === "uniformKits" ? issue.path[0] : issue.path.join(".");
        nextErrors[key] ??= issue.message;
      }
    }
    if (selectedCategories.some(id => !categoryOptions.some(option => option.id === id))) {
      nextErrors.categoryIds = "Selecciona únicamente categorías disponibles.";
    }
    if (stage === 1 && submissionContext) {
      for (const office of affiliationOfficeCodes) {
        if (!signatures[office]?.id) nextErrors[`signature.${office}`] = "Confirma esta firma antes de revisar la solicitud.";
      }
    }
    if (Object.keys(nextErrors).length) {
      showErrors(nextErrors);
    } else if (stage === 0) {
      setErrors({});
      moveTo(1);
    } else if (capture.success) {
      setErrors({});
      setReview(capture.data);
      moveTo(2);
    }
  }

  async function submitReviewed() {
    if (!review || !submissionContext || operationLock.current || finished || phase === "blocked" || phase === "rejected") return;

    if (!pendingSubmission.current) {
      const officer = (office: Office) => ({ ...review.officers[office], signatureFileId: signatures[office]?.id });
      const payload = affiliationSubmissionSchema.safeParse({
        ...review,
        submissionKey: correction?.submissionKey ?? crypto.randomUUID(),
        clubId: submissionContext.clubId,
        seasonId: submissionContext.seasonId,
        officers: { PRESIDENT: officer("PRESIDENT"), SECRETARY: officer("SECRETARY"), TREASURER: officer("TREASURER") },
      });
      if (!payload.success) {
        setMessage("Revisa los datos de la solicitud y las firmas antes de enviarla.");
        setPhase("rejected");
        return;
      }
      pendingSubmission.current = correction ? { ...payload.data, expectedVersion: correction.expectedVersion } : payload.data;
    }

    operationLock.current = true;
    setPhase("sending");
    setMessage("");

    try {
      const outcome = correction
        ? await resubmitAffiliationRequest(correction.id, pendingSubmission.current)
        : await submitAffiliationRequest(pendingSubmission.current);
      if (outcome.kind === "confirmed") {
        setReceipt(outcome.result);
        setPhase("editing");
      } else {
        setMessage(outcome.message);
        setPhase(outcome.kind === "rejected" ? "rejected" : outcome.kind === "unconfirmed" ? "uncertain" : "blocked");
      }
    } catch {
      setMessage("No pudimos confirmar el resultado. Mantén esta pantalla abierta para conservar el envío.");
      setPhase("uncertain");
    } finally {
      operationLock.current = false;
    }
  }

  function editReview() {
    pendingSubmission.current = null;
    setPhase("editing");
    setReview(null);
    setMessage("");
    moveTo(0);
  }

  if (receipt) {
    const status = receiptStatus[receipt.status] ?? "No disponible";
    return <section className="space-y-4 rounded-xl border border-positive bg-positive-surface p-5 sm:p-6" aria-labelledby={`${prefix}-receipt`}>
      <h2 id={`${prefix}-receipt`} ref={receiptHeading} tabIndex={-1} className="scroll-mt-28 text-xl font-semibold text-positive">
        {correction ? "Correcciones recibidas" : receipt.replayed ? "Solicitud recuperada" : "Solicitud recibida"}
      </h2>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Folio</dt><dd className="wrap-anywhere font-semibold">{receipt.referenceNumber}</dd></div>
        <div><dt className="text-muted">Estado registrado</dt><dd className="font-semibold">{status}</dd></div>
      </dl>
      <p className="text-sm leading-6">{receipt.status === "PENDING" && !receipt.replayed
        ? "Secretaría tiene el siguiente paso. Consulta el folio para ver si te solicitan correcciones o si ya registraron una decisión."
        : "Abre el seguimiento para consultar el estado actual y la acción disponible."}</p>
      {followUpHref && <ActionLink href={followUpHref}>Ver seguimiento</ActionLink>}
    </section>;
  }

  return (
    <form
      ref={formRef}
      onSubmit={advance}
      onPointerDownCapture={event => { if (event.target instanceof HTMLCanvasElement && !frozen) setDirty(true); }}
      onChange={event => {
        if (frozen) return;
        setDirty(true);
        setErrors({});
        if (event.target instanceof HTMLInputElement) invalidateSignatureForOfficer(event.target.name);
      }}
      noValidate
      aria-labelledby={`${prefix}-title`}
      aria-busy={busy || phase === "sending"}
      className="w-full space-y-5 rounded-xl border border-border bg-surface p-5 text-foreground sm:p-6"
    >
      <header>
        <h2
          id={`${prefix}-title`}
          className="text-2xl font-semibold text-primary"
        >
          Tarjetón de afiliación
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">Ten a la mano los colores de los uniformes, las categorías, los nombres y las firmas de presidencia, secretaría y tesorería.</p>
        {correction && <div className="mt-3 space-y-2 rounded-xl border border-border p-3">
          <p className="font-medium">Observaciones de Secretaría · {correction.referenceNumber}</p>
          <p className="whitespace-pre-wrap wrap-break-word">{correction.observations}</p>
          <p className="text-sm">El reenvío conserva el folio y el historial. Puedes conservar las firmas registradas o reemplazarlas.</p>
        </div>}
        {signaturesUnavailable && <p role="status" className="mt-3 rounded-xl border border-border bg-background p-3 text-sm leading-6">
          La carga de firmas no está disponible. Puedes completar los datos mientras esta pantalla esté abierta. El envío requiere las tres firmas confirmadas.
        </p>}
      </header>
      <ProcessSteps steps={steps} current={stage} />
      <div className="space-y-1">
        <h3 ref={stepHeading} tabIndex={-1} className="scroll-mt-28 text-lg font-semibold text-primary">{steps[stage]}</h3>
        {stage === 0 && <p className="text-sm text-muted">Completa los campos obligatorios y elige al menos una categoría.</p>}
        {stage === 1 && submissionContext && <p role="status" className="text-sm text-muted">{confirmedSignatures} de {affiliationOfficeCodes.length} firmas confirmadas. Confirma cada firma después de capturarla.</p>}
        {stage === 2 && phase === "editing" && <p className="text-sm text-muted">Confirma los datos antes del envío. La solicitud todavía no se ha enviado.</p>}
      </div>

      {Object.keys(errors).length > 0 && (
        <p
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger-surface p-4 text-sm text-danger"
        >
          Revisa los campos señalados para continuar.
        </p>
      )}

      <fieldset hidden={stage === 2} disabled={busy || frozen} className="space-y-5">
        <legend className="sr-only">Datos de la solicitud</legend>
        <div hidden={stage !== 0} className="space-y-5">
        <fieldset className="space-y-4">
          <legend className="mb-4 text-lg font-semibold text-primary">
            Datos del club
          </legend>
          {field("clubName", "Nombre del club", initialValues?.clubName)}
          {field(
            "uniformColors",
            "Descripción anterior del uniforme (si no defines colores)",
            initialValues?.uniformColors,
            false,
          )}
          <div data-affiliation-uniform><UniformKitFields initialValue={initialValues?.uniformKits} legacy={Boolean(initialValues?.uniformColors)} /></div>
          {errorFor("uniformKits")}
        </fieldset>

        <fieldset
          aria-invalid={Boolean(errors.categoryIds)}
          aria-describedby={
            errors.categoryIds
              ? `${prefix}-categoryIds-error`
              : undefined
          }
        >
          <legend className="text-lg font-semibold text-primary">
            Categorías solicitadas *
          </legend>
          <p className="mt-2 text-sm text-muted">
            Selecciona una o más categorías disponibles.
          </p>

          {categoryOptions.length ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {categoryOptions.map((category, index) => (
                <label
                  key={category.id}
                  htmlFor={`${prefix}-category-${index}`}
                  className="flex min-h-12 items-center gap-3 rounded-xl border border-border p-3"
                >
                  <input
                    id={`${prefix}-category-${index}`}
                    type="checkbox"
                    name="categoryIds"
                    value={category.id}
                    defaultChecked={
                      initialValues?.categoryIds.includes(category.id)
                    }
                    aria-invalid={Boolean(errors.categoryIds)}
                    aria-describedby={
                      errors.categoryIds
                        ? `${prefix}-categoryIds-error`
                        : undefined
                    }
                    className="size-5 shrink-0 accent-primary"
                  />
                  <span className="wrap-break-word text-sm">
                    {category.name}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-xl border border-border p-4 text-sm">
              Esta temporada no tiene categorías habilitadas. Secretaría debe configurarlas
              antes de que puedas seleccionar una categoría y enviar la solicitud.
            </p>
          )}

          {errorFor("categoryIds")}
        </fieldset>
        </div>

        <div hidden={stage !== 1} className="space-y-5">
        {affiliationOfficeCodes.map((office) => (
          <fieldset
            key={office}
            className="rounded-2xl border border-border p-4 sm:p-5"
          >
            <legend className="px-2 text-lg font-semibold text-primary">
              {officeNames[office]}
            </legend>

            <div className="grid gap-5 sm:grid-cols-2">
              {personFields.map(({ key, label, required }) =>
                field(
                  `officers.${office}.${key}`,
                  label,
                  initialValues?.officers[office][key],
                  required,
                ),
              )}
            </div>
{submissionContext && (
  <div
  className="mt-5 space-y-3"
  data-signature-office={office}
>
   {correction?.signatureFileIds?.[office] &&
signatures[office]?.id === correction.signatureFileIds[office] ? (
  <div className="space-y-3 rounded-xl border border-border p-4">
    <p className="font-semibold">
      Firma de {officeNames[office].toLowerCase()} registrada
    </p>

    <p className="text-sm text-muted">
      Se conservará el archivo existente al reenviar las correcciones.
      No necesitas dibujar otra firma si los datos del firmante
      no cambiaron.
    </p>

    {submissionContext.storageOrigin && (
      <button
        type="button"
        disabled={busy || frozen}
        onClick={() => selectSignature(office, undefined)}
        className="min-h-12 rounded-xl border border-border px-4 py-2
                   focus-visible:outline-2 focus-visible:outline-offset-2
                   disabled:cursor-not-allowed disabled:opacity-50"
      >
        Reemplazar firma
      </button>
    )}
  </div>
) : (
  <DirectSignatureField
    key={`${office}-${signatureRevisions[office] ?? 0}`}
    label={`Firma de ${officeNames[office].toLowerCase()} *`}
    disabled={busy || frozen || !submissionContext.storageOrigin}
    stored={Boolean(signatures[office]?.id)}
    submitted={finished}
    onChange={(file) => selectSignature(office, file ?? undefined)}
  />
)}

    <p
      id={`${prefix}-signature-${office}-status`}
      role="status"
      className="text-sm"
    >
      {signatures[office]?.message ?? "Firma pendiente."}
    </p>

    {errorFor(`signature.${office}`)}

    {signatures[office]?.failed && (
      <button
        type="button"
        onClick={() => void uploadSignature(office)}
        className={buttonClass}
      >
        Reintentar carga
      </button>
    )}
  </div>
)}
          </fieldset>
        ))}
        </div>
      </fieldset>

      {stage === 2 && review && <dl className="grid gap-3 rounded-xl border border-border bg-background p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">Club en la solicitud</dt><dd className="wrap-anywhere font-semibold">{review.clubName}</dd></div>
        {contextLabels && <div><dt className="text-muted">Temporada y liga</dt><dd className="wrap-anywhere font-semibold">{contextLabels.season} · {contextLabels.league}</dd></div>}
        <div><dt className="text-muted">Uniformes</dt><dd className="wrap-anywhere">{review.uniformColors}</dd></div>
        <div><dt className="text-muted">Categorías solicitadas</dt><dd className="wrap-anywhere">{categoryOptions.filter(option => review.categoryIds.includes(option.id)).map(option => option.name).join(", ")}</dd></div>
        {affiliationOfficeCodes.map(office => <div key={office}><dt className="text-muted">{officeNames[office]}</dt><dd className="wrap-anywhere">
          {[review.officers[office].firstName, review.officers[office].paternalSurname, review.officers[office].maternalSurname].filter(Boolean).join(" ")}
          {submissionContext && <span className="block text-xs text-positive">Firma confirmada</span>}
        </dd></div>)}
      </dl>}
      {message && <p role="alert" className="rounded-xl border border-border bg-background p-3 text-sm leading-6">{message}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {stage === 1 && <button type="button" disabled={busy} className={secondaryButton} onClick={() => moveTo(0)}>Volver a datos y categorías</button>}
        {stage < 2 && <button key={stage} type="submit" disabled={busy || !categoryOptions.length || stage === 1 && signaturesUnavailable} className={buttonClass}>
          {stage === 0 ? "Continuar a directivos y firmas" : "Revisar solicitud"}
        </button>}
        {stage === 2 && (phase === "editing" || phase === "rejected") && <button type="button" className={secondaryButton} onClick={editReview}>Volver a editar</button>}
        {stage === 2 && submissionContext && (phase === "editing" || phase === "sending") && <button type="button" disabled={phase === "sending"} className={buttonClass} onClick={() => void submitReviewed()}>
          {phase === "sending" ? "Enviando a Secretaría…" : correction ? "Reenviar correcciones" : "Enviar a revisión"}
        </button>}
        {(phase === "uncertain" || phase === "blocked") && followUpHref && <ActionLink href={followUpHref} target="_blank" rel="noopener noreferrer" variant="secondary">Consultar seguimiento en otra pestaña</ActionLink>}
        {phase === "uncertain" && <button type="button" className={buttonClass} onClick={() => void submitReviewed()}>Reintentar el mismo envío</button>}
      </div>
      {phase === "uncertain" && <p className="text-sm leading-6 text-muted">Consulta el folio antes de reintentar. Mantén esta pestaña abierta para conservar el envío original.</p>}
      {phase === "sending" && <p role="status" className="text-sm text-muted">Esperando el acuse del servidor…</p>}
      {stage < 2 && <p className="text-sm text-muted">La captura se conserva mientras esta pantalla esté abierta.</p>}
    </form>
  );
}
