import { playerPolicySchema } from "../schemas";
const control = "min-h-12 w-full rounded-xl border border-border bg-surface p-3";
export function PlayerPolicySummary({ value }: { value: unknown }) {
  const parsed = playerPolicySchema.safeParse(value);
  if (!parsed.success) return null;
  const p = parsed.data;
  const names = { PHOTO: "Foto", CURP: "CURP", CREDENTIAL: "Credencial", SCHOOL_CREDENTIAL: "Credencial escolar", INE: "INE" };
  const rows = [
    ["Edad por año de nacimiento", `Referencia ${p.referenceYear}: desde ${p.minimumAge}${p.maximumAge === null ? " años, sin máximo" : ` hasta ${p.maximumAge} años`}`],
    ["Excepción de edad", p.exceptionMinimumAge === null ? "Sin excepción" : `Desde ${p.exceptionMinimumAge} años, con responsiva y aprobación administrativa`],
    ["Documentos", p.documents.map(code => names[code]).join(", ")],
    ["Días de registro", p.registrationDays.map(day => ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"][day - 1]).join(", ")],
    ["Zona horaria", p.timezone], ["Jugadores por equipo en cancha", p.playersOnField],
    ["Máximo de convocados", p.maximumCalledUp ?? "Sin máximo configurado"], ["Máximo de plantilla", p.maximumRoster ?? "Sin máximo configurado"],
  ];
  return <dl className="grid gap-3 sm:grid-cols-2">{rows.map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl>;
}
export function PlayerPolicyFields({ value, type }: { value: unknown; type: string }) {
  const parsed = playerPolicySchema.safeParse(value);
  const policy = parsed.success ? parsed.data : null;
  const fields = [
    ["referenceYear", "Año de referencia", policy?.referenceYear ?? new Date().getUTCFullYear(), true],
    ["minimumAge", "Edad mínima ordinaria", policy?.minimumAge ?? (type === "OPEN" ? 18 : type === "VETERANS" ? 35 : ""), true],
    ["maximumAge", "Edad máxima (vacío: sin máximo)", policy?.maximumAge ?? "", type === "YOUTH"],
    ["exceptionMinimumAge", "Edad mínima con responsiva (vacío: sin excepción)", policy?.exceptionMinimumAge ?? "", false],
    ["playersOnField", "Jugadores por equipo en cancha", policy?.playersOnField ?? "", true],
    ["maximumCalledUp", "Máximo de convocados (vacío: sin máximo)", policy?.maximumCalledUp ?? "", false],
    ["maximumRoster", "Máximo de plantilla (vacío: sin máximo)", policy?.maximumRoster ?? "", false],
  ] as const;
  const docs = policy?.documents ?? ["PHOTO", "CURP", "CREDENTIAL", ...(type === "YOUTH" ? ["SCHOOL_CREDENTIAL"] : type === "VETERANS" ? ["INE"] : [])];
  return <>
    <p>Configura las reglas de esta liga. La edad se calcula por año de nacimiento. Una responsiva requiere decisión administrativa; su presentación no habilita al jugador.</p>
    <p>Referencia Morelia: Sub-8 a Sub-14 admite un año menos, sin excepción; desde Sub-15 admite dos años menos y uno adicional con responsiva. Libre desde 18 y veteranos desde 35.</p>
    <div className="grid gap-4 sm:grid-cols-2">{fields.map(([name, label, defaultValue, required]) => <label key={name}>{label}<input className={control} type="number" name={name} defaultValue={defaultValue} required={required} min={name === "referenceYear" ? 2000 : name.startsWith("maximum") || name === "playersOnField" ? 1 : 0} step="1" /></label>)}</div>
    <label className="block">Zona horaria de registro<input className={control} name="timezone" required defaultValue={policy?.timezone ?? "America/Mexico_City"} /></label>
    <fieldset className="space-y-2"><legend>Documentos requeridos</legend>{[["PHOTO", "Foto"], ["CURP", "CURP"], ["CREDENTIAL", "Credencial"], ["SCHOOL_CREDENTIAL", "Credencial escolar"], ["INE", "INE"]].map(([code, label]) => <label key={code} className="flex min-h-12 items-center gap-3"><input type="checkbox" name="documents" value={code} defaultChecked={docs.includes(code)} />{label}</label>)}</fieldset>
    <fieldset className="space-y-2"><legend>Días de registro permitidos</legend>{["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"].map((label, index) => <label key={label} className="flex min-h-12 items-center gap-3"><input type="checkbox" name="registrationDays" value={index + 1} defaultChecked={(policy?.registrationDays ?? [1, 2, 3]).includes(index + 1)} />{label}</label>)}</fieldset>
  </>;
}
