import type {MatchReportPresentation, ReportDemoData, ReportLineup} from './types';
import {teamTactics} from './tactics';

/** Convocatoria previa al sello: no altera dorsales ni promueve jugadores bloqueados. */
export function updateDraftLineup(data:ReportDemoData,report:MatchReportPresentation,playerId:string,changes:Partial<ReportLineup>):MatchReportPresentation {
  const player=data.players.find(p=>p.id===playerId),old=report.lineups.find(r=>r.playerId===playerId);
  if(!player||!old||report.lineupsLock||report.status==='CONFIRMED'||changes.selected===true&&!player.eligible)return report;
  const row={...old,...changes},captains={...report.captains};
  let tactics=teamTactics(data,report,player.teamId);
  if(!row.selected){tactics={...tactics,slots:tactics.slots.map(s=>s.playerId===playerId?{...s,playerId:null}:s)};if(captains[player.teamId]===playerId)delete captains[player.teamId];}
  const valid=(jersey:number|null)=>jersey!==null&&Number.isInteger(jersey)&&jersey>=0&&!report.lineups.some(r=>r.playerId!==playerId&&r.selected&&r.matchJersey===jersey&&data.players.some(p=>p.id===r.playerId&&p.teamId===player.teamId));
  if(row.participationHalf===2)tactics={...tactics,slots:tactics.slots.map(s=>s.playerId===playerId?{...s,playerId:null}:s)};
  if(row.selected&&row.participationHalf!==2&&player.eligible&&(!old.selected||!valid(old.matchJersey))&&valid(row.matchJersey)&&!tactics.slots.some(s=>s.playerId===playerId)){
    const empty=tactics.slots.findIndex(s=>!s.playerId);
    if(empty>=0)tactics={...tactics,slots:tactics.slots.map((s,i)=>i===empty?{...s,playerId}:s)};
  }
  row.starter=row.selected&&tactics.slots.some(s=>s.playerId===playerId);
  return {...report,captains,tactics:{...report.tactics,[player.teamId]:tactics},lineups:report.lineups.map(r=>r.playerId===playerId?row:r)};
}


/** Vista provisional: solo permite preparar una reserva indicada por el servidor.
 * No elimina sanciones ni concede autorización; el guardado reevalúa la intención. */
export function halfReservationData(data: ReportDemoData, report: MatchReportPresentation): ReportDemoData {
  return { ...data, players: data.players.map(player => {
    const row = report.lineups.find(row => row.playerId === player.id);
    if (!player.eligible && player.halfRestriction && row?.participationHalf === player.halfRestriction &&
        player.blockers.length > 0 && player.blockers.every(b => b.code === "PARTICIPATION_HALF_REQUIRED"))
      return { ...player, eligible: true, halfReservation: true };
    return player;
  }) };
}
