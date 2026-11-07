# PDGLD-118 — foco de la suite sintética en CI #137

Diagnóstico del 6 de noviembre de 2026 sobre `b7102b56f7a1b88089c6bb8fb7167892439dd5a9`.
La corrección actual es local: sin staging, commit, push ni cambios remotos.

## Estado remoto, sin repetir PostgreSQL

Se dejaron terminar los jobs existentes del
[CI #137](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42252868584):

| Job | Resultado final |
| --- | --- |
| [Aplicación](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42252868584/job/128012299643) | Falló en «Probar inscripción en Chrome con datos sintéticos» |
| [PostgreSQL 15](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42252868584/job/128012299290) | Aprobado |
| [PostgreSQL 17](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42252868584/job/128012299548) | Aprobado |
| CI listo para integrar | Fallido por Aplicación |
| Migraciones Supabase producción | Omitido |

Solo se consultó GitHub en lectura. No se ejecutaron jobs nuevos, PostgreSQL local,
Supabase o proveedores reales. La nueva corrección aún no se ha probado en CI remoto.

## Paso exacto y causa reproducida

La condición que venció en `team-registration-session.test.mjs:101` de b7102b5 fue:

```js
document.activeElement.id === "next-control" &&
!document.querySelector("[role=listbox]")
```

CDP ya estaba conectado. El log conservaba `menus=Otro club` y
`fields=fixture-choice:true:false`, pero no el foco real ni document.hasFocus().
La reproducción `.214` conservó la condición y reprodujo el fallo:

| Fase | Documento / foco | Evento y estado |
| --- | --- | --- |
| Antes de deshabilitar | hasFocus=false; activeElement=choice | La fixture ya estaba ejecutando acciones durante readyState=loading |
| Fieldset deshabilitado | activeElement=body | No llegaron blur/focusout; MutationObserver cerró el selector deshabilitado |
| Rehabilitar y reabrir | activeElement=body | dispatchEvent(keydown ArrowDown) se envió a choice, sin tener el foco; isTrusted=false |
| Manejador de ArrowDown | Documento inactivo | preventDefault=true; React abrió el menú, como indica su manejador |
| `.focus()` original sobre next-control | activeElement=next | No se generaron focus/focusin; el listbox siguió abierto |

**El paso original no pulsaba Tab.** Generaba ArrowDown con KeyboardEvent y luego
movía el foco por API DOM. Ese helper comprueba manejadores, pero no reproduce la
acción por defecto del navegador ni el orden nativo de tabulación.

En [SelectField](../../src/components/ui/select-field.tsx), el efecto activo instala
un listener focusin de documento para cerrar al salir del control. No hay un
manejador blur que cierre por separado. Con el documento inactivo faltaba el evento
que ese contrato necesita. No era evidencia de que el componente ignorara un blur
o de que necesitara forzar su cierre.

La navegación nueva del harness conectaba la página about:blank propia y llamaba
a Page.navigate, pero no activaba su pestaña. Conectar y cargar una URL no probaba
que el documento tuviera foco. Además, la fixture iniciaba su IIFE mientras se
parseaba el bundle, antes de que launchChrome devolviera su documento listo.

El contraste `.215` cambió **solo la activación previa a navegar** en la copia del
harness, manteniendo componente, fixture y condición originales. Aprobó: hasFocus
pasó a true, llegaron blur/focusout al deshabilitar y focus/focusin al salir, y el
efecto existente de React cerró el menú. Inmediatamente después de focusin aún se
observaba expandido; la espera original observó después el commit cerrado sin
flushSync adicional ni cierre forzado. Esto reproduce la causa de preparación;
el CI original no registró hasFocus, por lo que no se le atribuye una traza nueva.

## Corrección y cobertura

- [Harness](../../tests/e2e/chrome-session.mjs): activa únicamente el target propio
  verificado con Page.bringToFront antes de navegar y comprueba document.hasFocus().
  Con waitForDocument vuelve a comprobar documento cargado y activo al devolverlo.
  El diagnóstico añade pageActivatedMs. No se enfoca un campo ni se emulan eventos.
- [Suite afectada](../../tests/e2e/team-registration-session.test.mjs): una promesa
  inicia las acciones solo cuando el driver tiene el documento completo y activo.
  Se mantiene íntegra la condición original y el caso de foco programático.
- Se añade un recorrido con clic y rawKeyDown/keyUp de Tab mediante CDP. El clic
  ubica al usuario en el input; Tab sale por la acción por defecto: primero al
  botón Restablecer y luego a Siguiente, conforme al DOM existente. No se cambia
  tabIndex ni se llama a focus/close para conseguir ese resultado. Se comprueban
  isTrusted=true, defaultPrevented=false, blur y conservación de foco/cierre.
- [Regresión del harness](../../tests/e2e/chrome-session.test.mjs): comprueba
  activación al empezar las interacciones y Tab real entre dos inputs. El servidor
  de fixtures declara text/html; charset=utf-8. No cambia el servidor de producto.

El documento puede estar aún sin foco en la primera instrucción del parser aunque
esté activo al terminar de cargar. Se midió focusedAtScript=false y
focusedWhenReady=true en la regresión final. El contrato verificado es iniciar
interacciones con el documento listo, no exigir foco antes del commit inicial.

El diagnóstico de la suite está acotado a 80 entradas con identidades permitidas
(choice, reset, next, body, other, none), fases, teclas permitidas, flags y estados.
No incluye valores escritos, etiquetas de negocio, HTML, cookies, URLs o tokens.
Captura eventos antes/después de la propagación para ver preventDefault y las
actualizaciones de React. La señal de inicio no reintenta una acción ni cambia
resultados; tampoco sustituye la espera del loader exacto existente.

Referencia primaria: [Page.bringToFront activa la pestaña](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl)
y [eventos Input de CDP](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Input.pdl).

## Ejecuciones locales, solo navegador sintético

| Intento | Suite afectada | Harness | Diagnóstico |
| --- | --- | --- | --- |
| `.214` | Falló, misma condición | No ejecutado | Documento inactivo, sin eventos de foco |
| `.215` | 1/1 | No ejecutado | Contraste: solo activación previa; componente intacto |
| `.216` | 1/1, incluido Tab nativo | 5/6 | La nueva fixture sin MIME HTML dejó su script sin ejecutar |
| `.217`, diagnóstico nativo | No se repitió | Solo diagnóstico de fixture | text/plain, scriptDefined=false, inputExists=false |
| `.218` | 1/1 | 5/6 | Nueva aserción exigía foco demasiado pronto, durante el parser |
| `.219`, final | **1/1** | **6/6** | Documento listo/activo, foco programático y Tab nativo aprobados |

Los errores de preparación de las regresiones nuevas se conservaron, sin
atribuirlos al componente. Se corrigió el MIME y se midió por separado parser e
inicio de interacción; no se eliminó ni relajó la aserción original del CI.

En `.219`, native-open registró choice, expanded=true y listbox=true. El primer
Tab registró trusted=true y prevented=false; native-reset observó reset, menú
cerrado. El segundo Tab llevó a next con menú cerrado. También aprobaron el caso
original de foco externo y todas las comprobaciones previas de la suite completa.
No se ampliaron timeouts de las pruebas, comandos o esperas; no se añadieron pausas
arbitrarias. Syntax, lint y diff --check aprobaron.

Cada copia usó npm ci independiente, sin .env ni node_modules compartidos, con
lockfile/registro/versiones e integridad conservados. No se ejecutaron otras suites,
servicios de aplicación, matrices de correo, bases o APIs reales. Chrome/HTTP se
cerraron por sus propietarios. Las copias, dependencias, perfiles y procesos
propios de `.214`, `.215`, `.216`, `.218` y `.219` quedaron ausentes; el diagnóstico
nativo `.217` terminó tras cerrar su Chrome y HTTP. La verificación final de
procesos se realizó sin terminar procesos por patrón.

El [resultado saneado](pdgld-118-ci137-results.json) conserva el resumen; los scripts
temporales, trazas originales y evidencia privada permanecen fuera de Git en las
raíces propias de /private/tmp. Se conservan compose.yml, los tres documentos
internos account-delegate-*, respaldos y nueve stashes. SelectField no se modificó.
Sin staging, commit o push; no se integra develop ni se edita el PR.
