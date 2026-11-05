"use client";
import {useId,useState} from "react";
import {ActionLink} from "@/components/ui/action-link";
import {SelectField} from "@/components/ui/select-field";
import type {ParticipationDirectory} from "../participation-workspace";
export function PlayerParticipationDirectory({data}:{data:ParticipationDirectory}){
  const prefix=useId(),[search,setSearch]=useState(""),[filter,setFilter]=useState("ALL");
  const normalize=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es");
  const rows=data.rows.filter(row=>normalize(`${row.name} ${row.team} ${row.club} ${row.category} ${row.season}`).includes(normalize(search)) && (filter==="ALL" || (filter==="PENDING"?row.pending>0:row.authorized>0)));
  return <div className="space-y-6"><header><h1 className="text-2xl font-semibold text-primary">Participaciones superiores</h1><p className="mt-2 leading-7 text-muted">Solicita y revisa participaciones sin cambiar la categoría de origen del jugador.</p></header>
    <section aria-label="Filtrar participaciones" className="grid items-end gap-4 rounded-2xl border border-border bg-surface p-5 sm:grid-cols-2"><label htmlFor={`${prefix}-search`} className="block text-sm font-medium">Buscar jugador, equipo o club<input id={`${prefix}-search`} type="search" value={search} onChange={event=>setSearch(event.target.value)} className="mt-2 min-h-12 w-full rounded-xl border border-border bg-background px-4 py-3" /></label><div><label htmlFor={`${prefix}-filter`} className="mb-2 block text-sm font-medium">Mostrar</label><SelectField id={`${prefix}-filter`} value={filter} onValueChange={setFilter} searchable={false} options={[{value:"ALL",label:"Todos los jugadores de mi alcance"},{value:"PENDING",label:"Con solicitudes pendientes"},{value:"AUTHORIZED",label:"Con autorizaciones registradas"}]} /></div><p role="status" className="text-sm text-muted sm:col-span-2">{rows.length} de {data.rows.length} jugadores en tu alcance</p></section>
    {!rows.length && <p className="rounded-2xl border border-border bg-surface p-6">{data.rows.length?"No hay jugadores que coincidan con los filtros.":"Todavía no hay jugadores registrados en tu alcance para gestionar participaciones."}</p>}
    <ul className="space-y-4">{rows.map(row=><li key={row.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-5"><div><h2 className="text-lg font-semibold">{row.name}</h2><p className="mt-1 text-sm text-muted">{row.team} · {row.category} · {row.club}</p><p className="mt-1 text-sm text-muted">{row.season}</p><p className="mt-2 text-sm">Pendientes: {row.pending} · Autorizaciones: {row.authorized} · Retiradas: {row.withdrawn}</p></div><ActionLink href={`/players/registrations/${row.id}/participations`} aria-label={`Gestionar participaciones de ${row.name}`}>Gestionar participaciones</ActionLink></li>)}</ul>
    <p className="text-sm leading-6 text-muted">Los contadores representan autorizaciones registradas. Al abrir un caso se comprueban su vigencia, documentos, identidad y restricciones actuales.</p>
  </div>;
}
