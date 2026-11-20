import assert from 'node:assert/strict';

// Use the actual signature control and native input. Never inject an image or
// export the synthetic signature to logs/artifacts.
export async function captureReportCaptainSignatures(page) {
  const ev = expression => page.evaluate(expression);
  const settle = () => ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const field = "document.querySelector('canvas')?.closest('fieldset')";
  const button = label => `[...(${field}?.querySelectorAll('button')??[])].find(b=>b.textContent.trim()===${JSON.stringify(label)})`;
  async function wait(expression, phase) {
    const end = Date.now() + 45000;
    while (Date.now() < end) {
      if (await ev(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw Error(`REAL_REPORT_SIGNATURE_EXPECTATION: ${phase}`);
  }
  async function click(label) {
    await wait(`(()=>{const b=${button(label)};return b&&b.getClientRects().length&&!b.disabled})()`, label);
    await ev(`(()=>{const b=${button(label)};b.focus();b.click()})()`);
  }
  const bounds = () => ev("(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()");

  for (const remaining of [2, 1]) {
    await wait(`document.querySelectorAll('canvas').length===${remaining}&&document.querySelector('canvas').getAttribute('aria-disabled')==='false'`, 'canvas ready');
    await page.command('Page.bringToFront');
    await ev("document.querySelector('canvas').scrollIntoView({block:'center',behavior:'instant'})");
    await settle();
    let rect = await bounds();
    assert.equal(await ev("(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===c})()"), true, 'The real canvas receives the pointer');
    const point = n => ({ x: rect.x + rect.w * (.15 + n * .06), y: rect.y + rect.h * (.45 + (n % 2) * .15) });
    await page.command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point(0), button: 'none', buttons: 0 });
    await page.command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point(0), button: 'left', buttons: 1, clickCount: 1 });
    // onBegin updates the form. Re-read its settled position, then respect
    // signature_pad's 16 ms movement throttle so the browser draws a real stroke.
    await settle();
    rect = await bounds();
    for (let n = 1; n < 10; n++) {
      await page.command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point(n), button: 'left', buttons: 1 });
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await page.command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point(9), button: 'left', buttons: 0, clickCount: 1 });
    await wait(`(()=>{const b=${button('Limpiar')};return b&&!b.disabled})()`, 'stroke completed');
    await click('Ver vista previa');
    await wait(`(()=>{const img=${field}?.querySelector('img');return img?.complete&&img.naturalWidth>0})()`, 'preview loaded');
    await click('Confirmar captura');
    // FileReader links the confirmed image asynchronously. Do not send the next
    // stroke to the previous canvas while that confirmation is still pending.
    await wait(`document.querySelectorAll('canvas').length===${remaining - 1}`, 'confirmed image linked');
  }
}
