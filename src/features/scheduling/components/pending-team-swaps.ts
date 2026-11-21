"use client";

const pending = new Set<string>();
const listeners = new Set<() => void>();
export function setPendingTeamSwaps(id:string, value:boolean) {
  if (pending.has(id) === value) return;
  if (value) pending.add(id); else pending.delete(id);
  listeners.forEach(listener => listener());
}
export function hasPendingTeamSwaps(id:string) { return pending.has(id); }
export function subscribePendingTeamSwaps(listener:() => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
