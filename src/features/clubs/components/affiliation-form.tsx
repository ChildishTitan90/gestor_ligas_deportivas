"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import {
  affiliationFormSchema,
  affiliationOfficeCodes,
} from "../schemas";
import { affiliationSubmissionSchema } from "../affiliation-submission";
import { submitAffiliationRequest } from "../submit-affiliation.client";
import { resubmitAffiliationRequest } from "../resubmit-affiliation.client";
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
  "min-h-12 rounded-xl bg-primary px-5 py-3 font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60";

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
}: AffiliationFormProps) {
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const operationLock = useRef(false);
  const tasks = useRef<Partial<Record<Office, UploadTask>>>({});
  const pendingSubmission = useRef<unknown>(null);

  const [errors, setErrors] = useState<AffiliationFieldErrors>({});
  const [signatures, setSignatures] = useState<
    Partial<Record<Office, SignatureState>>
  >(() => Object.fromEntries(Object.entries(correction?.signatureFileIds ?? {}).map(([office, id]) =>
    [office, { id, message: "Firma registrada. Puedes conservarla o reemplazarla." }])));
  const [busy, setBusy] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [finished, setFinished] = useState(false);
  const [canCorrect, setCanCorrect] = useState(false);
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const [needsReload, setNeedsReload] = useState(false);

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

  function showErrors(nextErrors: AffiliationFieldErrors) {
    setErrors(nextErrors);

    const path = Object.keys(nextErrors)[0];
    if (!path) return;

    const target = formRef.current?.elements.namedItem(path);

    if (target instanceof HTMLElement) {
      target.focus();
    } else {
      formRef.current
        ?.querySelector<HTMLInputElement>("[name='categoryIds']")
        ?.focus();
    }
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
    if (!submissionContext || operationLock.current || frozen) return;

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (operationLock.current || finished) return;

    // Leer antes de deshabilitar los campos.
    const data = new FormData(event.currentTarget);

    operationLock.current = true;
    setBusy(true);
    setMessage("");
    setCanCorrect(false);

    try {
      if (!pendingSubmission.current) {
        const capture = affiliationFormSchema.safeParse({
          clubName: data.get("clubName"),
          uniformColors: data.get("uniformColors"),
          categoryIds: data.getAll("categoryIds"),
          officers: Object.fromEntries(
            affiliationOfficeCodes.map((office) => [
              office,
              Object.fromEntries(
                personFields.map(({ key }) => [
                  key,
                  data.get(`officers.${office}.${key}`),
                ]),
              ),
            ]),
          ),
        });

        const nextErrors: AffiliationFieldErrors = {};

        if (!capture.success) {
          for (const issue of capture.error.issues) {
            const path =
              issue.path[0] === "categoryIds"
                ? "categoryIds"
                : issue.path.join(".");

            nextErrors[path] ??= issue.message;
          }
        }

        if (
          data.getAll("categoryIds").some(
            (id) =>
              !categoryOptions.some((option) => option.id === id),
          )
        ) {
          nextErrors.categoryIds =
            "Selecciona únicamente categorías disponibles.";
        }

        if (submissionContext) {
          for (const office of affiliationOfficeCodes) {
            if (!signatures[office]?.id) {
              nextErrors[`signature.${office}`] =
                "Carga y confirma esta firma antes de enviar.";
            }
          }
        }

        if (!capture.success || Object.keys(nextErrors).length) {
          showErrors(nextErrors);
          return;
        }

        setErrors({});

        if (!submissionContext) {
          setChecked(true);
          return;
        }

        const officer = (office: Office) => ({
          ...capture.data.officers[office],
          signatureFileId: signatures[office]?.id,
        });

        const submission = affiliationSubmissionSchema.safeParse({
          ...capture.data,
          submissionKey: correction?.submissionKey ?? crypto.randomUUID(),
          clubId: submissionContext.clubId,
          seasonId: submissionContext.seasonId,
          officers: {
            PRESIDENT: officer("PRESIDENT"),
            SECRETARY: officer("SECRETARY"),
            TREASURER: officer("TREASURER"),
          },
        });

        if (!submission.success) {
          setMessage(
            "Revisa los datos y las firmas: todavía no se ha enviado la solicitud.",
          );
          return;
        }

        // Conservar una copia estable del envío y su clave.
        pendingSubmission.current = correction ? { ...submission.data, expectedVersion: correction.expectedVersion } : submission.data;
        setFrozen(true);
      }

      const outcome = correction
        ? await resubmitAffiliationRequest(correction.id, pendingSubmission.current)
        : await submitAffiliationRequest(pendingSubmission.current);

      if (outcome.kind === "confirmed") {
        setFinished(true);
        setMessage(
          `${correction ? "Correcciones enviadas; solicitud pendiente de revisión" : outcome.result.replayed
            ? "Solicitud recuperada"
            : "Solicitud registrada"
          }. Folio: ${outcome.result.referenceNumber}.`,
        );
      } else {
        setMessage(outcome.message);
        setCanCorrect(outcome.kind === "rejected");
        setNeedsReload(outcome.kind === "conflict" || outcome.kind === "access-denied");
      }
    } catch {
      setMessage(
        "No pudimos confirmar el resultado. Mantén esta pantalla abierta y reintenta el mismo envío.",
      );
    } finally {
      operationLock.current = false;
      setBusy(false);
    }
  }

  function correctData() {
    if (operationLock.current || !canCorrect || finished) return;

    pendingSubmission.current = null;
    setFrozen(false);
    setCanCorrect(false);
    setMessage("");
    setErrors({});
  }

  return (
    <form
      ref={formRef}
      onSubmit={submit}
      onChange={() => {
        if (!frozen) {
          setChecked(false);
          setErrors({});
        }
      }}
      noValidate
      aria-labelledby={`${prefix}-title`}
      aria-busy={busy}
      className="mx-auto w-full max-w-4xl space-y-8 rounded-3xl border border-border bg-surface p-5 text-foreground shadow-sm sm:p-8"
    >
      <header>
        <h2
          id={`${prefix}-title`}
          className="text-2xl font-semibold text-primary"
        >
          Tarjetón de afiliación
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Completa los datos de tu club y sus directivos.
          Los campos con * son obligatorios.
        </p>
        {correction && <div className="mt-3 space-y-2 rounded-xl border border-border p-3">
          <p className="font-medium">Corregir solicitud · {correction.referenceNumber}</p>
          <p className="whitespace-pre-wrap break-words">{correction.observations}</p>
          <p className="text-sm">El reenvío conserva el folio y el historial. Puedes conservar las firmas registradas o reemplazarlas.</p>
        </div>}
        <p className="mt-3 rounded-xl bg-soft p-3 text-sm leading-6">
          {correction ? "Revisa los datos solicitados y confirma las firmas antes de reenviar." : submissionContext
            ? "Selecciona las tres firmas. Cada archivo se carga y valida antes de enviar la solicitud."
            : "Esta vista permite revisar los datos. El envío todavía no está disponible desde esta pantalla."}
        </p>
      </header>

      {Object.keys(errors).length > 0 && (
        <p
          role="alert"
          className="rounded-xl border border-danger/25 bg-danger-surface p-4 text-sm text-danger"
        >
          Revisa los campos señalados para continuar.
        </p>
      )}

      <fieldset disabled={busy || frozen} className="space-y-8">
        <legend className="sr-only">Datos de la solicitud</legend>

        <fieldset className="space-y-5">
          <legend className="mb-4 text-lg font-semibold text-primary">
            Datos del club
          </legend>
          {field("clubName", "Nombre del club", initialValues?.clubName)}
          {field(
            "uniformColors",
            "Colores del uniforme",
            initialValues?.uniformColors,
          )}
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
              No hay categorías disponibles para esta selección.
            </p>
          )}

          {errorFor("categoryIds")}
        </fieldset>

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
              <div className="mt-5 space-y-3">
                <label
                  htmlFor={`${prefix}-signature-${office}`}
                  className="block text-sm font-medium"
                >
                  Firma de {officeNames[office].toLowerCase()} *
                </label>
                <p className="text-sm text-muted">
                  PNG, JPEG o PDF. Máximo 10 MiB.
                  Se carga al seleccionar el archivo.
                </p>
                <input
                  id={`${prefix}-signature-${office}`}
                  name={`signature.${office}`}
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  onChange={(event) =>
                    selectSignature(
                      office,
                      event.currentTarget.files?.[0],
                    )
                  }
                  aria-invalid={Boolean(
                    signatures[office]?.failed ||
                    errors[`signature.${office}`],
                  )}
                  aria-describedby={`${prefix}-signature-${office}-status`}
                  className={inputClass}
                />
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
      </fieldset>

      <div className="space-y-3">
        <button
          type="submit"
          disabled={busy || finished || needsReload || !categoryOptions.length}
          className={`${buttonClass} w-full sm:w-auto`}
        >
          {busy
            ? "Procesando…"
            : finished
              ? correction ? "Correcciones enviadas" : "Solicitud registrada"
              : frozen
                ? "Reintentar envío"
              : correction ? "Reenviar correcciones" : submissionContext
                  ? "Enviar solicitud"
                  : "Revisar datos"}
        </button>

        {canCorrect && (
          <button
            type="button"
            onClick={correctData}
            disabled={busy}
            className="ml-3 min-h-12 rounded-xl border border-border px-5 py-3"
          >
            Corregir datos
          </button>
        )}
        {correction && (needsReload || (frozen && !finished && !busy)) &&
          <a href={`/affiliations/${correction.id}/correct`} className="ml-3 inline-block min-h-12 rounded-xl border border-border px-5 py-3">
            Volver a consultar solicitud
          </a>}

        <p role="status" className="text-sm leading-6 text-muted">
          {message ||
            (checked
              ? "Los datos son válidos. No se ha enviado una solicitud."
              : frozen && !finished
                ? "Conservamos los datos del envío. Reintenta sin cerrar esta pantalla."
                : "Los datos se mantienen únicamente mientras esta pantalla permanezca abierta.")}
        </p>
      </div>
    </form>
  );
}
