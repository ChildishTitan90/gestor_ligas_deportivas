"use client";
import { useState } from "react";
import { ColorField } from "@/components/ui/color-field";
import { defaultUniformKits, hexRGB, rgbHex, rgbText, type UniformKit, type UniformKits } from "../uniform-kits";

export function KitColorFields({ id, kit, onChange }: { id: string; kit: UniformKit; onChange: (kit: UniformKit) => void }) {
  return <div className="grid grid-cols-2 gap-3">{(["primary", "secondary"] as const).map(part => <ColorField key={part} id={`${id}-${part}`} label={part === "primary" ? "Principal" : "Secundario"} value={rgbHex(kit[part])} description={rgbText(kit[part])} onValueChange={hex => onChange({ ...kit, [part]: hexRGB(hex) })} />)}</div>;
}

export function UniformKitFields({ initialValue, legacy = false }: { initialValue?: UniformKits; legacy?: boolean }) {
  const [enabled, setEnabled] = useState(Boolean(initialValue) || !legacy);
  const [kits, setKits] = useState(initialValue ?? defaultUniformKits);
  return <fieldset className="space-y-4 rounded-xl border border-border p-4"><legend className="px-1 font-semibold">Colores de los uniformes</legend><label className="flex min-h-12 items-center gap-3"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} className="size-5 accent-[var(--action)]" />Definir uniforme local y visitante</label><input type="hidden" name="uniformKits" value={enabled ? JSON.stringify(kits) : ""} />{enabled ? <div className="grid gap-5 sm:grid-cols-2">{(["home", "away"] as const).map(side => <div key={side}><p className="mb-3 font-semibold">{side === "home" ? "Local" : "Visitante"}</p><KitColorFields id={`affiliation-kit-${side}`} kit={kits[side]} onChange={kit => setKits(current => ({ ...current, [side]: kit }))} /></div>)}</div> : <p className="text-sm text-muted">{initialValue ? "Se conservan los colores registrados y la descripción anterior. Activa la opción para ajustarlos." : "Se conserva la descripción existente. No se convierten nombres de colores automáticamente."}</p>}<p className="text-sm text-muted">Los equipos de este club usarán estos colores como referencia en esta temporada. En cada partido se conserva el uniforme elegido.</p></fieldset>;
}
