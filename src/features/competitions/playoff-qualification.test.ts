import assert from "node:assert/strict";
import test from "node:test";
import { drawQuarterfinals, playoffDatesRequired, playoffFormatSchema, playoffHomeOrder, playoffRoundDates, playoffRulesSchema, proposePlayoffBracket, qualifyForPlayoffs, resolvePlayoffWinner, semifinalBracket, singleGroupQuarterfinals, tiedPlayoffResolution, twoGroupQuarterfinals, validatePlayoffCalendar } from "./playoff-qualification";
import { ruleDraftSchema } from "./schemas";

const groups = (count: number, size: number) => Array.from({ length: count }, (_, i) => ({ id: `g${i}`, teams: Array.from({ length: size }, (_, j) => ({ teamId: `g${i}t${j}`, rank: j + 1, unresolved: null })) }));

test("reparte ocho lugares por igual entre uno, dos, cuatro u ocho grupos", () => {
  for (const count of [1, 2, 4, 8]) {
    const result = qualifyForPlayoffs(groups(count, 8));
    assert.equal(result.ok, true);
    if (result.ok) { assert.equal(result.placesPerGroup, 8 / count); assert.equal(result.qualified.length, 8); }
  }
});

test("rechaza grupos no admitidos o con equipos insuficientes", () => {
  assert.deepEqual(qualifyForPlayoffs(groups(3, 8)), { ok: false, code: "UNSUPPORTED_GROUP_COUNT" });
  assert.deepEqual(qualifyForPlayoffs(groups(2, 3)), { ok: false, code: "INSUFFICIENT_TEAMS" });
});

test("no clasifica equipos ante empate sin resolver o resultados duplicados", () => {
  const tied = groups(2, 4); tied[0].teams[3].rank = null as unknown as number;
  assert.deepEqual(qualifyForPlayoffs(tied), { ok: false, code: "UNRESOLVED_STANDINGS" });
  const duplicate = groups(2, 4); duplicate[1].teams[0].teamId = duplicate[0].teams[0].teamId;
  assert.deepEqual(qualifyForPlayoffs(duplicate), { ok: false, code: "DUPLICATE_GROUP_OR_TEAM" });
});

test("cada ronda admite un partido o ida y vuelta y suma las fechas necesarias", () => {
  const format = playoffFormatSchema.parse({ quarterfinals: "HOME_AND_AWAY", semifinals: "HOME_AND_AWAY", final: "SINGLE" });
  assert.equal(playoffDatesRequired(format), 5);
  assert.equal(playoffDatesRequired({ quarterfinals: "SINGLE", semifinals: "SINGLE", final: "SINGLE" }), 3);
  assert.equal(playoffFormatSchema.safeParse({ ...format, final: "OTHER" }).success, false);
});

test("el desempate elegido aplica antes de la final; la final requiere penales", () => {
  const format = { quarterfinals: "SINGLE", semifinals: "SINGLE", final: "HOME_AND_AWAY" };
  assert.equal(playoffRulesSchema.safeParse({ format, preliminaryTiebreaker: "STANDING_POSITION" }).success, true);
  assert.equal(playoffRulesSchema.safeParse({ format, preliminaryTiebreaker: "OTHER" }).success, false);
  assert.deepEqual(tiedPlayoffResolution("QUARTERFINAL", "STANDING_POSITION", 1, 4), { kind: "ADVANCES", side: "FIRST" });
  assert.deepEqual(tiedPlayoffResolution("SEMIFINAL", "PENALTIES", 1, 4), { kind: "PENALTIES" });
  assert.deepEqual(tiedPlayoffResolution("FINAL", "STANDING_POSITION", 1, 4), { kind: "PENALTIES" });
  assert.deepEqual(tiedPlayoffResolution("SEMIFINAL", "STANDING_POSITION", 1, 1), { kind: "PENALTIES" });
  assert.deepEqual(tiedPlayoffResolution("SEMIFINAL", "STANDING_POSITION", null, 1), { kind: "POSITION_UNRESOLVED" });
});

test("cuartos de dos grupos cruzan 1 contra 2 y 3 contra 4 del otro grupo", () => {
  assert.deepEqual(twoGroupQuarterfinals(groups(2, 4)), { ok: true, pairings: [
    ["g0t0", "g1t1"], ["g1t0", "g0t1"], ["g0t2", "g1t3"], ["g1t2", "g0t3"],
  ] });
});

test("tabla general cruza el primer lugar contra el octavo y conserva las llaves", () => {
  assert.deepEqual(singleGroupQuarterfinals(groups(1, 8)), { ok: true, pairings: [
    ["g0t0", "g0t7"], ["g0t3", "g0t4"], ["g0t1", "g0t6"], ["g0t2", "g0t5"],
  ] });
});

test("sorteo de cuatro u ocho grupos enfrenta grupos diferentes y las semifinales conservan las llaves", () => {
  const four = drawQuarterfinals(groups(4, 2), ["g0", "g2", "g1", "g3"]);
  assert.deepEqual(four, { ok: true, pairings: [["g0t0", "g2t1"], ["g2t0", "g0t1"], ["g1t0", "g3t1"], ["g3t0", "g1t1"]] });
  const eight = drawQuarterfinals(groups(8, 1), ["g0", "g1", "g2", "g3", "g4", "g5", "g6", "g7"]);
  assert.equal(eight.ok && eight.pairings.length, 4);
  assert.deepEqual(drawQuarterfinals(groups(4, 2), ["g0", "g0", "g1", "g2"]), { ok: false, code: "INVALID_DRAW" });
  assert.deepEqual(semifinalBracket(["a", "b", "c", "d"]), { ok: true, pairings: [["a", "b"], ["c", "d"]] });
  assert.deepEqual(semifinalBracket(["a", "a", "c", "d"]), { ok: false, code: "INVALID_WINNERS" });
});

test("fechas regulares y de liguilla caben dentro del torneo y respetan el fin de fase regular", () => {
  const format = { quarterfinals: "HOME_AND_AWAY", semifinals: "SINGLE", final: "SINGLE" } as const;
  const window = (date: string) => ({ start: date, end: date });
  const input = { season: { start: "2030-01-01", end: "2030-06-30" }, regularDeadline: "2030-05-31", regularDays: [window("2030-01-06"), window("2030-05-31")], playoffDays: ["2030-06-01", "2030-06-08", "2030-06-15", "2030-06-30"].map(window), format };
  assert.equal(validatePlayoffCalendar(input).ok, true);
  assert.equal(validatePlayoffCalendar({ ...input, playoffDays: input.playoffDays.slice(0, 3) }).code, "PLAYOFF_DATE_COUNT");
  assert.equal(validatePlayoffCalendar({ ...input, regularDays: [window("2030-06-01")] }).code, "REGULAR_DATES_OUTSIDE_WINDOW");
  assert.equal(validatePlayoffCalendar({ ...input, playoffDays: [window("2030-05-31"), ...input.playoffDays.slice(1)] }).code, "PLAYOFF_DATES_OUTSIDE_WINDOW");
  assert.equal(validatePlayoffCalendar({ ...input, playoffDays: [...input.playoffDays.slice(0, 3), window("2030-07-01")] }).code, "PLAYOFF_DATES_OUTSIDE_WINDOW");
  assert.equal(validatePlayoffCalendar({ ...input, playoffDays: [input.playoffDays[0], input.playoffDays[0], ...input.playoffDays.slice(2)] }).code, "PLAYOFF_DATES_OUTSIDE_WINDOW");
});

test("el reglamento acepta liguilla opcional sin alterar reglamentos anteriores", () => {
  const base = { expectedSeasonVersion: 1, reason: "Configuración", announcement: "Reglamento", points: { win: 3, draw: 1, loss: 0 }, tieBreakers: ["GOAL_DIFFERENCE"], calendar: { rounds: 1, matchDurationMinutes: 90 } };
  assert.equal(ruleDraftSchema.safeParse(base).success, true);
  const playoff = { regularDeadline: "2030-05-31", format: { quarterfinals: "SINGLE", semifinals: "HOME_AND_AWAY", final: "SINGLE" }, preliminaryTiebreaker: "PENALTIES" };
  assert.equal(ruleDraftSchema.safeParse({ ...base, calendar: { ...base.calendar, playoff } }).success, true);
  assert.equal(ruleDraftSchema.safeParse({ ...base, calendar: { ...base.calendar, playoff: { ...playoff, regularDeadline: "2030-02-30" } } }).success, false);
});

test("el cuadro propuesto conserva el camino de cuartos a semifinales y final", () => {
 const bracket = proposePlayoffBracket(groups(2, 4));
 assert.ok(bracket.ok);
 assert.deepEqual(bracket.rounds.quarterfinals.map(q => q.winnerTo), [1, 1, 2, 2]);
 assert.deepEqual(bracket.rounds.semifinals.map(s => s.sources), [[1, 2], [3, 4]]);
 assert.deepEqual(bracket.rounds.final.sources, [1, 2]);
 assert.equal(proposePlayoffBracket(groups(4, 2)).ok, false);
 assert.equal(proposePlayoffBracket(groups(4, 2), ["g0", "g1", "g2", "g3"]).ok, true);
});

test("asocia las fechas con cada vuelta de la ronda configurada", () => {
 const format={quarterfinals:"HOME_AND_AWAY",semifinals:"SINGLE",final:"HOME_AND_AWAY"} as const;
 const dates=["2030-06-01","2030-06-08","2030-06-15","2030-06-22","2030-06-29"];
 assert.deepEqual(playoffRoundDates(format,dates),{ok:true,dates:{quarterfinals:dates.slice(0,2),semifinals:dates.slice(2,3),final:dates.slice(3)}});
 assert.deepEqual(playoffRoundDates(format,[dates[0],dates[0],...dates.slice(2)]),{ok:false,code:"INVALID_PLAYOFF_DATES"});
});

test("el mejor puesto es local en partido único y cierra en casa en ida y vuelta", () => {
 const first={teamId:"a",rank:3},second={teamId:"b",rank:1};
 assert.deepEqual(playoffHomeOrder(first,second,"SINGLE"),{ok:true,matches:[{home:"b",away:"a"}]});
 assert.deepEqual(playoffHomeOrder(first,second,"HOME_AND_AWAY"),{ok:true,matches:[{home:"a",away:"b"},{home:"b",away:"a"}]});
 assert.deepEqual(playoffHomeOrder(first,{teamId:"b",rank:3},"SINGLE"),{ok:false,code:"HOME_TEAM_UNDECIDED"});
});

test("avance exige resultados oficiales y suma las dos localías sin inventar penales", () => {
 const a={teamId:"a",rank:1},b={teamId:"b",rank:2};
 const leg={home:"a",away:"b",homeScore:2,awayScore:0,matchStatus:"FINISHED",resultSource:"MATCH_REPORT",reportStatus:"CONFIRMED",reportConfirmed:true};
 const second={...leg,home:"b",away:"a",homeScore:1,awayScore:0};
 assert.deepEqual(resolvePlayoffWinner(a,b,"QUARTERFINAL","HOME_AND_AWAY","PENALTIES",[leg,second]),{ok:true,winnerId:"a"});
 assert.deepEqual(resolvePlayoffWinner(a,b,"QUARTERFINAL","HOME_AND_AWAY","PENALTIES",[leg]),{ok:false,code:"LEGS_INCOMPLETE"});
 assert.deepEqual(resolvePlayoffWinner(a,b,"QUARTERFINAL","SINGLE","PENALTIES",[{...leg,reportConfirmed:false}]),{ok:false,code:"OFFICIAL_RESULTS_INCOMPLETE"});
 const tie={...leg,homeScore:1,awayScore:1};
 assert.deepEqual(resolvePlayoffWinner(a,b,"SEMIFINAL","SINGLE","STANDING_POSITION",[tie]),{ok:true,winnerId:"a"});
 assert.deepEqual(resolvePlayoffWinner(a,b,"FINAL","SINGLE","STANDING_POSITION",[tie]),{ok:false,code:"PENALTIES_REQUIRED"});
 const absentHome={...leg,homeScore:0,awayScore:1,resultSource:"DEFAULT",offendingTeamId:"a"};
 const absentAway={...leg,homeScore:1,awayScore:0,resultSource:"DEFAULT",offendingTeamId:"b"};
 assert.deepEqual(resolvePlayoffWinner(a,b,"FINAL","SINGLE","PENALTIES",[absentHome]),{ok:true,winnerId:"b"});
 assert.deepEqual(resolvePlayoffWinner(a,b,"QUARTERFINAL","SINGLE","PENALTIES",[absentAway]),{ok:true,winnerId:"a"});
 assert.deepEqual(resolvePlayoffWinner(a,b,"QUARTERFINAL","SINGLE","PENALTIES",[{...absentHome,offendingTeamId:"b"}]),{ok:false,code:"OFFICIAL_RESULTS_INCOMPLETE"});
});
