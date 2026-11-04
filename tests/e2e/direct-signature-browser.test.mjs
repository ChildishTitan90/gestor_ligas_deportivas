import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { launchChrome } from './chrome-session.mjs';

// React y canvas reales en Chrome; solo next/image se sustituye por un img.
// Sin NextAuth, servicios de servidor, PostgreSQL ni Supabase.
test('PDGLD-109: captura directa en Chrome con perfil temporal', { timeout: 90000 }, async t => {
  const bundle = await build({
    write: false, bundle: true, platform: 'browser', format: 'iife',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
    stdin: {
      resolveDir: process.cwd(), loader: 'tsx', contents: `
        import React, { StrictMode } from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { DirectSignatureField } from './src/features/clubs/components/direct-signature-field';
        const root = createRoot(document.getElementById('root'));
        const changes = [];
        let props = {};
        window.fixture = {
          changes,
          render(next = {}) {
            props = { ...props, ...next };
            flushSync(() => root.render(<StrictMode>
              <DirectSignatureField label="Firma sintética" {...props}
                onChange={file => changes.push(file)} />
            </StrictMode>));
          },
          unmount() { flushSync(() => root.unmount()); },
        };
        window.fixture.render();
      `,
    },
    plugins: [{ name: 'image-in-browser-fixture', setup(plugin) {
      plugin.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
        contents: "import React from 'react';export default function Image({unoptimized,...props}){return React.createElement('img',props)}",
        resolveDir: process.cwd(),
      }));
    } }],
  });
  const server = createServer((request, response) => {
    if (request.url === '/bundle.js') {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(bundle.outputFiles[0].contents);
    } else if (request.url === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><meta charset="utf-8"><style>body{margin:16px}#root{width:600px}canvas,img{display:block;width:100%;height:auto}fieldset{min-width:0;box-sizing:border-box}button{margin:4px}</style><div id="root"></div><script src="/bundle.js"></script>');
    } else {
      response.writeHead(404); response.end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const runtimeErrors = [];
  try {
    browser = await launchChrome(`http://127.0.0.1:${server.address().port}`);
    browser.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params);
    });
    await browser.command('Runtime.enable');
    const evaluate = expression => browser.evaluate(expression);
    async function waitFor(expression) {
      await evaluate(`(async()=>{
        const until=Date.now()+10000;
        while(Date.now()<until){if(${expression})return;await new Promise(r=>setTimeout(r,20));}
        throw Error('Fixture timeout');
      })()`);
    }
    async function click(label) {
      const found = await evaluate(`(()=>{
        const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(label)});
        if(!button || button.disabled)return false;
        button.click();return true;
      })()`);
      assert.equal(found, true, `Botón disponible: ${label}`);
    }
    async function draw() {
      const box = await evaluate(`(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()`);
      const start = { x: box.x + box.w * 0.2, y: box.y + box.h * 0.3 };
      await browser.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...start, button: 'left', buttons: 1, clickCount: 1 });
      for (let i = 1; i <= 16; i++) {
        await browser.command('Input.dispatchMouseEvent', {
          type: 'mouseMoved', x: start.x + box.w * 0.6 * i / 16,
          y: start.y + box.h * 0.4 * i / 16, button: 'left', buttons: 1,
        });
      }
      await browser.command('Input.dispatchMouseEvent', { type: 'mouseReleased', x: start.x + box.w * 0.6, y: start.y + box.h * 0.4, button: 'left', buttons: 0, clickCount: 1 });
    }
    // Límites de tinta normalizados: comprueba la geometría, no solo la imagen CSS.
    async function inkBounds() {
      return evaluate(`(()=>{
        const c=document.querySelector('canvas');const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        let minX=c.width,minY=c.height,maxX=-1,maxY=-1;
        for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){
          const i=(y*c.width+x)*4;
          if(d[i+3]>0 && d[i]<180 && d[i+1]<180 && d[i+2]<180){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
        }
        return maxX<0?null:[minX/c.width,minY/c.height,maxX/c.width,maxY/c.height];
      })()`);
    }
    let ready = false;

for (let attempt = 0; attempt < 30; attempt++) {
  try {
    ready = await evaluate(
      'Boolean(window.fixture && document.querySelector("canvas"))'
    );
    if (ready) break;
  } catch (error) {
    if (!String(error.message).includes('Execution context was destroyed')) {
      throw error;
    }
  }

  await new Promise(resolve => setTimeout(resolve, 200));
}

assert.equal(ready, true, 'El componente no terminó de cargar en Chrome');
    await t.test('rechaza captura vacía sin emitir un archivo y enfoca el lienzo', async () => {
      await click('Ver vista previa');
      await waitFor('document.body.textContent.includes("Dibuja tu firma antes de continuar.")');
      assert.equal(await evaluate('document.activeElement === document.querySelector("canvas")'), true);
      assert.equal(await evaluate('window.fixture.changes.filter(Boolean).length'), 0);
    });
    await t.test('conserva los trazos al reducir y ampliar el área', async () => {
      await draw();
      const original = await inkBounds();
      assert.ok(original, 'El gesto debe dibujar tinta real');
      for (const width of [320, 600]) {
        await evaluate(`document.getElementById('root').style.width='${width}px'`);
        await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(r))))');
        const resized = await inkBounds();
        assert.ok(resized, 'El cambio de tamaño no debe borrar la firma');
        original.forEach((value, index) => assert.ok(Math.abs(value - resized[index]) < 0.04, 'Los trazos deben conservar su posición proporcional'));
      }
    });
    await t.test('vista previa no confirma; confirmar emite un PNG válido una sola vez', async () => {
      await click('Ver vista previa');
      await waitFor('document.querySelector("img") && !Array.from(document.querySelectorAll("button")).find(b=>b.textContent.includes("Confirmar captura"))?.disabled');
      assert.equal(await evaluate('window.fixture.changes.filter(Boolean).length'), 0);
      await click('Confirmar captura');
      const result = await evaluate(`(async()=>{
        const files=window.fixture.changes.filter(Boolean);const f=files[0];
        const bitmap=await createImageBitmap(f);
        const result={count:files.length,type:f.type,size:f.size,width:bitmap.width,height:bitmap.height};bitmap.close();return result;
      })()`);
      assert.equal(result.count, 1); assert.equal(result.type, 'image/png');
      assert.ok(result.size > 0); assert.equal(result.width, 600); assert.equal(result.height, 200);
      assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).find(b=>b.textContent.trim()==="Captura confirmada").disabled'), true);
    });
    await t.test('distingue carga y envío, y bloquea las acciones durante el envío', async () => {
      await evaluate('window.fixture.render({stored:true})');
      assert.equal(await evaluate('document.body.textContent.includes("Lista para enviar con la solicitud.")'), true);
      await evaluate('window.fixture.render({submitted:true,disabled:true})');
      assert.equal(await evaluate('document.body.textContent.includes("Firma incluida en la solicitud enviada.")'), true);
      assert.equal(await evaluate('Array.from(document.querySelectorAll("button")).every(b=>b.disabled)'), true);
    });
    await t.test('corregir invalida la confirmación y limpiar elimina los trazos', async () => {
      await evaluate('window.fixture.render({stored:false,submitted:false,disabled:false})');
      await click('Corregir firma');
      assert.equal(await evaluate('window.fixture.changes.at(-1) === null'), true);
      assert.ok(await inkBounds(), 'Corregir debe conservar los trazos editables');
      assert.equal(await evaluate('document.querySelector("img") === null'), true);
      await click('Limpiar');
      assert.equal(await inkBounds(), null);
      assert.equal(await evaluate('window.fixture.changes.at(-1) === null'), true);
    });
    await t.test('desmonta sin errores de referencias nulas', async () => {
      await evaluate('window.fixture.unmount()');
      assert.equal(await evaluate('document.querySelector("canvas") === null'), true);
      assert.deepEqual(runtimeErrors, []);
    });
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
