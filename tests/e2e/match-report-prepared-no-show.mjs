import assert from 'node:assert/strict';
import { Browser } from '../integration/auth.test.mjs';
import { launchChrome } from './chrome-session.mjs';
import { waitForReportBrowser } from './match-report-browser-wait.mjs';

// Con sesión, IndexedDB, red y PostgreSQL reales; todos los datos son sintéticos.
export async function verifyPreparedNoShowBrowser({base,match,db,actorId}) {
  const account=new Browser(base);
  await account.login('arbitro@example.test','Arbitraje-Local-141!');
  const browser=await launchChrome(base+'/login');
  const ev=expression=>browser.evaluate(expression);
  const wait=expression=>waitForReportBrowser(ev,expression);
  const enabledButton=label=>`[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&!b.disabled&&b.textContent.trim()===${JSON.stringify(label)})`;
  const click=label=>wait(`(()=>{const button=${enabledButton(label)};if(!button)return false;button.click();return true})()`);
  const local=`new Promise((resolve,reject)=>{const r=indexedDB.open('league-match-reports-v1');r.onsuccess=()=>{const db=r.result;const tx=db.transaction('reports');const q=tx.objectStore('reports').get([${JSON.stringify(actorId)},${JSON.stringify(match)}]);q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close()};r.onerror=()=>reject(Error('IDB'))})`;
  try {
    for(const [name,value] of account.cookies) await browser.command('Network.setCookie',{name,value,url:base});
    await browser.command('Page.navigate',{url:`${base}/matches/${match}/report`});
    await click('Aceptar y preparar');
    await wait(`(async()=>Boolean((await ${local})?.prepared))()`);
    await click('Capturar cédula');
    await wait(enabledButton('Sincronizar'));
    assert.equal(await ev('navigator.onLine'),true);
    await wait("document.getElementById('no-show-team')");
    await ev("document.getElementById('no-show-team').click()");
    await wait("document.querySelector('[role=option][data-value=HOME]')");
    await ev("document.querySelector('[role=option][data-value=HOME]').click()");
    await ev("(()=>{const field=document.getElementById('no-show-notes');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Ausencia registrada desde copia preparada');field.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await click('Registrar incomparecencia');
    await click('Confirmar registro');
    await wait(`(async()=>{const r=await ${local};return r?.data.match.status.code==='NO_SHOW' && !r.pending.length && r.lastReceipt?.receipt.matchVersion===r.data.match.version})()`);
    const stored=await ev(local);
    assert.equal(stored.data.report.noShow.absent,'HOME');
    assert.equal(stored.data.report.noShow.notes,'Ausencia registrada desde copia preparada');
    assert.equal(stored.data.match.status.captureAllowed,false);
    assert.equal(stored.serverMatchStatus,'NO_SHOW');
    assert.equal((await db.query("SELECT s.code FROM sports_management.matches m JOIN sports_management.match_statuses s ON s.id=m.status_id WHERE m.id=$1",[match])).rows[0].code,'NO_SHOW');
    // Hold the server reference read that starts when the prepared copy opens.
    // A slower response must not leave confirmation enabled during that sync.
    let referenceRequestId;
    const pauseReference=event=>{
      const message=JSON.parse(event.data);
      if(message.method==='Fetch.requestPaused') referenceRequestId=message.params.requestId;
    };
    browser.socket.addEventListener('message',pauseReference);
    await browser.command('Fetch.enable',{patterns:[{urlPattern:`${base}/api/match-reports/${match}`,requestStage:'Response'}]});
    await browser.command('Page.navigate',{url:`${base}/offline/report?match=${match}`});
    await wait("document.querySelector('[data-report-workspace]') && document.body.innerText.includes('No presentado')");
    await waitForReportBrowser(()=>Boolean(referenceRequestId),'consulta de referencia al reabrir la copia');
    const confirmationButton="[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Confirmar resultado por incomparecencia')";
    assert.equal(await ev(`${confirmationButton}?.disabled`),true,'Confirmación bloqueada mientras se sincroniza al abrir');
    await browser.command('Fetch.continueResponse',{requestId:referenceRequestId});
    await browser.command('Fetch.disable');
    browser.socket.removeEventListener('message',pauseReference);
    const reopened=await ev(local);
    assert.equal(reopened.data.report.noShow.notes,stored.data.report.noShow.notes);
    assert.equal(reopened.data.match.status.code,'NO_SHOW');
    assert.equal(reopened.lastReceipt.receipt.operationId,stored.lastReceipt.receipt.operationId);
    const scope=(await db.query(`SELECT m.season_id,g.season_category_id,c.competition_rule_id,r.approved_by FROM sports_management.matches m JOIN sports_management.groups g ON g.id=m.group_id JOIN sports_management.season_categories c ON c.id=g.season_category_id JOIN sports_management.competition_rules r ON r.id=c.competition_rule_id WHERE m.id=$1`,[match])).rows[0];
    const rule=(await db.query('INSERT INTO sports_management.competition_rules(season_id,version_number) SELECT $1,coalesce(max(version_number),0)+1 FROM sports_management.competition_rules WHERE season_id=$1 RETURNING id',[scope.season_id])).rows[0].id;
    await db.query('INSERT INTO sports_management.competition_rule_parameters(competition_rule_id,parameter_key,parameter_value,validated_by,requires_validation) SELECT $1,parameter_key,parameter_value,validated_by,false FROM sports_management.competition_rule_parameters WHERE competition_rule_id=$2',[rule,scope.competition_rule_id]);
    for(const [key,value] of Object.entries({points:{win:3,draw:1,loss:0},tieBreakers:['GOAL_DIFFERENCE','GOALS_FOR']})) await db.query('INSERT INTO sports_management.competition_rule_parameters(competition_rule_id,parameter_key,parameter_value,validated_by,requires_validation) VALUES($1,$2,$3,$4,false)',[rule,key,JSON.stringify(value),scope.approved_by]);
    await db.query("UPDATE sports_management.competition_rules SET status='APPROVED',approved_by=$2,approved_at=now() WHERE id=$1",[rule,scope.approved_by]);
    await db.query('UPDATE sports_management.season_categories SET competition_rule_id=$2 WHERE id=$1',[scope.season_category_id,rule]);
    // Simula un acuse perdido después del commit; al reabrir se reenvía la
    // misma intención, sin duplicar resultado ni descartar el acuse anterior.
    let interceptedStatus;
    const intercept=event=>{
      const message=JSON.parse(event.data);
      if(message.method!=='Fetch.requestPaused') return;
      interceptedStatus=message.params.responseStatusCode;
      void browser.command('Fetch.failRequest',{requestId:message.params.requestId,errorReason:'ConnectionReset'});
    };
    browser.socket.addEventListener('message',intercept);
    await browser.command('Fetch.enable',{patterns:[{urlPattern:`${base}/api/match-reports/${match}/confirm-no-show`,requestStage:'Response'}]});
    await click('Confirmar resultado por incomparecencia');
    await click('Confirmar resultado');
    await wait('document.body.innerText.includes("No llegó el acuse")');
    assert.equal(interceptedStatus,200,'Se pierde el acuse de una confirmación aplicada');
    const unacknowledged=await ev(local);
    assert.ok(unacknowledged.noShowConfirmation?.operationId,'La intención se guardó antes de enviar la confirmación');
    assert.ok(!unacknowledged.noShowConfirmation.receipt,'La intención sigue pendiente de acuse');
    await browser.command('Fetch.disable');browser.socket.removeEventListener('message',intercept);
    await browser.command('Page.navigate',{url:`${base}/offline/report?match=${match}`});
    await wait(`(async()=>{const r=await ${local};return r?.data.match.status.code==='FINISHED' && r.data.report.status==='CONFIRMED' && Boolean(r.noShowConfirmation?.receipt)})()`);
    const confirmed=await ev(local);
    assert.equal(confirmed.noShowConfirmation.operationId,unacknowledged.noShowConfirmation.operationId,'Recupera la misma intención');
    assert.equal(confirmed.data.report.noShow.notes,stored.data.report.noShow.notes);
    assert.equal(confirmed.lastReceipt.receipt.operationId,stored.lastReceipt.receipt.operationId,'conserva el acuse del registro');
    assert.deepEqual(confirmed.data.report.score,{home:0,away:1});
    const official=(await db.query("SELECT s.code,r.home_score,r.away_score,r.source,m.away_team_id FROM sports_management.matches m JOIN sports_management.match_statuses s ON s.id=m.status_id JOIN sports_management.match_results r ON r.match_id=m.id WHERE m.id=$1",[match])).rows[0];
    assert.deepEqual([official.code,official.home_score,official.away_score,official.source],['FINISHED',0,1,'DEFAULT']);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.standing_entries e JOIN sports_management.standing_versions v ON v.id=e.standing_version_id WHERE v.competition_rule_id=$1 AND e.season_team_id=$2 AND e.points=3',[rule,official.away_team_id])).rows[0].n,1);
    await browser.command('Page.navigate',{url:`${base}/offline/report?match=${match}`});
    await wait("document.querySelector('[data-report-workspace]') && document.body.innerText.includes('Finalizado')");
    const final=await ev(local);
    assert.equal(final.noShowConfirmation.receipt.matchVersion,confirmed.noShowConfirmation.receipt.matchVersion);
    assert.equal(final.lastReceipt.receipt.operationId,stored.lastReceipt.receipt.operationId);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.match_results WHERE match_id=$1',[match])).rows[0].n,1);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.match_report_syncs WHERE match_report_id=$1 AND private_payload->'command'->>'kind'='confirm-no-show'",[confirmed.data.report.id])).rows[0].n,1);
    console.log('Cédula preparada: registro, cierre oficial, clasificación y reapertura sin duplicados: OK');
  } finally { await browser.close(); }
}
