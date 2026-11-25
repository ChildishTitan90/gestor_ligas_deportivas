import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { closeTestServer, launchChrome } from './chrome-session.mjs';

test('el alta requiere revisión y firmas, y un reenvío incierto conserva la intención', { timeout: 90000 }, async t => {
  const bundle = await build({
    write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { AffiliationForm } from './src/features/clubs/components/affiliation-form';
      const id = (end) => '00000000-0000-4000-8000-' + String(end).padStart(12, '0');
      const club = id(1), season = id(2), category = id(3), affiliation = id(4), signature = id(5);
      const offices = { PRESIDENT: id(11), SECRETARY: id(12), TREASURER: id(13) };
      const storage = 'https://storage.example.test/storage/v1/object/upload/sign/firmas-afiliacion/';
      const officer = {firstName: 'Nombre sintético', paternalSurname: 'Prueba', maternalSurname: ''};
      window.writes = [];
      window.uploads = [];
      window.warnings = [];
      window.confirm = message => { window.warnings.push(message); return false; };
      window.fetch = async (path, options) => {
        if(path === '/api/affiliations/signatures/prepare' && options?.method === 'POST') {
          const body=JSON.parse(options.body);
          if(!(body.office in offices) || body.mimeType !== 'image/png') throw Error('Firma sintética inesperada');
          return Response.json({ticket:body.office, uploadUrl:storage+body.office});
        }
        if(String(path).startsWith(storage) && options?.method === 'PUT') {
          window.uploads.push(String(path).slice(storage.length));
          return new Response(null,{status:200});
        }
        if(path === '/api/affiliations/signatures/confirm' && options?.method === 'POST') {
          const office=JSON.parse(options.body).ticket;
          if(!window.uploads.includes(office)) throw Error('Confirmación sin carga');
          return Response.json({signatureFileId:offices[office]});
        }
        if(path === '/api/affiliations' && options?.method === 'POST') {
          window.writes.push(options.body);
          return Response.json({id:affiliation, referenceNumber:'AFL-NUEVA', status:'PENDING', replayed:false},{status:201});
        }
        if(path !== '/api/affiliations/' + affiliation + '/resubmit' || options?.method !== 'PATCH') throw Error('Solicitud inesperada');
        window.writes.push(options.body);
        if(window.writes.length === 1) {
          await new Promise(resolve => { window.releaseFirst = resolve; });
          return Response.json({}, {status: 503});
        }
        return Response.json({id: affiliation, referenceNumber: 'AFL-PRUEBA', status: 'PENDING', replayed: false, version: 3, reviewPhase: 'AWAITING_REVIEW'});
      };
      const root=createRoot(document.getElementById('root'));
      function render(correcting) { root.render(<>
        <a href="/access">Salir al panel</a>
        <AffiliationForm key={correcting?'correction':'new'} categories={[{id: category, name: 'Libre sintética'}]}
          contextLabels={{club:'Club de prueba', season:'Temporada sintética', league:'Liga de prueba'}}
          initialValues={{clubName:'Club de prueba', uniformColors:'Azul y blanco', categoryIds:[],
            officers:{PRESIDENT:officer, SECRETARY:officer, TREASURER:officer}}}
          submissionContext={{actorId:id(6), clubId:club, seasonId:season, storageOrigin:'https://storage.example.test'}}
          correction={correcting?{id:affiliation, submissionKey:id(7), expectedVersion:2, referenceNumber:'AFL-PRUEBA', observations:'Precisar uniforme',
            signatureFileIds:{PRESIDENT:signature, SECRETARY:signature, TREASURER:signature}}:undefined}/>
      </>); }
      window.startNew = () => { window.writes.length=0; render(false); };
      render(true);
    ` },
  });
  const server = createServer((req, res) => {
    if (req.url === '/bundle.js') {
      res.setHeader('Content-Type', 'application/javascript');
      res.end(bundle.outputFiles[0].contents);
    } else if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end('<!doctype html><html lang="es"><style>canvas,img{display:block;width:100%;height:auto}fieldset{min-width:0}#root{max-width:600px}</style><div id="root"></div><script src="/bundle.js"></script>');
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => closeTestServer(server));
  const browser = await launchChrome(`http://127.0.0.1:${server.address().port}`, { waitForDocument: true });
  t.after(() => browser.close());
  const evaluate = source => browser.evaluate(source);
  async function wait(condition) {
    await evaluate(`(async () => {
      for(let i = 0; i < 160; i++) { if (${condition}) return; await new Promise(resolve => setTimeout(resolve, 25)); }
      throw Error(${JSON.stringify(`No se cumplió: ${condition}`)});
    })()`);
  }
  const currentStep = label => `document.querySelector('[aria-current="step"]')?.textContent.trim().endsWith(${JSON.stringify(label)})`;
  const button = label => `[...document.querySelectorAll('button')].find(element => element.getClientRects().length && element.textContent.trim() === ${JSON.stringify(label)})`;
  async function click(label) { await evaluate(`${button(label)}.click()`); }

  await wait(currentStep('Datos y categorías'));
  await click('Continuar a directivos y firmas');
  await wait(`document.activeElement.name === 'categoryIds'`);
  await evaluate(`document.activeElement.click()`);
  await evaluate(`document.querySelector('a').click()`);
  assert.equal(await evaluate('window.warnings.length'), 1);
  assert.equal(await evaluate('location.pathname'), '/');
  await click('Continuar a directivos y firmas');
  await wait(currentStep('Directivos y firmas'));
  await click('Revisar solicitud');
  await wait(currentStep('Revisar solicitud'));
  assert.equal(await evaluate('window.writes.length'), 0);
  await click('Volver a editar');
  await wait(currentStep('Datos y categorías'));
  assert.equal(await evaluate(`document.querySelector('[name=categoryIds]').checked`), true);
  await click('Continuar a directivos y firmas');
  await wait(currentStep('Directivos y firmas'));
  await click('Revisar solicitud');
  await wait(currentStep('Revisar solicitud'));
  await evaluate(`(() => { const send = ${button('Reenviar correcciones')}; send.click(); send.click(); })()`);
  await wait(`typeof window.releaseFirst === 'function'`);
  assert.equal(await evaluate('window.writes.length'), 1);
  await evaluate('window.releaseFirst()');
  await wait(`!!document.querySelector('a[target="_blank"]')`);
  assert.match(await evaluate(`document.querySelector('a[target="_blank"]').search`), /context=/);
  assert.equal(await evaluate(`Boolean(${button('Volver a editar')})`), false);
  await click('Reintentar el mismo envío');
  await wait(`document.activeElement.textContent === 'Correcciones recibidas'`);
  const bodies = await evaluate('window.writes');
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
  assert.equal(JSON.parse(bodies[0]).expectedVersion, 2);
  assert.match(await evaluate(`document.querySelector('h2').closest('section').textContent`), /AFL-PRUEBA.*Secretaría/);

  await evaluate('window.startNew()');
  await wait(currentStep('Datos y categorías'));
  await evaluate(`document.querySelector('[name=categoryIds]').click()`);
  await click('Continuar a directivos y firmas');
  await wait(currentStep('Directivos y firmas'));
  await click('Revisar solicitud');
  await wait(`document.body.textContent.includes('Confirma esta firma antes de revisar')`);
  assert.equal(await evaluate('window.writes.length'), 0);
  for (const [index, office] of ['PRESIDENT','SECRETARY','TREASURER'].entries()) {
    const group = `document.querySelector('[data-signature-office=${office}]')`;
    const canvas = `${group}.querySelector('canvas')`;
    const box = await evaluate(`(()=>{const el=${canvas};el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})()`);
    const start = { x: box.x + box.w * .2, y: box.y + box.h * .3 };
    const end = { x: start.x + box.w * .5, y: start.y + box.h * .35 };
    await browser.command('Input.dispatchMouseEvent', {type:'mousePressed', ...start, button:'left', buttons:1, clickCount:1});
    for (let step=1; step<=12; step++) await browser.command('Input.dispatchMouseEvent', {type:'mouseMoved', x:start.x+(end.x-start.x)*step/12, y:start.y+(end.y-start.y)*step/12, button:'left', buttons:1});
    await browser.command('Input.dispatchMouseEvent',{type:'mouseReleased', ...end, button:'left', buttons:0, clickCount:1});
    await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    await evaluate(`[...${group}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Ver vista previa').click()`);
    await wait(`[...${group}.querySelectorAll('button')].some(b=>b.textContent.trim()==='Confirmar captura'&&!b.disabled)`);
    await evaluate(`[...${group}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Confirmar captura').click()`);
    await wait(`document.body.textContent.includes('${index+1} de 3 firmas confirmadas')`);
  }
  await click('Revisar solicitud');
  await wait(currentStep('Revisar solicitud'));
  assert.equal(await evaluate('window.writes.length'), 0);
  await click('Enviar a revisión');
  await wait(`document.activeElement.textContent === 'Solicitud recibida'`);
  assert.deepEqual(await evaluate('window.uploads'), ['PRESIDENT','SECRETARY','TREASURER']);
  const posted = await evaluate('JSON.parse(window.writes[0])');
  assert.equal(posted.officers.SECRETARY.signatureFileId.endsWith('0012'), true);
  assert.equal(await evaluate('window.writes.length'), 1);
});
