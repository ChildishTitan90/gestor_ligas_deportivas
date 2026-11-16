import { dismissalEvents, orderedEvents, currentPitch, type PitchSlot } from "./tactics";
import type { ReportEvent } from "./types";

export function effectiveCaptain(initial: string | undefined, events: ReportEvent[], teamId: string): string | null {
  let captain = initial ?? null;
  const dismissals = new Set(dismissalEvents(events).map(e => e.id));
  for (const event of orderedEvents(events.filter(e => e.teamId === teamId && ["SUBSTITUTION", "CAUTION", "SENDING_OFF"].includes(e.typeCode)))) {
    if (captain && (event.typeCode === "SUBSTITUTION" && event.outgoingPlayerId === captain || dismissals.has(event.id) && event.playerId === captain)) captain = event.replacementCaptainId ?? null;
  }
  return captain;
}
export function invalidCaptainTransitions(initial: string | undefined, slots: PitchSlot[], events: ReportEvent[], teamId: string) {
  let captain = initial ?? null;
  const dismissals = new Set(dismissalEvents(events).map(e => e.id));
  const history: ReportEvent[] = [];
  for (const event of orderedEvents(events.filter(e => e.teamId === teamId && ["SUBSTITUTION", "CAUTION", "SENDING_OFF"].includes(e.typeCode)))) {
    history.push(event);
    const leaves = captain && (event.typeCode === "SUBSTITUTION" && event.outgoingPlayerId === captain || dismissals.has(event.id) && event.playerId === captain);
    if (leaves) {
      if (!event.replacementCaptainId || !currentPitch(slots, history, teamId).slots.some(s => s.playerId === event.replacementCaptainId)) return true;
      captain = event.replacementCaptainId;
    } else if (event.replacementCaptainId) return true;
  }
  return false;
}
