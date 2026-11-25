import type {AssignmentAssessment,AssignmentPresentation,MatchPresentation,RefereePreviewData} from "./types";

export type AssignmentMatchChoice={match:MatchPresentation;description:string};
/** El filtro identifica referencias; no reconstruye identidades históricas. */
export function historyRefereeOptions(data:RefereePreviewData,seasonId:string){
  const matches=new Set(data.matches.filter(m=>m.seasonId===seasonId).map(m=>m.id));
  const history=data.history.filter(h=>h.seasonId===seasonId);
  const ids=new Set([...data.assignments.filter(a=>matches.has(a.matchId)),...history].map(a=>a.refereeId));
  return [...ids].map(id=>{
    const entries=history.filter(h=>h.refereeId===id);
    const captured=[...new Set(entries.flatMap(h=>h.identity.source==="UNAVAILABLE"?[]:[h.identity.label]))];
    const label=captured.length?captured.join(" / "):entries.length?"Identidad histórica no disponible":data.referees.find(r=>r.id===id)?.name??"Árbitro sin nombre disponible";
    return {value:id,label,description:id};
  });
}
/** Ordena el trabajo visible. Las reglas y la efectividad se revalidan en servidor. */
export function assignmentMatchesNeedingAttention(data:RefereePreviewData,seasonId:string,evaluate:(assignment:AssignmentPresentation)=>AssignmentAssessment|undefined):AssignmentMatchChoice[]{
  if(data.seasons.find(s=>s.id===seasonId)?.closed)return [];
  return data.matches.filter(m=>m.seasonId===seasonId&&m.openForAssignments!==false).flatMap(match=>{
    const current=data.assignments.filter(a=>a.matchId===match.id&&a.status!=="REVOKED");
    const approved=current.filter(a=>a.status==="APPROVED");
    if(approved.length){
      const assessments=approved.map(evaluate);
      if(assessments.every(a=>a&&a.blockers.length===0))return [];
      return [{match,description:assessments.some(a=>!a)?"Designación por revisar; falta su evaluación":"Designación aprobada con bloqueos; revisar antes de reasignar"}];
    }
    const pending=current.filter(a=>a.status==="PROPOSED").length;
    return [{match,description:pending?`Sin árbitro aprobado · ${pending} ${pending===1?"propuesta pendiente":"propuestas pendientes"}`:data.assignments.some(a=>a.matchId===match.id&&a.status==="REVOKED")?"Sin árbitro aprobado · hay un antecedente revocado":"Sin árbitro aprobado"}];
  });
}
