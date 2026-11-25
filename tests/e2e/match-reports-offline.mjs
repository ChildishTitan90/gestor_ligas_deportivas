import assert from "node:assert/strict";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { launchChrome } from "./chrome-session.mjs";
import { captureReportCaptainSignatures } from "./report-signature-browser.mjs";
import { waitForReportBrowser } from "./match-report-browser-wait.mjs";
import { Browser } from "../integration/auth.test.mjs";
import { createHash } from "node:crypto";
const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Actual NextAuth, PostgreSQL, IndexedDB and Service Worker. CDP cuts transport,
// pauses an actual response, and closes the tab. Business responses stay real.
export async function verifyOfflineReportBrowser({ base, match, db, actorId }) {
  const postgres = process.argv.find(arg => arg.startsWith('--postgres='))?.split('=')[1] ?? '15';
  const directory = `.codex-attachments/pdgld19-20/pg${postgres}`;
  await mkdir(directory,{recursive:true});
  await rm(`${directory}/browser.json`,{force:true});
  await rm(`${directory}/failure.json`,{force:true});
  const account = new Browser(base);
  await account.login("arbitro@example.test", "Arbitraje-Local-141!");
  const browser = await launchChrome(base + "/login");
  let page = browser;
  let replacement;
  let observer;
  let security;
  let criterion = "preparation";
  const ev = expression => page.evaluate(expression);
  const wait = expression => waitForReportBrowser(ev, expression);
  async function click(label, scope = "document") {
    await wait(`(${scope}) && [...${scope}.querySelectorAll('button,a')].some(b=>b.getClientRects().length&&!b.disabled&&(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}))`);
    await ev(`[...${scope}.querySelectorAll('button,a')].find(b=>b.getClientRects().length&&!b.disabled&&(b.textContent.trim()===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)})).click()`);
  }
  async function open() {
    await page.command("Page.navigate", { url: base + "/offline/report?match=" + match });
    await wait("document.querySelector('[data-report-workspace]')");
    await click("Capturar cédula"); await click("Cierre y firmas");
  }
  async function edit(text) {
    await ev(`(()=>{const field=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(text)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait("document.querySelector('[aria-label=\"Guardado y sincronización\"]').innerText.includes('Guardado en este dispositivo')");
  }
  const local = `new Promise((resolve,reject)=>{const r=indexedDB.open('league-match-reports-v1');r.onsuccess=()=>{const db=r.result;const tx=db.transaction('reports');const q=tx.objectStore('reports').get([${JSON.stringify(actorId)},${JSON.stringify(match)}]);q.onsuccess=()=>resolve(q.result);tx.oncomplete=()=>db.close()};r.onerror=()=>reject(Error('IDB'))})`;
  try {
    for (const [name, value] of account.cookies) await browser.command("Network.setCookie", { name, value, url: base });
    await page.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await page.command("Page.navigate", { url: base + "/matches" });
    await wait("document.readyState==='complete'&&document.body?.innerText.includes('Preparar para usar sin conexión')");
    await ev("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    // Lose the snapshot response after the authorized server read. An incomplete
    // preparation must never expose the capture link or publish a local report.
    const interruptPreparation = event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Fetch.requestPaused') void page.command('Fetch.failRequest', {requestId:message.params.requestId,errorReason:'ConnectionReset'});
    };
    page.socket.addEventListener('message', interruptPreparation);
    await page.command('Fetch.enable', {patterns:[{urlPattern:'*api/v1/match-reports/prepare',requestStage:'Response'}]});
    await click('Preparar para usar sin conexión', `document.querySelector('[data-report-match="${match}"]')`); await click('Aceptar y preparar');
    await wait("document.querySelector('dialog[open]')?.innerText.includes('Preparación incompleta')");
    assert.equal(Boolean(await ev(local)), false);
    assert.equal(await ev(`document.querySelector('[data-report-match="${match}"] a[href$="/report"]') !== null`), false);
    await page.command('Fetch.disable'); page.socket.removeEventListener('message', interruptPreparation);
    await click('Cancelar');
    criterion = "online-only-without-service-worker";
    await page.command("Page.enable");
    const unavailableWorker = await page.command("Page.addScriptToEvaluateOnNewDocument", {source:"Object.defineProperty(navigator,'serviceWorker',{value:undefined}); Object.defineProperty(crypto,'randomUUID',{value:undefined});"});
    await page.command("Page.navigate",{url:base+"/matches"});
    await wait("document.readyState==='complete' && typeof navigator.serviceWorker==='undefined'");
    await click("Capturar con conexión", `document.querySelector('[data-report-match="${match}"]')`);
    await wait("document.querySelector('[data-report-workspace]') && document.body.innerText.includes('Solo con conexión')");
    await click("Capturar cédula"); await click("Cierre y firmas");
    await ev(`(()=>{const field=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,'Captura sintética solo en línea');field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click("Guardar borrador"); await wait("document.body.innerText.includes('Acuse recibido del servidor')");
    assert.equal((await db.query("SELECT remarks FROM sports_management.match_reports WHERE match_id=$1",[match])).rows[0].remarks,"Captura sintética solo en línea");
    assert.equal(await ev(local),undefined);
    await page.command("Page.removeScriptToEvaluateOnNewDocument",{identifier:unavailableWorker.identifier});
    await page.command("Page.navigate",{url:base+"/matches"});
    criterion = "preparation";
    await click("Preparar para usar sin conexión", `document.querySelector('[data-report-match="${match}"]')`); await click("Aceptar y preparar");
    await wait("!document.querySelector('dialog[open]') && document.body.innerText.includes('Disponible sin conexión')");
    console.log("PDGLD-19 recursos y snapshot preparados con Service Worker e IndexedDB reales");
    criterion = "capture-and-reopen";
    await open();
    await edit("PDGLD19 online primera edición");
    const first = await ev(local);
    assert.ok(first.revision > 0);
    assert.equal(first.data.report.remarks, "PDGLD19 online primera edición");
    await page.command("Network.enable");
    await page.command("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await click("Alineaciones"); await click("Iniciar partido"); await click("Confirmar inicio");
    await wait("document.body.innerText.includes('Primer tiempo')");
    await click("Cierre y firmas");
    await edit("PDGLD19 sin red, pestaña cerrada");
    await click('Eventos'); await click('Registrar evento');
    await wait("document.querySelector('dialog[open] #event-type')");
    // Let the modal finish its initial focus before opening its selector.
    await ev("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    await ev("document.getElementById('event-type').focus();document.getElementById('event-type').click()"); await wait("document.querySelector('[role=listbox]')");
    await ev("[...document.querySelectorAll('[role=option]')].find(o=>/grave/i.test(o.textContent)).click()");
    await ev("(()=>{const t=document.querySelector('#report-event-form textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'Incidente sintético offline PDGLD20');t.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await click('Aplicar evento'); await wait("!document.querySelector('dialog[open]')");
    await click('Cierre y firmas');
    await captureReportCaptainSignatures(page);
    await wait(`(async()=>Object.values((await ${local}).data.report.signatures).filter(Boolean).length===2)()`);
    const retained = await ev(local);
    assert.equal(retained.data.report.remarks, "PDGLD19 sin red, pestaña cerrada");
    assert.ok(retained.prepared);
    assert.ok(retained.data.report.events.some(event=>event.description==='Incidente sintético offline PDGLD20'));
    const before = (await db.query("SELECT version,remarks FROM sports_management.match_reports WHERE match_id=$1", [match])).rows[0];
    assert.notEqual(before.remarks, retained.data.report.remarks);
    console.log("PDGLD-19 primera edición online y segunda edición sin red persistidas; SQL conserva el borrador anterior");

    // A new tab shares this browser's IDB, without reusing the old React tree.
    const target = await browser.command("Target.createTarget", { url: "about:blank" });
    const endpoint = new URL(browser.socket.url);
    const targets = await (await fetch(`http://${endpoint.host}/json/list`)).json();
    const newPage = targets.find(item => item.id === target.targetId);
    replacement = await connectPage(newPage.webSocketDebuggerUrl);
    await replacement.command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await replacement.command("Network.enable");
    await replacement.command("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await replacement.command("Target.closeTarget", { targetId: endpoint.pathname.split("/").at(-1) });
    page = replacement;
    await page.command("Page.bringToFront");
    await open();
    assert.equal(await ev("document.querySelector('textarea').value"), retained.data.report.remarks);
    assert.equal((await ev(local)).draftId, retained.draftId);
    assert.deepEqual((await ev(local)).data.report.clock, retained.data.report.clock);
    assert.equal(fingerprint((await ev(local)).data.report), fingerprint(retained.data.report), 'All saved fields, lineups, events, score and signatures survive reopening');
    assert.equal(await ev("document.documentElement.scrollWidth<=innerWidth"), true);
    console.log("PDGLD-19 pestaña cerrada y cédula restaurada desde IndexedDB sin red");
    // Drop one real signature upload response after its durable server work.
    let lostUpload = false;
    const uploadListener = event => {
      const message=JSON.parse(event.data);
      if(message.method!=='Fetch.requestPaused') return;
      const fail=!lostUpload && message.params.request.method==='POST';
      if(fail) lostUpload=true;
      void page.command(fail?'Fetch.failRequest':'Fetch.continueRequest',{requestId:message.params.requestId,...(fail?{errorReason:'ConnectionReset'}:{})});
    };
    page.socket.addEventListener('message',uploadListener);
    await page.command('Fetch.enable',{patterns:[{urlPattern:'*signatures',requestStage:'Response'}]});
    await page.command("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await wait("document.body.innerText.includes('No se recibió el acuse')");
    const interrupted = await ev(local);
    assert.ok(lostUpload && interrupted.pending.length);
    const uploadIds = interrupted.pending.flatMap(item=>item.attempt.uploads.map(upload=>upload.operationId));
    await page.command('Fetch.disable'); page.socket.removeEventListener('message',uploadListener);
    await click('Sincronizar');
    await wait(`(async()=>{const row=await ${local};return row.acknowledgedRevision===${retained.revision}&&!row.pending.length})()`);
    const restored = await ev(local);
    assert.equal(restored.acknowledgedRevision, retained.revision);
    assert.ok(uploadIds.length>0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.files WHERE uploaded_by=$1 AND original_name='firma-capitan.png'",[actorId])).rows[0].n,2);
    assert.equal((await db.query("SELECT remarks FROM sports_management.match_reports WHERE match_id=$1", [match])).rows[0].remarks, retained.data.report.remarks);
    assert.equal((await db.query("SELECT draft_data->'clock'->>'phaseStartedAt' AS started FROM sports_management.match_reports WHERE match_id=$1", [match])).rows[0].started, retained.data.report.clock.phaseStartedAt);
    console.log("PDGLD-20 borrador sincronizado con acuse real en PostgreSQL");
    criterion = "prepared-online-clock-lost-receipt";
    await click("Alineaciones");
    let lostClock = false;
    const clockListener = event => {
      const message = JSON.parse(event.data);
      if (message.method !== "Fetch.requestPaused") return;
      const fail = !lostClock && message.params.request.method === "POST";
      if (fail) lostClock = true;
      void page.command(fail ? "Fetch.failRequest" : "Fetch.continueRequest", { requestId: message.params.requestId, ...(fail ? {errorReason:"ConnectionReset"} : {}) });
    };
    await ev("window.originalClockDate=Date; window.Date=class extends window.originalClockDate { constructor(...args){super(...(args.length?args:[window.originalClockDate.now()-120000]));} static now(){return window.originalClockDate.now()-120000;} };");
    page.socket.addEventListener("message", clockListener);
    await page.command("Fetch.enable",{patterns:[{urlPattern:base+"/api/match-reports/"+match,requestStage:"Response"}]});
    try {
      await click("Terminar tiempo"); await click("Confirmar fin del tiempo");
      await wait("document.body.innerText.includes('No se recibió el acuse')");
    } finally {
      await ev("window.Date=window.originalClockDate; delete window.originalClockDate;");
      await page.command("Fetch.disable"); page.socket.removeEventListener("message", clockListener);
    }
    assert.equal(lostClock,true);
    const clockIntent=(await ev(local)).pending[0];
    const committedClock=(await db.query("SELECT draft_data->'clock' AS clock FROM sports_management.match_reports WHERE match_id=$1",[match])).rows[0].clock;
    assert.equal(committedClock.boundarySources.firstEndedAt,"server");
    assert.ok(Date.parse(committedClock.boundaries.firstEndedAt)-Date.parse(clockIntent.operation.occurredAt)>100000);
    await page.command("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
    await click("Ajustar descanso");
    await ev("(()=>{const field=document.querySelector('dialog[open] input[type=number]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(field,'17');field.dispatchEvent(new Event('input',{bubbles:true}));})()");
    await click("Confirmar descanso");
    await wait(`(async()=>(await ${local}).pending.length===2)()`);
    const laterClockIntent=(await ev(local)).pending[1];
    assert.equal(fingerprint((await ev(local)).pending[0]),fingerprint(clockIntent));
    await page.command("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await wait(`(async()=>!(await ${local}).pending.length)()`);
    const acknowledgedClock=await ev(local);
    assert.equal(acknowledgedClock.lastReceipt.receipt.operationId,laterClockIntent.operation.id);
    assert.equal(acknowledgedClock.data.report.clock.boundarySources.firstEndedAt,"server");
    assert.deepEqual(acknowledgedClock.data.report.clock.boundaries,committedClock.boundaries);
    assert.equal(acknowledgedClock.data.report.clock.breakMinutes,17,"El acuse anterior conserva la acción posterior del reloj");
    assert.equal((await db.query("SELECT count(*)::int AS n FROM sports_management.match_report_syncs WHERE client_id=$1",[clockIntent.operation.id])).rows[0].n,1);
    // A new connected clock action keeps its first-send path while an earlier
    // save is awaiting its real receipt. Delaying the save must not downgrade it.
    await click("Cierre y firmas"); await edit("Guardado previo al segundo tiempo conectado");
    let beforeClockReceipt;
    const beforeClockListener=event=>{
      const message=JSON.parse(event.data);
      if(message.method!=="Fetch.requestPaused")return;
      if(message.params.request.method==="POST")beforeClockReceipt=message.params.requestId;
      else void page.command("Fetch.continueRequest",{requestId:message.params.requestId});
    };
    page.socket.addEventListener("message",beforeClockListener);
    await page.command("Fetch.enable",{patterns:[{urlPattern:"*api/v1/match-reports/sync",requestStage:"Response"}]});
    try {
      await click("Sincronizar");
      for(let attempt=0;!beforeClockReceipt&&attempt<300;attempt++)await new Promise(resolve=>setTimeout(resolve,100));
      assert.ok(beforeClockReceipt,"El guardado está confirmado en SQL y espera su respuesta");
      await click("Alineaciones");
      await click("Iniciar segundo tiempo"); await click("Confirmar segundo tiempo");
      await wait(`(async()=>(await ${local}).pending.length===2)()`);
      await page.command("Fetch.continueRequest",{requestId:beforeClockReceipt});
    } finally {
      await page.command("Fetch.disable"); page.socket.removeEventListener("message",beforeClockListener);
    }
    await wait(`(async()=>{const row=await ${local}; return !row.pending.length&&row.data.report.clock?.boundarySources?.secondStartedAt==='server'})()`);
    await click("Cierre y firmas");
    criterion = "lost-commit-and-late-receipt";

    await edit('PDGLD20 commit con respuesta perdida');
    let lostCommit=false;
    const commitListener=event=>{
      const message=JSON.parse(event.data);
      if(message.method!=='Fetch.requestPaused')return;
      const fail=!lostCommit && message.params.request.method==='POST';
      if(fail)lostCommit=true;
      void page.command(fail?'Fetch.failRequest':'Fetch.continueRequest',{requestId:message.params.requestId,...(fail?{errorReason:'ConnectionReset'}:{})});
    };
    page.socket.addEventListener('message',commitListener);
    await page.command('Fetch.enable',{patterns:[{urlPattern:'*api/v1/match-reports/sync',requestStage:'Response'}]});
    await click('Sincronizar'); await wait("document.body.innerText.includes('No se recibió el acuse')");
    const uncertain=await ev(local); const intent=uncertain.pending[0];
    assert.ok(lostCommit && intent);
    const eventsBeforeReplay=(await db.query('SELECT count(*)::int AS n FROM sports_management.match_events WHERE match_report_id=(SELECT id FROM sports_management.match_reports WHERE match_id=$1)',[match])).rows[0].n;
    const post=command=>account.request('/api/v1/match-reports/sync',{method:'POST',headers:{origin:base,'Content-Type':'application/json','X-Expected-Actor-Id':actorId},body:JSON.stringify(command)});
    const replay=await post(intent.attempt.command); assert.equal(replay.status,200); const replayReceipt=await replay.json();
    const changed=await post({...intent.attempt.command,draft:{...intent.attempt.command.draft,remarks:'UUID reutilizado con contenido distinto'}});
    assert.equal(changed.status,409); assert.equal((await changed.json()).code,'OPERATION_KEY_REUSED');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.match_report_syncs WHERE client_id=$1',[intent.operation.id])).rows[0].n,1);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.match_events WHERE match_report_id=(SELECT id FROM sports_management.match_reports WHERE match_id=$1)',[match])).rows[0].n,eventsBeforeReplay);
    await page.command('Fetch.disable'); page.socket.removeEventListener('message',commitListener);
    await open(); // Opening online recovers the committed operation, without Save.
    await wait(`(async()=>!(await ${local}).pending.length)()`);
    assert.equal(fingerprint((await ev(local)).lastReceipt.receipt),fingerprint(replayReceipt));

    await edit("PDGLD20 revisión enviada");
    let paused;
    const listener = event => {
      const message = JSON.parse(event.data);
      if (message.method !== "Fetch.requestPaused") return;
      if (message.params.request.method === "POST") paused = message.params.requestId;
      else void page.command("Fetch.continueRequest", { requestId: message.params.requestId });
    };
    page.socket.addEventListener("message", listener);
    await page.command("Fetch.enable", { patterns: [{ urlPattern: "*api/v1/match-reports/sync", requestStage: "Response" }] });
    await click("Sincronizar");
    for (let attempt = 0; !paused && attempt < 300; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(paused, "Se pausa el acuse real después de la escritura SQL");
    const observerTarget = await page.command("Target.createTarget", { url: base + "/offline/report?match=" + match });
    const observerTargets = await (await fetch(`http://${endpoint.host}/json/list`)).json();
    observer = await connectPage(observerTargets.find(item => item.id === observerTarget.targetId).webSocketDebuggerUrl);
    await page.command("Page.bringToFront");
    await edit("PDGLD20 revisión posterior al envío");
    const later = await ev(local);
    await page.command("Fetch.continueRequest", { requestId: paused });
    await wait("!document.body.innerText.includes('Consultando acuse y sincronizando…')");
    await page.command("Fetch.disable"); page.socket.removeEventListener("message", listener);
    const late = await ev(local);
    assert.equal(late.data.report.remarks, later.data.report.remarks);
    assert.ok(late.acknowledgedRevision < late.revision);
    assert.equal((await db.query("SELECT remarks FROM sports_management.match_reports WHERE match_id=$1", [match])).rows[0].remarks, "PDGLD20 revisión enviada");
    await click("Sincronizar");
    await wait(`(async()=>{const row=await ${local};return row.acknowledgedRevision===row.revision})()`);
    assert.equal((await db.query("SELECT remarks FROM sports_management.match_reports WHERE match_id=$1", [match])).rows[0].remarks, later.data.report.remarks);
    const shared = await observer.evaluate(local);
    assert.equal(shared.lastReceipt.revision, later.revision);
    assert.equal(shared.lastReceipt.receipt.operationId, (await ev(local)).lastReceipt.receipt.operationId);
    for (let attempt=0;attempt<100;attempt++) {
      if(await observer.evaluate(`document.querySelector('[aria-label="Guardado y sincronización"]')?.textContent.includes('Acuse de borrador · Revisión ${later.revision}')`)) break;
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.equal(await observer.evaluate(`document.querySelector('[aria-label="Guardado y sincronización"]')?.textContent.includes('Acuse de borrador · Revisión ${later.revision}')`),true,'Both tabs display the acknowledged revision');
    await page.command("Storage.overrideQuotaForOrigin", { origin: base, quotaSize: 1 });
    criterion = "quota-and-session";
    // Chromium caches the bucket's remaining space for 30 seconds. Wait for
    // that quota cache to expire before exercising an actual failing IDB write.
    await new Promise(resolve => setTimeout(resolve, 31000));
    const quotaNote = "PDGLD19 sin espacio " + Array.from({length: 200}, () => crypto.randomUUID()).join("");
    await ev(`(()=>{const field=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(field,${JSON.stringify(quotaNote)});field.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await wait("document.body.innerText.includes('Falta guardar la revisión')");
    assert.equal(await ev("document.querySelector('textarea').value"), quotaNote);
    assert.notEqual((await ev(local)).data.report.remarks, quotaNote);
    await page.command("Storage.overrideQuotaForOrigin", { origin: base });
    await click("Reintentar guardado local");
    await wait(`(async()=>{const row=await ${local};return row.data.report.remarks===${JSON.stringify(quotaNote)}})()`);
    await click("Sincronizar");
    await wait(`(async()=>{const row=await ${local};return row.acknowledgedRevision===row.revision})()`);
    await edit("PDGLD20 sesión vencida conserva intención");
    await page.command("Network.clearBrowserCookies");
    await page.command("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await click("Cerrar sesión");
    await wait("document.querySelector('dialog[open]')?.innerText.includes('Hay cédulas pendientes')");
    await click("Cancelar", "document.querySelector('dialog[open]')");
    await wait("!document.querySelector('dialog[open]')");
    await click("Sincronizar");
    await wait("document.body.innerText.includes('Tu sesión venció')");
    const unauthenticated = await ev(local);
    assert.ok(unauthenticated.pending.length);
    await account.login("arbitro@example.test", "Arbitraje-Local-141!");
    for (const [name, value] of account.cookies) await page.command("Network.setCookie", { name, value, url: base });
    await click("Revisar sesión y acuse");
    await wait(`(async()=>{const row=await ${local};return !row.pending.length&&row.lastReceipt.receipt.operationId===${JSON.stringify(unauthenticated.pending[0].operation.id)}})()`);
    await click("Resumen");
    assert.equal(await ev("[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Solicitar confirmación').disabled"), true);
    const caches = await ev("caches.keys().then(async keys=>(await Promise.all(keys.map(async key=>(await (await caches.open(key)).keys()).map(request=>new URL(request.url).pathname)))).flat())");
    assert.ok(caches.every(path => path === "/offline/report" || path.startsWith("/_next/static/")));
    const foreign=new Browser(base); await foreign.login('ajeno147@example.test','Arbitraje-Local-141!');
    criterion = "authorization-and-rescheduling";
    const original=await ev(local);
    const protectedRead=await foreign.request(`/api/match-reports/${match}`,{headers:{'X-Expected-Actor-Id':actorId}});
    assert.equal(protectedRead.status,403);
    assert.equal(fingerprint((await ev(local)).data),fingerprint(original.data));
    const future=(await db.query("SELECT id FROM sports_management.matches WHERE number='OFFLINE-20'")).rows[0].id;
    const prepare=()=>account.request('/api/v1/match-reports/prepare',{method:'POST',headers:{origin:base,'Content-Type':'application/json','X-Expected-Actor-Id':actorId},body:JSON.stringify({matchId:future})});
    const beforeSchedule=await (await prepare()).json();
    const replacementVenue=(await db.query("INSERT INTO sports_management.venues(league_id,code,name,address,match_duration_minutes) SELECT league_id,'OFFLINE-REPROGRAM','Cancha sintética alternativa',address,match_duration_minutes FROM sports_management.venues WHERE id=(SELECT venue_id FROM sports_management.matches WHERE id=$1) RETURNING id",[future])).rows[0].id;
    await db.query("INSERT INTO sports_management.venue_availability(venue_id,starts_at,ends_at,type) SELECT $2,starts_at,reserved_until,'AVAILABLE' FROM sports_management.matches WHERE id=$1",[future,replacementVenue]);
    // The scheduling writer owns the optimistic version increment. This fixture
    // simulates that committed change; the report endpoint must reject its old snapshot.
    await db.query('UPDATE sports_management.matches SET venue_id=$2,version=version+1 WHERE id=$1',[future,replacementVenue]);
    const afterSchedule=await (await prepare()).json();
    assert.notEqual(afterSchedule.data.match.version,beforeSchedule.data.match.version);
    const staleSchedule=await post({...intent.attempt.command,matchId:future,operationId:crypto.randomUUID(),kind:'lock-lineups',expectedMatchVersion:beforeSchedule.data.match.version,expectedReportVersion:0});
    assert.equal(staleSchedule.status,409); assert.equal((await staleSchedule.json()).code,'STALE_VERSION');
    const reference=await (await account.request(`/api/match-reports/${match}`)).json();
    const officialBefore=(await db.query('SELECT (SELECT count(*) FROM sports_management.match_results) AS results,(SELECT count(*) FROM sports_management.standing_versions) AS standings,(SELECT count(*) FROM sports_management.standing_entries) AS entries,(SELECT COALESCE(sum(points+points_adjustment),0)::text FROM sports_management.standing_entries) AS points,(SELECT count(*) FROM sports_management.disciplinary_cases) AS cases')).rows[0];
    const official=await post({...intent.attempt.command,operationId:crypto.randomUUID(),kind:'confirm',expectedMatchVersion:reference.match.version,expectedReportVersion:reference.report.version,draft:(await db.query('SELECT draft_data FROM sports_management.match_reports WHERE match_id=$1',[match])).rows[0].draft_data.draft});
    assert.equal(reference.confirmation.available,true);
    assert.equal(official.status,409); assert.equal((await official.json()).code,'CLOCK_STILL_RUNNING');
    assert.deepEqual((await db.query('SELECT (SELECT count(*) FROM sports_management.match_results) AS results,(SELECT count(*) FROM sports_management.standing_versions) AS standings,(SELECT count(*) FROM sports_management.standing_entries) AS entries,(SELECT COALESCE(sum(points+points_adjustment),0)::text FROM sports_management.standing_entries) AS points,(SELECT count(*) FROM sports_management.disciplinary_cases) AS cases')).rows[0],officialBefore);
    const sqlState=async()=>fingerprint((await db.query('SELECT version,draft_data,remarks,(SELECT count(*) FROM sports_management.match_events WHERE match_report_id=r.id) AS events FROM sports_management.match_reports r WHERE match_id=$1',[match])).rows);
    criterion = "transactional-rollback";
    const beforeRollback=await sqlState();
    await db.query("CREATE FUNCTION sports_management.offline_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.remarks='PDGLD20 fallo transaccional sintético' THEN RAISE EXCEPTION 'SYNTHETIC_TRANSACTION_FAILURE'; END IF; RETURN NEW; END $$");
    await db.query('CREATE TRIGGER offline_test_failure BEFORE UPDATE ON sports_management.match_reports FOR EACH ROW EXECUTE FUNCTION sports_management.offline_test_failure()');
    let failedIntent;
    try {
      await click('Cierre y firmas'); await edit('PDGLD20 fallo transaccional sintético'); await click('Sincronizar');
      await wait("document.body.innerText.includes('No se recibió el acuse')");
      failedIntent=(await ev(local)).pending[0]; assert.ok(failedIntent);
      assert.equal(await sqlState(),beforeRollback);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM sports_management.match_report_syncs WHERE client_id=$1',[failedIntent.operation.id])).rows[0].n,0);
    } finally {
      await db.query('DROP TRIGGER offline_test_failure ON sports_management.match_reports');
      await db.query('DROP FUNCTION sports_management.offline_test_failure()');
    }
    await click('Sincronizar');
    await wait(`(async()=>!(await ${local}).pending.length)()`);
    assert.equal((await ev(local)).lastReceipt.receipt.operationId,failedIntent.operation.id);
    const currentReport = (await db.query("SELECT version,draft_data FROM sports_management.match_reports WHERE match_id=$1", [match])).rows[0];
    criterion = "visible-conflict-and-account-change";
    const serverData = await (await account.request(`/api/match-reports/${match}`)).json();
    const otherCommand = {
      formatVersion: 1, operationId: crypto.randomUUID(), matchId: match, kind: "save",
      expectedMatchVersion: serverData.match.version, expectedReportVersion: currentReport.version,
      draft: { ...currentReport.draft_data.draft, remarks: "Otro dispositivo sintético" },
    };
    assert.equal((await account.request(`/api/match-reports/${match}`, { method: "POST", headers: { origin: base, "Content-Type": "application/json", "X-Expected-Actor-Id": actorId }, body: JSON.stringify(otherCommand) })).status, 200);
    await click("Cierre y firmas"); await edit("Borrador local en conflicto conservado");
    await captureReportCaptainSignatures(page);
    await wait(`(async()=>Object.values((await ${local}).data.report.signatures).filter(Boolean).length===2)()`);
    await click("Sincronizar");
    await wait("document.body.innerText.includes('Cambió la versión del partido')");
    assert.equal((await ev(local)).data.report.remarks, "Borrador local en conflicto conservado");
    await click("Comparar versiones");
    await wait("document.querySelector('dialog[open]')?.innerText.includes('Otro dispositivo sintético')");
    assert.equal((await db.query("SELECT remarks FROM sports_management.match_reports WHERE match_id=$1", [match])).rows[0].remarks, "Otro dispositivo sintético");
    const conflictCopy=await ev(local);
    const conflictIntent=conflictCopy.pending[0];
    const beforeDecision=(await db.query("SELECT version,remarks FROM sports_management.match_reports WHERE match_id=$1",[match])).rows[0];
    const advanceReference={...otherCommand,operationId:crypto.randomUUID(),expectedReportVersion:beforeDecision.version,draft:{...otherCommand.draft,remarks:"Servidor avanzado durante revisión"}};
    assert.equal((await account.request(`/api/match-reports/${match}`,{method:"POST",headers:{origin:base,"Content-Type":"application/json","X-Expected-Actor-Id":actorId},body:JSON.stringify(advanceReference)})).status,200);
    await ev("document.querySelector('dialog[open] input[type=checkbox]').click()");
    await click("Revisar mis eventos y notas");
    await wait("document.querySelector('dialog[open]')?.innerText.includes('Cambió una de las versiones')");
    assert.equal(fingerprint((await ev(local)).pending),fingerprint(conflictCopy.pending));
    await click("Cancelar","document.querySelector('dialog[open]')");
    await click("Comparar versiones");
    await wait("document.querySelector('dialog[open]')?.innerText.includes('Servidor avanzado durante revisión')");
    await ev("document.querySelector('dialog[open] input[type=checkbox]').click()");
    await click("Revisar mis eventos y notas");
    await wait(`(async()=>(await ${local}).reviewRequired===true)()`);
    const reviewCopy=await ev(local);
    assert.notEqual(reviewCopy.draftId,conflictCopy.draftId);
    assert.equal(reviewCopy.data.report.remarks,"Borrador local en conflicto conservado");
    assert.equal(fingerprint(reviewCopy.archives.at(-1).pending[0]),fingerprint(conflictIntent));
    assert.equal(fingerprint(reviewCopy.archives.at(-1).data),fingerprint(conflictCopy.data));
    assert.equal(reviewCopy.pending.length,0);
    assert.equal(Object.values(reviewCopy.data.report.signatures).filter(Boolean).length,0);
    await open();
    await wait("document.body.innerText.includes('Revisa tus eventos y notas sobre la referencia vigente')");
    assert.equal((await db.query("SELECT remarks FROM sports_management.match_reports WHERE match_id=$1",[match])).rows[0].remarks,"Servidor avanzado durante revisión","Retomar y revisar conserva la versión del servidor hasta la decisión de sincronizar");
    await edit("Resolución sintética revisada");
    await click("Sincronizar"); await wait(`(async()=>{const row=await ${local};return row.acknowledgedRevision===row.revision&&!row.pending.length})()`);
    assert.equal((await db.query("SELECT remarks FROM sports_management.match_reports WHERE match_id=$1",[match])).rows[0].remarks,"Resolución sintética revisada");
    const resolved=await ev(local);
    const serverChoice={...advanceReference,operationId:crypto.randomUUID(),expectedReportVersion:resolved.data.report.version,draft:{...advanceReference.draft,remarks:"Referencia elegida para continuar"}};
    assert.equal((await account.request(`/api/match-reports/${match}`,{method:"POST",headers:{origin:base,"Content-Type":"application/json","X-Expected-Actor-Id":actorId},body:JSON.stringify(serverChoice)})).status,200);
    await edit("Otra captura local conservada");
    await click("Sincronizar"); await wait("document.body.innerText.includes('Cambió la versión del partido')");
    await click("Comparar versiones"); await wait("document.querySelector('dialog[open]')?.innerText.includes('Referencia elegida para continuar')");
    await ev("document.querySelector('dialog[open] input[type=checkbox]').click()");
    await click("Usar versión del servidor");
    await wait(`(async()=>{const row=await ${local};return row.data.report.remarks==='Referencia elegida para continuar'&&!row.pending.length})()`);
    assert.ok((await ev(local)).archives.some(copy=>copy.data.report.remarks==="Otra captura local conservada"));
    await open();
    assert.equal(await ev("document.querySelector('textarea').disabled"),false);
    assert.equal((await db.query("SELECT version FROM sports_management.match_reports WHERE match_id=$1",[match])).rows[0].version,serverChoice.expectedReportVersion+1);
    const assignment=(await db.query("SELECT id FROM sports_management.referee_assignments WHERE match_id=$1 AND status='APPROVED'",[match])).rows[0].id;
    const beforeRevocation=fingerprint((await ev(local)).data);
    await db.query("UPDATE sports_management.referee_assignments SET status='REVOKED' WHERE id=$1",[assignment]);
    assert.equal((await account.request(`/api/match-reports/${match}`)).status,403);
    assert.equal(fingerprint((await ev(local)).data),beforeRevocation);
    // Independent editable draft: revoke its assignment after the browser has
    // saved an edit, then exercise the real sync rejection and visible lock.
    criterion = "revocation-during-capture";
    const reusedPlayers={...structuredClone(intent.attempt.command.draft),events:[],signatures:{},score:{home:null,away:null}};
    reusedPlayers.lineups.forEach(row=>{row.periods=[];});
    const sportingConflict=await post({formatVersion:1,operationId:crypto.randomUUID(),matchId:future,kind:'lock-lineups',expectedMatchVersion:afterSchedule.data.match.version,expectedReportVersion:0,draft:reusedPlayers});
    assert.equal(sportingConflict.status,409);
    assert.equal((await sportingConflict.json()).code,'PARTICIPATION_CLOCK_REQUIRED','El horario separado no sustituye el final real del partido anterior');
    // No players are called up here: the first fixture is still in play.
    // Revocation is tested independently of RF02.7's sporting restrictions.
    const setupDraft={lineups:[],captains:{},events:[],signatures:{},score:{home:null,away:null},remarks:'Preparación sintética de revocación',incidents:''};
    const setup=await post({formatVersion:1,operationId:crypto.randomUUID(),matchId:future,kind:'save',expectedMatchVersion:afterSchedule.data.match.version,expectedReportVersion:0,draft:setupDraft});
    assert.equal(setup.status,200,(await setup.json()).code);
    const mainPage=page;
    const securityTarget=await page.command('Target.createTarget',{url:'about:blank'});
    const securityTargets=await (await fetch(`http://${endpoint.host}/json/list`)).json();
    security=await connectPage(securityTargets.find(item=>item.id===securityTarget.targetId).webSocketDebuggerUrl);
    page=security;
    await page.command('Page.bringToFront');
    await page.command('Page.navigate',{url:base+`/matches/${future}/report`});
    await click('Aceptar y preparar'); await wait("document.querySelector('[data-report-workspace]')");
    await click('Capturar cédula');
    const formationId=`formation-${afterSchedule.data.match.home.id}`;
    const securedLocal=local.replace(JSON.stringify(match),JSON.stringify(future));
    await ev(`document.getElementById(${JSON.stringify(formationId)}).click()`);
    await wait("document.querySelector('[role=listbox]')");
    await ev("[...document.querySelectorAll('[role=option]')].find(o=>o.textContent.trim()==='4-3-3').click()");
    await wait(`(async()=>(await ${securedLocal}).data.report.tactics?.[${JSON.stringify(afterSchedule.data.match.home.id)}]?.formation==='4-3-3')()`);
    await wait("document.querySelector('[aria-label=\"Guardado y sincronización\"]').innerText.includes('Guardado en este dispositivo')");
    const savedBeforeRevoke=await ev(securedLocal);
    assert.equal(savedBeforeRevoke.data.report.tactics[afterSchedule.data.match.home.id].formation,'4-3-3');
    const futureAssignment=(await db.query("SELECT id FROM sports_management.referee_assignments WHERE match_id=$1 AND status='APPROVED'",[future])).rows[0].id;
    await db.query("UPDATE sports_management.referee_assignments SET status='REVOKED' WHERE id=$1",[futureAssignment]);
    await click('Sincronizar'); await wait("document.body.innerText.includes('El servidor rechazó la captura')");
    const denied=await ev(securedLocal);
    assert.equal(fingerprint(denied.data.report),fingerprint(savedBeforeRevoke.data.report));
    assert.equal(denied.pending[0].error,'FORBIDDEN');
    assert.equal(await ev(`document.getElementById(${JSON.stringify(formationId)}).disabled`),true);
    assert.notEqual((await db.query('SELECT draft_data FROM sports_management.match_reports WHERE match_id=$1',[future])).rows[0].draft_data.draft.tactics?.[afterSchedule.data.match.home.id]?.formation,'4-3-3');
    await click("Comparar versiones");
    await wait("document.body.innerText.includes('No se pudo obtener una referencia autorizada')");
    assert.equal(fingerprint((await ev(securedLocal)).pending),fingerprint(denied.pending));
    page=mainPage;
    const counts = (await db.query("SELECT count(*)::int AS total,count(DISTINCT client_id)::int AS operations FROM sports_management.match_report_syncs WHERE user_id=$1", [actorId])).rows[0];
    assert.equal(counts.total, counts.operations);
    criterion = "account-switch-and-restoration";
    await page.command('Network.clearBrowserCookies');
    for(const [name,value] of foreign.cookies) await page.command('Network.setCookie',{name,value,url:base});
    await page.command('Page.navigate',{url:base+'/matches'});
    await wait("location.pathname==='/matches' && document.readyState==='complete'");
    await page.command("Page.navigate",{url:base+"/offline/report?match="+future});
    await wait("document.body.innerText.includes('No hay copias locales vigentes')");
    assert.equal(await ev("!!document.querySelector('[data-report-workspace]')"),false);
    assert.equal(fingerprint(await ev(securedLocal)),fingerprint(denied),"Cambiar cuenta conserva revisión, firma e intención del propietario");
    assert.equal(fingerprint((await ev(local)).data),beforeRevocation);
    await page.command("Emulation.setDeviceMetricsOverride",{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    await click("Cerrar sesión");
    await wait("location.pathname==='/login'");
    assert.equal(fingerprint(await ev(securedLocal)),fingerprint(denied),"La salida de la segunda cuenta conserva el borrador ajeno");
    for(const [name,value] of account.cookies) await page.command("Network.setCookie",{name,value,url:base});
    await page.command("Page.navigate",{url:base+"/offline/report?match="+future});
    await wait("document.querySelector('[data-report-workspace]') && document.body.innerText.includes('El servidor rechazó la captura')");
    assert.equal(fingerprint((await ev(securedLocal)).pending),fingerprint(denied.pending));
    assert.equal((await ev(securedLocal)).draftId,denied.draftId);
    await click("Cerrar sesión");
    await wait("document.querySelector('dialog[open]')?.innerText.includes('Hay cédulas pendientes')");
    await click("Cancelar", "document.querySelector('dialog[open]')");
    await wait("!document.querySelector('dialog[open]')");
    assert.equal(fingerprint((await ev(securedLocal)).pending),fingerprint(denied.pending),"Cancelar la salida conserva la intención pendiente");
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/browser.json`, JSON.stringify({postgres, preparedConnectedClockServerTime:true, lostClockReceiptKeepsOrigin:true, laterClockActionPreserved:true, conflictReviewedAndResumed:true, serverChoiceNoWrite:true, changedReferenceRequiresNewReview:true, resolutionDeniedAfterRevocation:true, revokedAssignmentUiBlocked:true, accountSwitchIsolatesAndRestoresPending:true, onlineOnlyWithoutServiceWorker:true, rescheduledSnapshotRejected:true, transactionalRollback:true, incompletePreparation:true, allSavedFieldsRestored:true, offlineEventAndSignatures:true, interruptedSignatureUpload:true, lostCommitResponse:true, sameUuidSameReceipt:true, changedPayloadRejected:true, foreignAccountDenied:true, revokedAssignmentDenied:true, officialEffectsAbsent:true, onlineFirstEdit: true, abruptOffline: true, closedTabRestored: true, realPostgresAck: true, lateAckPreservesEdits: true, twoTabsSeeReceipt: true, quotaFailureRetainsMemory: true, reauthenticationRetainsIntent: true, versionConflictPreservesCopy: true, privateDataOutsideCache: true, officialConfirmationBlocked: true, counts }, null, 2));
    console.log("PDGLD-19/20 navegador real: primera edición online, corte de red, cierre de pestaña, reapertura offline, acuse SQL y revisión posterior preservada: OK");
  } catch (error) {
    await mkdir(directory, { recursive: true });
    // No screenshots, draft dumps, strokes or actor identifiers in CI artifacts.
    const line = Number(error.stack?.match(/match-reports-offline\.mjs:(\d+):/)?.[1]) || null;
    await writeFile(`${directory}/failure.json`, JSON.stringify({postgres,criterion,error:error.name,line},null,2));
    throw error;
  } finally { security?.socket.close(); observer?.socket.close(); replacement?.socket.close(); await browser.close(); }
}

async function connectPage(endpoint) {
  const socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const item = pending.get(message.id);
    if (!item) return;
    clearTimeout(item.timer); pending.delete(message.id);
    if (message.error) item.reject(Error(message.error.message)); else item.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(Error("CDP_TIMEOUT " + method)); }, 45000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, command, async evaluate(expression) {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw Error("OFFLINE_BROWSER " + result.exceptionDetails.text);
    return result.result.value;
  } };
}
