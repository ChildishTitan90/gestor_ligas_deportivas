"use client";
import { useState } from "react";
import { SelectField } from "@/components/ui/select-field";

export const tieBreakerOptions = [
  { value: "GOAL_DIFFERENCE", label: "Diferencia de goles · mayor es mejor" },
  { value: "GOALS_FOR", label: "Goles a favor · más es mejor" },
  { value: "GOALS_AGAINST", label: "Goles en contra · menos es mejor" },
  { value: "RED_CARDS", label: "Tarjetas rojas · menos es mejor" },
  { value: "YELLOW_CARDS", label: "Tarjetas amarillas · menos es mejor" },
];

export function TieBreakerFields() {
  const [values, setValues] = useState(["", "", ""]);
  return <fieldset className="space-y-4"><legend>Criterios de desempate, en orden</legend>
    <p>Elige el primer criterio y, si quieres, un segundo y un tercero. No se puede repetir un criterio. En tarjetas, se favorece al equipo con menos tarjetas.</p>
    {values.map((value, index) => <div key={index}><label htmlFor={`tie-breaker-${index}`}>{["Primer", "Segundo", "Tercer"][index]} criterio{index > 0 ? " (opcional)" : ""}</label>
      <SelectField id={`tie-breaker-${index}`} name="tieBreakers" required={index === 0} value={value}
        onValueChange={next => setValues(previous => previous.map((current, position) => position === index ? next : current))}
        options={[...(index > 0 ? [{ value: "", label: "Sin otro criterio" }] : []),
          ...tieBreakerOptions.map(option => ({ ...option, disabled: values.some((selected, position) => position !== index && selected === option.value) }))]} />
    </div>)}
  </fieldset>;
}
