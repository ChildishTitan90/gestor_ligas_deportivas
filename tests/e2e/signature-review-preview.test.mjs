import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { launchChrome } from './chrome-session.mjs';

// Componente React real, imagen sintética y perfil temporal de Chrome.
// No autentica usuarios ni consulta Supabase/PostgreSQL.
test('PDGLD-109: vista previa privada de firmas en revisión', { timeout: 60000 }, async t => {
  const bundle = await build({
    write: false, bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    stdin: { resolveDir: process.cwd(), loader: 'tsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { SignatureReviewPreview } from './src/features/clubs/components/signature-review-preview';
      const root=createRoot(document.getElementById('root'));
      const canvas=document.createElement('canvas');canvas.width=600;canvas.height=200;
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,600,200);
      ctx.strokeStyle='black';ctx.beginPath();ctx.moveTo(40,100);ctx.lineTo(500,60);ctx.stroke();
      window.fixture={
        render(kind,life=60000){
          const url=kind==='valid'?canvas.toDataURL('image/png'):
            kind==='pdf'?'data:application/pdf;base64,JVBERi0xLjcK':location.origin+'/missing-image';
          flushSync(()=>root.render(<SignatureReviewPreview url={url} label="presidente" expiresAt={Date.now()+life}/>));
        },
        clear(){flushSync(()=>root.render(null));},
      };
    ` },
    plugins: [{ name: 'synthetic-image', setup(plugin) {
      plugin.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: "import React from 'react';export default function Image({unoptimized,...props}){return React.createElement('img',props)}",
        resolveDir: process.cwd(),
      }));
    } }],
  });
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles[0].contents);
    } else if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script>');
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await launchChrome(`http://127.0.0.1:${server.address().port}`);
    const evaluate = value => browser.evaluate(value);
    let ready = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { ready = await evaluate('Boolean(window.fixture)'); if (ready) break; }
      catch (error) { if (!String(error.message).includes('Execution context was destroyed')) throw error; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(ready, true, 'La vista de prueba no inició');
    async function waitFor(expression) {
      await evaluate(`(async()=>{
        const until=Date.now()+8000;
        while(Date.now()<until){if(${expression})return;await new Promise(r=>setTimeout(r,20));}
        throw Error('Preview fixture timeout');
      })()`);
    }
    await t.test('solo muestra la imagen al proporcionar un enlace a la vista', async () => {
      assert.equal(await evaluate('document.querySelector("img")===null'), true);
      await evaluate('window.fixture.render("valid")');
      await waitFor('document.querySelector("img")?.naturalWidth===600 && !document.body.textContent.includes("Cargando vista previa")');
      assert.equal(await evaluate('document.querySelector("img").alt'), 'Firma registrada de presidente');
      assert.equal(await evaluate('document.querySelector("img").referrerPolicy'), 'no-referrer');
    });
    await t.test('un error de imagen o PDF ofrece la alternativa de descarga', async () => {
      for (const kind of ['missing', 'pdf']) {
        await evaluate(`window.fixture.render(${JSON.stringify(kind)})`);
        await waitFor('document.body.textContent.includes("No se pudo mostrar la vista previa")');
        assert.equal(await evaluate('document.querySelector("img")===null'), true);
        assert.equal(await evaluate('document.body.textContent.includes("Descargar firma")'), true);
      }
    });
    await t.test('una nueva consulta recupera la imagen y el vencimiento la retira', async () => {
      await evaluate('window.fixture.render("valid",1000)');
      await waitFor('document.querySelector("img")?.naturalWidth===600');
      await waitFor('document.body.textContent.includes("El acceso temporal venció")');
      assert.equal(await evaluate('document.querySelector("img")===null'), true);
    });
    await t.test('retirar el acceso o cambiar de solicitud elimina la vista', async () => {
      await evaluate('window.fixture.render("valid")');
      await waitFor('document.querySelector("img")?.naturalWidth===600');
      await evaluate('window.fixture.clear()');
      assert.equal(await evaluate('document.getElementById("root").textContent'), '');
      assert.equal(await evaluate('document.querySelector("img")===null'), true);
    });
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
