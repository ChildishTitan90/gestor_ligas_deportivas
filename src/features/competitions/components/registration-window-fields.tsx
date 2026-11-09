"use client";
import { useState } from "react";
type RegistrationWindow = { phase: string; opensAt: string; closesAt: string };
export function RegistrationWindowFields({ value = [] }: { value?: RegistrationWindow[] }) {
  const [rows, setRows] = useState(value);
  const control = "min-h-12 w-full rounded-xl border border-border bg-surface p-3";
  function update(index: number, key: keyof RegistrationWindow, value: string) {
    setRows(current => current.map((row, i) => i === index ? { ...row, [key]: value } : row));
  }
  return <fieldset className="space-y-4"><legend>Ventanas de altas por fase</legend>
    <p>Fechas y horas locales de la zona configurada. La apertura está incluida y el cierre excluido. También se aplican los días permitidos. Sin fases se conserva la ventana semanal. Las bajas no están sujetas a estas ventanas.</p>
    <input type="hidden" name="registrationWindowsJson" value={JSON.stringify(rows)} />
    {rows.map((row, i) => <fieldset key={i} className="space-y-3 rounded-xl border border-border p-4"><legend>Fase {i + 1}</legend>
      <label className="block">Nombre de fase<input className={control} required maxLength={120} value={row.phase} onChange={e => update(i, "phase", e.target.value)} /></label>
      {(["opensAt", "closesAt"] as const).map(key => <label key={key} className="block">{key === "opensAt" ? "Apertura" : "Cierre"}<input className={control} type="datetime-local" required step="1" value={row[key]} onChange={e => update(i, key, e.target.value.length === 16 ? `${e.target.value}:00` : e.target.value)} /></label>)}
      <button className={control} type="button" onClick={() => setRows(current => current.filter((_, index) => index !== i))}>Quitar fase {i + 1}</button>
    </fieldset>)}
    <button className={control} type="button" disabled={rows.length >= 20} onClick={() => setRows(current => [...current, { phase: "", opensAt: "", closesAt: "" }])}>Añadir fase</button>
  </fieldset>;
}
