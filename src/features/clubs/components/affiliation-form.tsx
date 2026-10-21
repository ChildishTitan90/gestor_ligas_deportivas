"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { affiliationFormSchema, affiliationOfficeCodes } from "../schemas";
import type { AffiliationFieldErrors, AffiliationFormProps } from "../types";

const officeNames = {
  PRESIDENT: "Presidente",
  SECRETARY: "Secretario",
  TREASURER: "Tesorero",
};
const personFields = [
  { key: "firstName", label: "Nombre(s)", required: true },
  { key: "paternalSurname", label: "Apellido paterno", required: true },
  { key: "maternalSurname", label: "Apellido materno (opcional)", required: false },
] as const;
const inputClass = "mt-2 min-h-12 w-full rounded-xl border border-border bg-surface px-3.5 py-3 text-base focus:border-primary";

export function AffiliationForm({ categories, initialValues }: AffiliationFormProps) {
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const validationLock = useRef(false);
  const [errors, setErrors] = useState<AffiliationFieldErrors>({});
  const [checked, setChecked] = useState(false);
  const [checking, setChecking] = useState(false);
  const categoryOptions = categories.filter((option, index, all) =>
    option.id.trim() !== "" && all.findIndex((item) => item.id === option.id) === index);

  function errorFor(path: string) {
    return errors[path] ? <p id={`${prefix}-${path}-error`} className="mt-2 text-sm text-danger">{errors[path]}</p> : null;
  }

  function field(path: string, label: string, value: string | undefined, required = true) {
    return (
      <div key={path}>
        <label htmlFor={`${prefix}-${path}`} className="block text-sm font-medium">{label}{required && " *"}</label>
        <input id={`${prefix}-${path}`} name={path} defaultValue={value} required={required}
          aria-invalid={Boolean(errors[path])}
          aria-describedby={errors[path] ? `${prefix}-${path}-error` : undefined}
          className={inputClass} />
        {errorFor(path)}
      </div>
    );
  }

  function validate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validationLock.current) return;
    validationLock.current = true;
    setChecking(true);
    setChecked(false);
    try {
      const data = new FormData(event.currentTarget);
      const result = affiliationFormSchema.safeParse({
        clubName: data.get("clubName"),
        uniformColors: data.get("uniformColors"),
        categoryIds: data.getAll("categoryIds"),
        officers: Object.fromEntries(affiliationOfficeCodes.map((office) => [office,
          Object.fromEntries(personFields.map(({ key }) => [key, data.get(`officers.${office}.${key}`)])),
        ])),
      });
      const nextErrors: AffiliationFieldErrors = {};
      if (!result.success) {
        for (const issue of result.error.issues) {
          const path = issue.path[0] === "categoryIds" ? "categoryIds" : issue.path.join(".");
          nextErrors[path] ??= issue.message;
        }
      }
      const selected = data.getAll("categoryIds");
      if (selected.some((id) => !categoryOptions.some((option) => option.id === id))) {
        nextErrors.categoryIds = "Selecciona únicamente categorías disponibles.";
      }
      setErrors(nextErrors);
      if (Object.keys(nextErrors).length) {
        const path = Object.keys(nextErrors)[0];
        const target = formRef.current?.elements.namedItem(path);
        if (target instanceof HTMLElement) target.focus();
        else formRef.current?.querySelector<HTMLElement>("[name='categoryIds']")?.focus();
      } else {
        setChecked(true);
      }
    } finally {
      validationLock.current = false;
      setChecking(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={validate} onChange={() => { setChecked(false); setErrors({}); }}
      noValidate aria-labelledby={`${prefix}-title`} aria-busy={checking}
      className="mx-auto w-full max-w-4xl space-y-8 rounded-3xl border border-border bg-surface p-5 text-foreground shadow-sm sm:p-8">
      <header>
        <h2 id={`${prefix}-title`} className="text-2xl font-semibold text-primary">Tarjetón de afiliación</h2>
        <p className="mt-2 text-sm leading-6 text-muted">Completa los datos de tu club y sus directivos. Los campos con * son obligatorios.</p>
        <p className="mt-3 rounded-xl bg-soft p-3 text-sm leading-6">Esta revisión solo valida los datos en esta pantalla. No envía ni registra una solicitud. Para solicitar la afiliación también se requieren la temporada y las firmas.</p>
      </header>

      {Object.keys(errors).length > 0 && <p role="alert" className="rounded-xl border border-danger/25 bg-danger-surface p-4 text-sm text-danger">Revisa los campos señalados para continuar.</p>}

      <fieldset className="space-y-5">
        <legend className="mb-4 text-lg font-semibold text-primary">Datos del club</legend>
        {field("clubName", "Nombre del club", initialValues?.clubName)}
        {field("uniformColors", "Colores del uniforme", initialValues?.uniformColors)}
      </fieldset>

      <fieldset aria-describedby={`${prefix}-categories-help${errors.categoryIds ? ` ${prefix}-categoryIds-error` : ""}`} aria-invalid={Boolean(errors.categoryIds)}>
        <legend className="text-lg font-semibold text-primary">Categorías solicitadas *</legend>
        <p id={`${prefix}-categories-help`} className="mt-2 text-sm text-muted">Selecciona una o más categorías de las opciones disponibles.</p>
        {categoryOptions.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {categoryOptions.map((category, index) => <label key={category.id} htmlFor={`${prefix}-category-${index}`} className="flex min-h-12 items-center gap-3 rounded-xl border border-border p-3">
            <input id={`${prefix}-category-${index}`} type="checkbox" name="categoryIds" value={category.id}
              defaultChecked={initialValues?.categoryIds.includes(category.id)}
              aria-describedby={errors.categoryIds ? `${prefix}-categoryIds-error` : undefined}
              aria-invalid={Boolean(errors.categoryIds)} className="size-5 shrink-0 accent-primary" />
            <span className="break-words text-sm">{category.name}</span>
          </label>)}
        </div> : <p className="mt-4 rounded-xl border border-border p-4 text-sm">No hay categorías disponibles. Necesitas opciones de la temporada para completar esta revisión.</p>}
        {errorFor("categoryIds")}
      </fieldset>

      {affiliationOfficeCodes.map((office) => <fieldset key={office} className="rounded-2xl border border-border p-4 sm:p-5">
        <legend className="px-2 text-lg font-semibold text-primary">{officeNames[office]}</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          {personFields.map(({ key, label, required }) => field(`officers.${office}.${key}`, label, initialValues?.officers[office][key], required))}
        </div>
      </fieldset>)}

      <section aria-labelledby={`${prefix}-signatures`} className="rounded-2xl border border-border bg-background p-4 sm:p-5">
        <h3 id={`${prefix}-signatures`} className="text-lg font-semibold text-primary">Firmas obligatorias para el envío</h3>
        <p className="mt-2 text-sm leading-6 text-muted">La captura de firmas estará disponible en una siguiente fase. No se cargan archivos desde esta pantalla.</p>
        <ul className="mt-3 space-y-2 text-sm">{affiliationOfficeCodes.map((office) => <li key={office}>{officeNames[office]}: firma pendiente.</li>)}</ul>
      </section>

      <div className="space-y-3">
        <button type="submit" disabled={checking || !categoryOptions.length}
          className="min-h-12 w-full rounded-xl bg-primary px-5 py-3 font-semibold text-white hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto">
          {checking ? "Revisando…" : "Revisar datos"}
        </button>
        <p role="status" className="text-sm leading-6 text-muted">{checked ? "Los datos de captura son válidos. No se ha enviado ni registrado una solicitud; faltan las firmas y completar el flujo de envío." : "Los datos se mantienen únicamente mientras esta pantalla permanezca abierta."}</p>
      </div>
    </form>
  );
}
