import type { ReactNode } from "react";
import { EventIcon } from "./event-icon";
import type { ReportEvent } from "../types";

function IconStack({ children, size, width }: { children: ReactNode[]; size: number; width: number }) {
  if (!children.length) return null;
  return <span className="relative inline-block shrink-0" style={{ width, height: size + (children.length - 1) * size / 2 }}>{children.map((child,index)=><span key={index} className="absolute left-0 inline-flex" style={{ bottom:index * size / 2,zIndex:index+1 }}>{child}</span>)}</span>;
}
export function PlayerEventBadges({ events, kind = "all" }: { events: ReportEvent[]; kind?: "goals" | "cards" | "all" }) {
  const yellows = events.filter(e => e.typeCode === "CAUTION").length;
  const red = yellows >= 2 || events.some(e => e.typeCode === "SENDING_OFF");
  const yellowLabel = yellows >= 2 ? "Dos amarillas: expulsión" : "Amarilla";
  const goalIcons = events.filter(e=>e.typeCode==='GOAL'||e.typeCode==='OWN_GOAL').map((e,index)=><span key={e.id} role="img" aria-label={`${e.typeCode==='OWN_GOAL'?'Gol en contra':'Gol'} ${index+1}`} title={e.typeCode==='OWN_GOAL'?'Gol en contra':'Gol'} data-player-goal><EventIcon code={e.typeCode} size={16} /></span>);
  const assists=events.filter(e=>e.typeCode==='ASSIST').map((e,index)=><span key={e.id} role="img" aria-label={`Asistencia ${index+1}`} title="Asistencia" data-player-assist className="rounded-full bg-[var(--pitch)] text-white"><EventIcon code="ASSIST" size={16} /></span>);
  const cards = [...(yellows ? [<span key="yellow" role="img" aria-label={yellowLabel} title={yellowLabel} data-player-yellow className="inline-block h-4 w-3 rotate-12 rounded-sm border-2 border-[#17282d] bg-[var(--card-yellow)]" />] : []), ...(red ? [<span key="red" role="img" aria-label={yellows>=2?"Roja por segunda amarilla":"Roja directa"} title={yellows>=2?"Roja por segunda amarilla":"Roja directa"} data-player-red className="inline-block h-4 w-3 rotate-12 rounded-sm border-2 border-[#17282d] bg-[var(--card-red)]" />] : [])];
  return <span className="inline-flex items-end gap-1">{kind!=="cards" && <IconStack size={16} width={16}>{goalIcons}</IconStack>}{kind!=="cards" && <IconStack size={16} width={16}>{assists}</IconStack>}{kind!=="goals" && <IconStack size={16} width={12}>{cards}</IconStack>}</span>;
}
