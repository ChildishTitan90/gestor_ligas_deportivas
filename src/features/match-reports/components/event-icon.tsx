import { IconBallFootball } from "@tabler/icons-react";
import {ArrowDown,ArrowUp,ArrowDownUp,Ban,ShieldAlert,SquarePlus,SportShoe} from 'lucide-react';

/** Iconos vectoriales locales; el balón y el calzado reutilizan librerías de React. */
export function EventIcon({code,size=20,onPitch=false}:{code:string;size?:number;onPitch?:boolean}){
  if(code==='GOAL'||code==='OWN_GOAL')return <IconBallFootball aria-hidden="true" size={size} fill="white" color={code==='OWN_GOAL'?'var(--card-red)':'#17282d'} />;
  if(code==='ASSIST')return <SportShoe aria-hidden="true" size={size} />;
  if(code==='CAUTION'||code==='SENDING_OFF')return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"><rect x="6" y="3" width="13" height="18" rx="2" transform="rotate(12 12 12)" fill={code==='CAUTION'?'var(--card-yellow)':'var(--card-red)'} stroke="#17282d" strokeWidth="2"/></svg>;
  if(code==='SECOND_CAUTION')return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24"><rect x="3" y="6" width="12" height="16" rx="2" transform="rotate(12 9 14)" fill="var(--card-yellow)" stroke="#17282d" strokeWidth="2"/><rect x="9" y="2" width="12" height="16" rx="2" transform="rotate(12 15 10)" fill="var(--card-red)" stroke="#17282d" strokeWidth="2"/></svg>;
  const Icon=code==='ENTER'?ArrowUp:code==='EXIT'?ArrowDown:code==='INJURY'?SquarePlus:code==='SUSPENDED'?Ban:code==='SUBSTITUTION'?ArrowDownUp:ShieldAlert;
  return <span aria-hidden="true" style={{width:size,height:size}} className={`inline-flex shrink-0 items-center justify-center ${code==='ENTER'?'rounded-full bg-positive-surface text-positive':code==='EXIT'?'rounded-full bg-danger-surface text-[var(--card-red)]':code==='INJURY'?(onPitch?'text-white':'text-danger'):''}`}><Icon size={size} /></span>;
}
