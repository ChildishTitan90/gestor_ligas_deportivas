import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { createServer } from "node:http";
import { launchChrome } from "./chrome-session.mjs";
import { readFile } from "node:fs/promises";

// React DOM real en Chrome headless; red y datos de negocio exclusivamente sintéticos.
// No inicia Next, importa servicios de servidor ni contacta una base de datos.
test("selectores, modales breves, envíos inciertos y separación de usuarios", { timeout: 45000 }, async () => {
  const bundle = await build({ write: false, bundle: true, platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"development"' },
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { flushSync } from 'react-dom';
      import { TeamRegistrationFormView } from './src/features/clubs/components/team-registration-form';
      import { createTeamRegistrationFormController } from './src/features/clubs/team-registration-form-controller';
      import { TeamRegistrationWorkspace } from './src/features/clubs/components/team-registration-workspace';
      import { SelectField } from './src/components/ui/select-field';
      import { AffiliationReviewView } from './src/features/clubs/components/affiliation-review-workspace';
      import { createReviewController } from './src/features/clubs/affiliation-review-controller';
      import { ReviewApiError } from './src/features/clubs/affiliation-review-model';
      const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
      const a = id(90), b = id(91);
      let currentUser = a, changeUser, late, lateSignal, delayList = false;
      const posts = [];const cancellations=[];const checks=[];
      const pending = { enrollmentKey:id(100), clubId:id(1), seasonId:id(2), categoryId:id(3), groupId:id(4), team:{mode:'new',name:'PRIVATE-CAPTURE-A'} };
      const stored = JSON.stringify(pending);
      sessionStorage.setItem('team-enrollment:pending:'+a,stored);
      const options = user => ({ capabilities:{clubId:user===a?id(1):id(11),canEnroll:true,canCreateTeam:true},nextClubAfter:null,nextSeasonAfter:null,nextTeamAfter:null,clubs:[{id:user===a?id(1):id(11),name:user===a?'CLUB-A':'CLUB-B',leagueId:id(9)}],
        seasons:[{id:id(2),name:'SYNTHETIC-SEASON',status:'OPEN'}],teams:[],categories:[],groups:[] });
      const json = value => new Response(JSON.stringify(value),{status:200});
      window.fetch = async (path,init) => {
        if(path==='/api/auth/session') return json({user:{id:currentUser,mustChangePassword:false}});
        if(String(path).includes('/operations/')) {
          if(String(path).endsWith('/cancel')) {cancellations.push({path,init});return json({enrollmentKey:pending.enrollmentKey,clubId:pending.clubId,outcome:'CANCELLED',enrollment:null});}
          checks.push({path,init});return json({enrollmentKey:pending.enrollmentKey,clubId:pending.clubId,outcome:'UNRESOLVED',enrollment:null});
        }
        if(init?.method==='POST') {posts.push({user:currentUser,body:init.body});throw Error('Unexpected POST');}
        if(String(path).startsWith('/api/team-enrollments/options') || String(path).startsWith('/api/team-enrollments/catalogs')) return json(options(currentUser));
        if(String(path).startsWith('/api/team-enrollments?')) {
          if(delayList && currentUser===a) {lateSignal=init.signal; return new Promise(resolve=>{late=resolve;});}
          return json({items:[],nextAfter:null});
        }
        throw Error('Unexpected endpoint');
      };
      function Parent(){const [user,setUser]=useState(a);changeUser=setUser;return <div id="stable-parent"><TeamRegistrationWorkspace userId={user}/></div>;}
      const check=(value,message)=>{if(!value)throw Error(message);};
      const wait=async predicate=>{for(let n=0;n<300;n++){if(predicate())return;await new Promise(r=>setTimeout(r,10));}throw Error('Timed out: '+predicate.toString()+'; menus='+Array.from(document.querySelectorAll('[role=listbox]')).map(node=>node.textContent).join('|')+'; fields='+Array.from(document.querySelectorAll('[role=combobox]')).map(node=>node.id+':'+node.getAttribute('aria-expanded')+':'+node.disabled).join('|'));};
      window.testDone=(async()=>{
        let root=createRoot(document.getElementById('root'));
        // Componente real; valores y red de negocio exclusivamente sintéticos.
        let replaceChoices, disableChoices;
        const selections=[];
        const initialChoices=[{value:'a',label:'Águilas Centro',description:'AGC'},{value:'b',label:'Real Morelia',description:'RMO'},{value:'x',label:'No disponible',disabled:true}];
        function SelectFixture(){
          const [choices,setChoices]=useState(initialChoices),[disabled,setDisabled]=useState(false);
          replaceChoices=setChoices;disableChoices=setDisabled;
          return <form id="select-fixture" style={{position:'fixed',bottom:20,left:16,width:'min(340px, calc(100vw - 32px))'}}>
            <fieldset disabled={disabled}><label htmlFor="fixture-choice">Club de prueba</label>
              <SelectField id="fixture-choice" name="choice" required options={choices} onValueChange={value=>selections.push(value)}/>
            </fieldset><button type="reset">Restablecer</button><button type="button" id="next-control">Siguiente</button>
          </form>;
        }
        flushSync(()=>root.render(<SelectFixture/>));
        const choice=()=>document.getElementById('fixture-choice');
        const selected=()=>new FormData(document.getElementById('select-fixture')).get('choice');
        const key=(key,extra={})=>flushSync(()=>choice().dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...extra})));
        const typeQuery=text=>flushSync(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(choice(),text);choice().dispatchEvent(new Event('input',{bubbles:true}));});
        choice().focus();flushSync(()=>choice().click());
        check(choice().getAttribute('aria-expanded')==='true','Select did not open');
        check(document.querySelector('[role=listbox]').getBoundingClientRect().bottom<=choice().getBoundingClientRect().top,'Menu did not open upward near the viewport edge');
        typeQuery('aguilas');
        check(document.querySelectorAll('[role=option]').length===1,'Search must ignore accents');
        check(selected()==='' && selections.length===0,'Typing committed a choice');
        key('Enter');check(selected()==='a' && selections[0]==='a','Selection did not send its identifier');
        check(choice().value==='Águilas Centro','Selected label missing');
        check(document.activeElement===choice(),'Selection lost input focus');
        key('ArrowDown');typeQuery('sin coincidencias');
        check(document.querySelector('[role=status]').textContent.includes('No hay opciones'),'Missing empty search');
        key('Escape');check(selected()==='a' && choice().value==='Águilas Centro','Escape changed selection');
        key('ArrowDown');key('End');key('Enter');check(selected()==='b','Keyboard did not skip disabled option');
        flushSync(()=>document.getElementById('select-fixture').reset());
        check(selected()==='' && !choice().checkValidity(),'Reset lost required validation');
        flushSync(()=>replaceChoices(Array.from({length:80},(_,index)=>({value:'item-'+index,label:'Club '+index}))));
        key('ArrowDown');key('End');
        const list=document.querySelector('[role=listbox]');
        check(list.scrollTop>0,'Keyboard did not scroll active option');
        list.scrollTop=10;list.dispatchEvent(new Event('scroll',{bubbles:true}));
        await new Promise(resolve=>requestAnimationFrame(resolve));
        check(list.scrollTop===10,'Manual list scrolling snapped back');
        key('Enter');check(selected()==='item-79','End key chose the wrong option');
        flushSync(()=>replaceChoices([{value:'other',label:'Otro club'}]));
        check(selected()==='' && choice().value==='','Removed option retained a stale identifier');
        key('ArrowDown');flushSync(()=>disableChoices(true));
        await wait(()=>choice().matches(':disabled') && !document.querySelector('[role=listbox]'));
        check(selected()===null,'Disabled fieldset submitted a hidden value');
        flushSync(()=>disableChoices(false));key('ArrowDown');
        document.getElementById('next-control').focus();
        await wait(()=>document.activeElement.id==='next-control' && !document.querySelector('[role=listbox]'));
        check(document.activeElement.id==='next-control','Closing moved focus away from next control');
        root.unmount();root=createRoot(document.getElementById('root'));
        flushSync(()=>root.render(<form><label htmlFor="fixture-choice">Selección sin búsqueda</label>
          <SelectField id="fixture-choice" name="choice" required searchable={false} options={initialChoices}/></form>));
        check(!choice().checkValidity(),'Non-searchable required choice bypassed validation');
        choice().focus();key(' ');key('Enter');
        check(choice().checkValidity() && document.querySelector('input[name="choice"]').value==='a','Non-searchable keyboard selection failed');
        root.unmount();root=createRoot(document.getElementById('root'));
        const reviewLeague=id(200), reviewCategory=id(201), reviewWrites=[];
        let rejectReview, reviewedId=null;
        const reviewRows=Array.from({length:26},(_,index)=>({id:id(300+index),leagueId:reviewLeague,seasonId:id(202),seasonName:'Apertura sintética',referenceNumber:'AFI-'+index,clubName:'Club '+index,status:'PENDING',reviewPhase:'AWAITING_REVIEW',version:0}));
        const reviewDetail=identifier=>({...reviewRows.find(item=>item.id===identifier),version:reviewedId===identifier?1:0,
          reviewPhase:reviewedId===identifier?'CORRECTIONS_REQUESTED':'AWAITING_REVIEW',uniformColors:'Azul',categories:['Categoría sintética'],
          categoryOptions:[{id:reviewCategory,name:'Categoría sintética',authorized:false}],observations:reviewedId===identifier?'Corregir colores':null,
          allowedActions:reviewedId===identifier?[]:['APPROVE','REQUEST_CORRECTIONS'],history:[],officers:[]});
        const reviewController=createReviewController({list:async()=>reviewRows,detail:async identifier=>reviewDetail(identifier),
          signature:async()=>{throw Error('Unexpected signature');},review:async(...args)=>{reviewWrites.push(args);return new Promise((resolve,reject)=>{rejectReview=reject;});}});
        flushSync(()=>root.render(<AffiliationReviewView controller={reviewController} leagues={[{id:reviewLeague,name:'Liga sintética'}]}/>));
        const searchField=()=>document.querySelector('input[placeholder="Folio o nombre del club"]');
        flushSync(()=>searchField().form.requestSubmit());
        await wait(()=>reviewController.getSnapshot().loaded && document.body.textContent.includes('26 resultados'));
        check(document.querySelectorAll('tbody tr').length===10,'Review table did not paginate');
        const setSearch=text=>flushSync(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(searchField(),text);searchField().dispatchEvent(new Event('input',{bubbles:true}));});
        setSearch('Club 23');flushSync(()=>searchField().form.requestSubmit());
        await wait(()=>!reviewController.getSnapshot().loading && document.querySelectorAll('tbody tr').length===1);
        const reviewButton=Array.from(document.querySelectorAll('button')).find(button=>button.getAttribute('aria-label')?.startsWith('Revisar de Club 23,'));
        reviewButton.click();await wait(()=>!!reviewController.getSnapshot().detail);
        const correctionTrigger=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Solicitar correcciones');
        correctionTrigger.focus();correctionTrigger.click();await wait(()=>document.querySelector('dialog')?.open);
        const note=()=>document.querySelector('textarea[name=observations]');
        await wait(()=>document.activeElement===note());
        const setNote=text=>flushSync(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(note(),text);note().dispatchEvent(new Event('input',{bubbles:true}));});
        setNote('Corregir colores');
        document.querySelector('button[aria-label="Cerrar: Solicitar correcciones"]').click();
        await wait(()=>document.body.textContent.includes('¿Descartar los cambios sin guardar?'));
        check(reviewWrites.length===0,'Closing sent a review');
        Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Seguir editando').click();
        await wait(()=>document.activeElement===note());check(note().value==='Corregir colores','Dirty capture lost');
        document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));
        await wait(()=>document.body.textContent.includes('¿Descartar los cambios sin guardar?'));
        Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Descartar cambios').click();
        await wait(()=>!document.querySelector('dialog'));
        check(reviewController.getSnapshot().observations==='' && document.activeElement===correctionTrigger,'Discard/focus failed');
        correctionTrigger.click();await wait(()=>document.querySelector('dialog')?.open);setNote('Corregir colores');
        const send=()=>Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Enviar correcciones');
        send().click();await wait(()=>reviewController.getSnapshot().submitting);
        document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));
        send().click();check(document.querySelector('dialog').open && reviewWrites.length===1,'Pending close or duplicate send');
        rejectReview(new ReviewApiError('unavailable'));await wait(()=>!!reviewController.getSnapshot().pendingReview && !reviewController.getSnapshot().submitting);
        Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Cerrar y conservar pendiente').click();
        await wait(()=>!document.querySelector('dialog'));
        check(reviewController.getSnapshot().observations==='Corregir colores','Uncertain close discarded capture');
        Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Ver envío pendiente').click();
        await wait(()=>document.querySelector('dialog')?.open);check(note().value==='Corregir colores','Reopen lost pending draft');
        Array.from(document.querySelectorAll('dialog button')).find(button=>button.textContent==='Consultar resultado sin reenviar').click();
        await wait(()=>!reviewController.getSnapshot().detailLoading);
        check(!!reviewController.getSnapshot().pendingReview && reviewWrites.length===1,'Old GET declared failure or resent');
        reviewedId=id(323);
        Array.from(document.querySelectorAll('dialog button')).find(button=>button.textContent==='Consultar resultado sin reenviar').click();
        await wait(()=>!reviewController.getSnapshot().pendingReview && !document.querySelector('dialog'));
        check(reviewWrites.length===1,'Reconciliation wrote another review');
        await reviewController.open(id(300));
        await wait(()=>!!document.querySelector('input[type=checkbox]'));
        document.querySelector('input[type=checkbox]').click();
        Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Aprobar solicitud').click();
        await wait(()=>document.querySelector('dialog')?.open);
        await wait(()=>document.activeElement?.textContent==='Cancelar');
        const backgroundSearch=searchField();backgroundSearch.focus();check(document.querySelector('dialog').contains(document.activeElement),'Native modal focus escaped');
        Array.from(document.querySelectorAll('dialog button')).find(button=>button.textContent==='Cancelar').click();
        await wait(()=>!document.querySelector('dialog'));check(reviewWrites.length===1,'Cancelling approval sent a write');
        root.unmount();root=createRoot(document.getElementById('root'));
        let finish;
        const formOptions={clubs:[{id:id(1),name:'SYNTHETIC',seasons:[{id:id(2),name:'SYNTHETIC',canEnroll:true,canCreateTeam:false,
          teams:[{id:id(5),name:'SYNTHETIC'}],categories:[{id:id(3),name:'SYNTHETIC',groups:[{id:id(4),name:'SYNTHETIC'}]}]}]}]};
        const formController=createTeamRegistrationFormController(formOptions,()=>new Promise(resolve=>{finish=resolve;}));
        flushSync(()=>root.render(<TeamRegistrationFormView controller={formController}/>));
        for(const [field,value] of Object.entries({clubId:id(1),seasonId:id(2),teamId:id(5)})) flushSync(()=>formController.change(field,value));
        document.querySelector('form').requestSubmit();
        await wait(()=>document.activeElement?.getAttribute('data-select-field')==='categoryId');
        check(document.getElementById(document.activeElement.getAttribute('aria-describedby'))?.textContent.includes('categoría'),'Field error association missing');
        flushSync(()=>{formController.change('categoryId',id(3));formController.change('groupId',id(4));});
        document.querySelector('form').requestSubmit();
        await wait(()=>!!finish);
        check(document.querySelector('button[type="submit"]').disabled,'Duplicate submit enabled');
        finish({kind:'correctable',fieldErrors:{groupId:'SYNTHETIC-SERVER-ERROR'}});
        await wait(()=>document.activeElement?.getAttribute('data-select-field')==='groupId');
        check(document.getElementById(document.activeElement.getAttribute('aria-describedby')).textContent==='SYNTHETIC-SERVER-ERROR','Async error not linked');
        flushSync(()=>formController.change('groupId',id(4)));
        document.querySelector('form').requestSubmit();
        finish({kind:'confirmed',teamId:id(5),seasonTeamId:id(7),status:'REGISTERED'});
        await wait(()=>document.activeElement?.getAttribute('role')==='status');
        check(document.activeElement.textContent.includes('Inscripción confirmada'),'Confirmation did not receive focus');
        Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Iniciar otra inscripción').click();
        await wait(()=>document.activeElement?.getAttribute('data-select-field')==='clubId');
        // Montar la vista real con captura pendiente; abrir/cancelar no hace POST.
        flushSync(()=>root.render(<Parent/>));
        const parent=document.getElementById('stable-parent');
        await wait(()=>document.querySelector('input[name="teamName"]')?.value==='PRIVATE-CAPTURE-A');
        const discard=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Cerrar formulario…');
        discard.focus();discard.click();
        await wait(()=>document.querySelector('dialog')?.open);
        check(document.activeElement.textContent==='Seguir en el formulario','Unsafe initial modal focus');
        const background=document.getElementById('registration-query-club');background.focus();
        check(document.querySelector('dialog').contains(document.activeElement),'Focus escaped modal');
        // El evento cancel es el que emite el navegador al pulsar Escape.
        document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));
        await wait(()=>!document.querySelector('dialog'));
        check(document.activeElement===discard,'Cancel did not restore trigger focus');
        check(sessionStorage.getItem('team-enrollment:pending:'+a)===stored,'Cancel removed pending');
        delayList=true;
        const club=document.getElementById('registration-query-club');club.form.requestSubmit();
        await wait(()=>!!late);
        currentUser=b;flushSync(()=>changeUser(b));
        check(document.getElementById('stable-parent')===parent,'Parent was unmounted');
        check(!document.querySelector('input[name="teamName"]'),'Previous capture still visible');
        await wait(()=>lateSignal.aborted);
        late(json({items:[{id:id(7),teamId:id(5),teamName:'PRIVATE-LATE-A',teamReferenceNumber:'SYNTHETIC',clubId:id(1),seasonId:id(2),categoryId:id(3),categoryName:'SYNTHETIC',groupId:id(4),groupName:'SYNTHETIC',seasonName:'SYNTHETIC-SEASON',status:'REGISTERED'}],nextAfter:null}));
        await wait(()=>document.querySelector('form[aria-labelledby] input[data-select-field="clubId"]:enabled') && document.getElementById('registration-query-club')?.matches(':enabled'));
        document.getElementById('registration-query-club').focus();
        flushSync(()=>document.getElementById('registration-query-club').click());
        await wait(()=>document.querySelector('[role=listbox]')?.textContent.includes('CLUB-B'));
        await new Promise(r=>setTimeout(r,40));
        check(!document.body.textContent.includes('PRIVATE-LATE-A'),'Late response leaked');
        check(!document.body.textContent.includes('CLUB-A'),'Previous options leaked');
        flushSync(()=>document.querySelector('[role=combobox][aria-expanded=true]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
        check(!document.querySelector('input[name="teamName"]'),'Previous draft leaked');
        check(sessionStorage.getItem('team-enrollment:pending:'+a)===stored,'Previous key was removed');
        check(sessionStorage.getItem('team-enrollment:pending:'+b)===null,'Previous capture reassigned');
        check(posts.length===0,'Pending sent under a different identity');
        // Volver al propietario permite el cierre explícito; debe enfocar el bloqueo.
        delayList=false;currentUser=a;flushSync(()=>changeUser(a));
        await wait(()=>document.querySelector('input[name="teamName"]')?.value==='PRIVATE-CAPTURE-A');
        const discardAgain=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Cerrar formulario…');
        discardAgain.focus();discardAgain.click();await wait(()=>document.querySelector('dialog')?.open);
        Array.from(document.querySelectorAll('dialog button')).find(button=>button.textContent==='Cerrar y conservar pendiente').click();
        await wait(()=>!document.querySelector('dialog') && document.activeElement?.textContent.includes('Formulario cerrado'));
        check(sessionStorage.getItem('team-enrollment:pending:'+a)===stored,'Close lost pending body or key');
        check(sessionStorage.getItem('team-enrollment:pending:'+a+':discarded')===null,'Close created a destructive marker');
        Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Retomar envío pendiente').click();
        await wait(()=>document.querySelector('input[name="teamName"]')?.value==='PRIVATE-CAPTURE-A');
        check(document.querySelector('button[type="submit"]').disabled,'Resumed pending allowed a new enrollment');
        root.unmount();root=createRoot(document.getElementById('root'));flushSync(()=>root.render(<Parent/>));
        await wait(()=>document.querySelector('input[name="teamName"]')?.value==='PRIVATE-CAPTURE-A');
        check(sessionStorage.getItem('team-enrollment:pending:'+a)===stored,'Remount lost pending');
        Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Consultar resultado del envío').click();
        await wait(()=>checks.length===1 && document.activeElement?.textContent.includes('UNRESOLVED'));
        check(sessionStorage.getItem('team-enrollment:pending:'+a)===stored,'UNRESOLVED removed pending');
        check(new Headers(checks[0].init.headers).get('X-Expected-Actor-Id')===a,'Missing expected actor in check');
        const cancelButton=Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Cancelar intención…');
        cancelButton.focus();cancelButton.click();await wait(()=>document.querySelector('dialog')?.open);
        check(document.activeElement.textContent==='Seguir consultando','Unsafe cancellation focus');
        document.querySelector('dialog').dispatchEvent(new Event('cancel',{cancelable:true}));
        await wait(()=>!document.querySelector('dialog'));check(document.activeElement===cancelButton,'Cancel dialog lost trigger focus');
        cancelButton.click();await wait(()=>document.querySelector('dialog')?.open);
        Array.from(document.querySelectorAll('dialog button')).find(button=>button.textContent==='Confirmar cancelación de intención').click();
        await wait(()=>cancellations.length===1 && document.activeElement?.textContent.includes('Cancelación confirmada'));
        check(cancellations[0].init.body===stored,'Cancellation changed pending body');
        check(new Headers(cancellations[0].init.headers).get('X-Expected-Actor-Id')===a,'Missing expected actor in cancel');
        check(sessionStorage.getItem('team-enrollment:pending:'+a)===null,'CANCELLED did not resolve pending');
        check(posts.length===0,'Close or check sent an enrollment POST');
        root.unmount();return {parentPreserved:true,oldReadAborted:true,lateResponseHidden:true,pendingPreserved:true,posts:posts.length};
      })();
    ` }, plugins: [{ name: "synthetic-navigation", setup(plugin) {
      plugin.onResolve({ filter: /^@\/components\/ui\/action-link$/ }, () => ({ path: "action-link", namespace: "synthetic" }));
      plugin.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({ contents: "import React from 'react';export function ActionLink({children,href}){return React.createElement('a',{href},children)}", resolveDir: process.cwd() }));
    } }],
  });
  const controlsCss = await readFile(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8') + '\n' + await readFile(new URL('../../src/app/globals.css', import.meta.url), 'utf8');
  const server = createServer((request, response) => {
    if (request.url === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].contents); }
    else if (request.url === "/controls.css") { response.setHeader("Content-Type", "text/css"); response.end(controlsCss.replace(/^@import.*$/gm,'')); }
    else { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><link rel="stylesheet" href="/controls.css"><div id="root"></div><script src="/bundle.js"></script>'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  let socket;
  try {
    browser = await launchChrome(origin);
    socket = browser.socket;
    let commandId = 0;
    const evaluate = () => new Promise((resolve, reject) => {
      const id = ++commandId;
      const listener = event => { const message = JSON.parse(event.data); if (message.id !== id) return;
        socket.removeEventListener("message", listener);
        if (message.result?.exceptionDetails || message.error) reject(new Error("Browser assertion failed: " + JSON.stringify(message.result?.exceptionDetails ?? message.error)));
        else resolve(message.result.result.value);
      };
      socket.addEventListener("message", listener);
      socket.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: "(async()=>{while(!window.testDone)await new Promise(r=>setTimeout(r,10));return await window.testDone})()", awaitPromise: true, returnByValue: true } }));
    });
    let result;
    for (let attempt = 0; attempt < 5; attempt++) {
      try { result = await evaluate(); break; }
      catch (error) { if (!error.message.includes("Execution context was destroyed") || attempt === 4) throw error;
        await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.deepEqual(result, { parentPreserved: true, oldReadAborted: true, lateResponseHidden: true, pendingPreserved: true, posts: 0 });
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
});
