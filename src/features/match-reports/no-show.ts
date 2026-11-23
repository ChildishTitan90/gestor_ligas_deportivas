import { z } from "zod";

/** Solo describe el incidente capturado; no confirma una decisión ni crea resultados. */
export const noShowSchema=z.strictObject({
  absent:z.enum(["HOME","AWAY","BOTH"]),
  notes:z.string().trim().min(5).max(2000),
});
export type NoShow=z.infer<typeof noShowSchema>;

/** Propuesta de tanteador de PDGLD-29 para un equipo ausente. */
export function proposedNoShowScore(noShow:NoShow) {
  if(noShow.absent==="BOTH") return null;
  return noShow.absent==="HOME" ? {home:0,away:1} : {home:1,away:0};
}
