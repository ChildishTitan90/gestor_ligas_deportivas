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
  const click=async label=>{
    await wait(`[...document.querySelectorAll('button')].some(b=>b.getClientRects().length&&!b.disabled&&b.textContent.trim()===${JSON.stringify(label)})`);
    await ev(`[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&!b.disabled&&b.textContent.trim()===${JSON.stringify(label)}).click()`);
  };
  const local=`new Promise((resolve,reject)=>{const r=indexedDB.open('league-match-reports-v1');r.onsuccess=()=>{const db=r.result;const tx=db.transaction('reports');const q=tx.objectStore('reports').get([${JSON.stringify(actorId)},${JSON.stringify(match)}]);q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close()};r.onerror=()=>reject(Error('IDB'))})`;
  try {
    for(const [name,value] of account.cookies) await browser.command('Network.setCookie',{name,value,url:base});
    await browser.command('Page.navigate',{url:`${base}/matches/${match}/report`});
    await click('Aceptar y preparar');
    await wait(`(async()=>Boolean((await ${local})?.prepared))()`);
    await click('Capturar cédula');
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
    await browser.command('Page.navigate',{url:`${base}/offline/report?match=${match}`});
    await wait("document.querySelector('[data-report-workspace]') && document.body.innerText.includes('No presentado')");
    const reopened=await ev(local);
    assert.equal(reopened.data.report.noShow.notes,stored.data.report.noShow.notes);
    assert.equal(reopened.data.match.status.code,'NO_SHOW');
    assert.equal(reopened.lastReceipt.receipt.operationId,stored.lastReceipt.receipt.operationId);
    console.log('Cédula preparada: incomparecencia con conexión, acuse y reapertura local: OK');
  } finally { await browser.close(); }
}
