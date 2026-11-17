import type {ReportEvent} from './types';
export function capturedScore(events:ReportEvent[],home:string,away:string){
  return {home:events.filter(e=>e.typeCode==='GOAL'&&e.teamId===home||e.typeCode==='OWN_GOAL'&&e.teamId===away).length,away:events.filter(e=>e.typeCode==='GOAL'&&e.teamId===away||e.typeCode==='OWN_GOAL'&&e.teamId===home).length};
}
