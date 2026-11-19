import test from "node:test";
import assert from "node:assert/strict";
import { validateSlot, type SlotContext } from "./slot-validation";

const at=Date.parse("2030-01-06T15:00:00Z");
const context:SlotContext={seasonId:"season",timezone:"America/Mexico_City",seasonStart:new Date("2030-01-01"),seasonEnd:new Date("2030-12-31"),
  day:{start_date:new Date("2030-01-06"),end_date:new Date("2030-01-06")},home:"a",away:"b",homeClub:"club",
  matchDurationMinutes:90,complexOnly:false,breaks:[],sanctions:[],loanWindows:[],
  venue:{id:"venue",is_league_sports_complex:true,match_duration_minutes:90,buffer_minutes:30,
    venue_availability:[{starts_at:new Date(at),ends_at:new Date(at+4*3600000),type:"AVAILABLE"}],home_venue_assignments:[]}};

test("validador compartido comprueba horario exacto, cierre y duración",()=>{
  const valid=validateSlot(context,at+5*60000);
  assert.ok(valid.ok);
  assert.equal(valid.slot.end-valid.slot.start,90*60000);
  assert.equal(valid.slot.reservedUntil-valid.slot.end,30*60000);
  const blocked=validateSlot({...context,venue:{...context.venue,venue_availability:[...context.venue.venue_availability,
    {starts_at:new Date(at),ends_at:new Date(at+3600000),type:"BLOCK"}]}},at);
  assert.ok(!blocked.ok && blocked.factor==="VENUE_BLOCK");
  const noTime=validateSlot(context,at+3*3600000);
  assert.ok(!noTime.ok && noTime.factor==="NO_OPENING");
});
test("revalida reglas de jornada, sanción y ventana de préstamo del local",()=>{
  const stage=validateSlot({...context,allowedVenueIds:["other"]},at);
  assert.ok(!stage.ok && stage.factor==="VENUE_STAGE");
  const sanction=validateSlot({...context,sanctions:[{season_team_id:"a",starts_at:new Date(at),ends_at:new Date(at+3600000)}]},at);
  assert.ok(!sanction.ok && sanction.factor==="SANCTION");
  const privateVenue={...context.venue,is_league_sports_complex:false};
  const noLoan=validateSlot({...context,venue:privateVenue},at);
  assert.ok(!noLoan.ok && noLoan.factor==="LOAN_WINDOW");
  assert.ok(validateSlot({...context,venue:privateVenue,loanWindows:[{start:at,end:at+120*60000}]},at).ok);
  const final=validateSlot({...context,venue:privateVenue,complexOnly:true},at);
  assert.ok(!final.ok && final.factor==="FINAL_ROUNDS");
});
