import type { ReactNode } from "react";
import { CircleDot } from "lucide-react";
import type { ReportEvent } from "../types";

function IconStack({ children, size, width }: { children: ReactNode[]; size: number; width: number }) {
  if (!children.length) return null;
  return <span className="relative inline-block shrink-0" style={{ width, height: size + (children.length - 1) * size / 2 }}>{children.map((child,index)=><span key={index} className="absolute left-0 inline-flex" style={{ bottom:index * size / 2,zIndex:index+1 }}>{child}</span>)}</span>;
}
export function PlayerEventBadges({ events, kind = "all" }: { events: ReportEvent[]; kind?: "goals" | "cards" | "all" }) {
  const goals = events.filter(e => e.typeCode === "GOAL").length;
  const yellows = events.filter(e => e.typeCode === "CAUTION").length;
  const red = yellows >= 2 || events.some(e => e.typeCode === "SENDING_OFF");
  const goalIcons = Array.from({length:goals},(_,index)=><span key={`goal-${index}`} role="img" aria-label={`Gol ${index+1} de ${goals}`} title={`Gol ${index+1} de ${goals}`} data-player-goal><CircleDot size={16} aria-hidden="true" className="rounded-full bg-white text-[#17282d]" /></span>);
  const cards = [...Array.from({length:yellows},(_,index)=><span key={`yellow-${index}`} role="img" aria-label={`Amarilla ${index+1} de ${yellows}`} title={`Amarilla ${index+1} de ${yellows}`} data-player-yellow className="inline-block h-4 w-3 rounded-sm border-2 border-[#17282d] bg-[var(--card-yellow)]" />), ...(red ? [<span key="red" role="img" aria-label={yellows>=2?"Roja por segunda amarilla":"Roja directa"} title={yellows>=2?"Roja por segunda amarilla":"Roja directa"} data-player-red className="inline-block h-4 w-3 rounded-sm border-2 border-[#17282d] bg-[var(--card-red)]" />] : [])];
  return <span className="inline-flex items-end gap-1">{kind!=="cards" && <IconStack size={16} width={16}>{goalIcons}</IconStack>}{kind!=="goals" && <IconStack size={16} width={12}>{cards}</IconStack>}</span>;
}
