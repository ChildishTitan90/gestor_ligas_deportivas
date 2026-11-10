# PDGLD-107 — HTTP 500 de Turbopack: reproducción de arranque preparada

La preparación inicial fue sin servicios. El probe se ejecutó posteriormente;
los resultados actuales están al final de este documento. No se cambió negocio,
readiness o bundler ni se aplicó una corrección de entorno sin causa comprobada.

## Hallazgos comprobados

El run `e31eb0cf-87aa-4ff0-90f9-61c8db43272b` falló en
`account-isolated-worker.mjs:113:12`, `assert.ok(ready)`, actual false/expected true.
Se recibió HTTP 500 de `/api/auth/csrf`; las categorías fueron module-resolution
y turbopack-error. El diagnóstico anterior no conservaba el módulo ni el contexto
de importación. No puede recuperarse su nombre o ruta exactos de esos registros.

| Aspecto | HTTP/SSR aprobado | Navegador fallido |
| --- | --- | --- |
| Copia | `createAccountAppCopy`, archivos allowlist | Mismo mecanismo |
| cwd | copia `app-pgN` | copia `app-pgN` |
| Dependencias | symlink a node_modules instalado | Mismo symlink |
| Bundler | Webpack | Turbopack |
| Configuración de copia | configuración original | root=copia; additionalRoots.installedDependencies=node_modules instalado |
| Readiness | csrf HTTP 2xx | csrf HTTP 500 |

La lista copiada contiene src, public, prisma, package.json/package-lock,
next.config.ts, tsconfig.json y next-env.d.ts si existe. Excluye `.env*`,
prisma.config.ts, compose.yml, .git y artefactos Next. Los imports `@/*` conservan
su destino `./src/*`. El ejecutable Next es el instalado, con cwd de la copia.
No hay enlaces de origen permitidos dentro de los archivos copiados; el único
enlace añadido deliberadamente es node_modules.

La documentación instalada de Next 16.4 permite additionalRoots para cruzar
fronteras de symlinks, pero no imports relativos que salgan de la raíz. No se
amplió root al repositorio ni al HOME. La regla CSS de Tailwind y workerThreads
se conservan. La inspección estática no demuestra qué dependencia transitoria
o resolución interna de Turbopack falla.

Node resuelve en el origen los entrypoints de next/dist/bin/next, next/server,
next-auth, @prisma/client, @prisma/adapter-pg y @tailwindcss/turbopack. Esto no
equivale a resolverlos desde Turbopack en la copia.

## Reproducción mínima propuesta

```sh
# Plan sin servicios, ya comprobado:
npm run test:account-startup-isolated -- --run-id 9b20d39a-8e8c-4a92-91ea-3fcc8f7d6a21

# Pendiente de autorización:
npm run test:account-startup-isolated -- --execute --run-id 9b20d39a-8e8c-4a92-91ea-3fcc8f7d6a21
```

Entrada: `scripts/verification/account-startup-probe.mjs`. Reutiliza el copiador,
configuración Turbopack y saneador existentes. Arranca únicamente Next con
Turbopack en `127.0.0.1:56515` y consulta únicamente GET `/api/auth/csrf` sin
cookies, login ni usuarios. No requiere Docker, PostgreSQL, Chrome, roles,
migraciones, fixtures o seeds. No hay matriz 15/17.

`/api/auth/csrf` compila el grafo real de autenticación pero no ejecuta el login
ni callbacks de sesión autenticada. Prisma se construye de forma diferida y el
probe no proporciona DATABASE_URL/DIRECT_URL/PG*; no tiene un destino de base.
Se usa el allowlist de entorno del supervisor y un secreto NextAuth efímero.
No se carga el `.env` habitual. No se solicitan páginas con fuentes remotas.

Recursos:

- `/private/tmp/pdgld-startup-9b20d39a-8e8c-4a92-91ea-3fcc8f7d6a21/app`:
  copia privada con symlink solo a dependencias instaladas. Rechaza reutilización
  del directorio de ejecución y puerto ocupado.
- Un hijo Next propio; conserva el mismo límite de polling/readiness del worker.
  El aviso de actualización tiene el mismo máximo de dos arranques que el worker.
- `startup.json` bajo el directorio de ejecución: paths de cwd/root/enlace real/
  ejecutable/ruta, readiness, categorías y módulos sin resolver identificados.

El extractor conserva nombres exactos solo si coinciden con imports de código,
dependencias declaradas o nombres de archivos de dependencias instaladas,
incluidas variantes de ruta virtual conocidas de Turbopack. Solo lee contenido
de fuentes y package.json; de node_modules enumera nombres. La salida de Next y
el cuerpo HTTP 500 se procesan en memoria acotada, sin imprimir ni persistir logs
brutos, cabeceras, cookies, tokens, cuerpos exitosos CSRF o conexiones. No hay
garantía de extraer un formato de error desconocido: se reportará esa limitación
sin atribuir una causa inventada.

Limpieza en finally: SIGTERM al hijo propio, SIGKILL tras 2 s si no termina,
espera de cierre y eliminación exclusiva de `app`. Se conserva `startup.json`.
Sin prune, instalaciones, cambios de configuración original ni recursos Docker.
Una caída por SIGKILL del supervisor requiere verificar PID/ruta propios y puerto
antes de afirmar limpieza; no se matan procesos por puerto. El exitCode del hijo
puede corresponder al apagado controlado y no demostrar que compiló correctamente.

## Pruebas sin servicios

52 pruebas `test:ci` aprobadas. Cubren copia/configuración sintética, guardas de
destino, modo plan, extracción por allowlist (rechazando un secreto sintético),
diagnóstico y limpieza simulada del supervisor. Sintaxis y diff-check aprobados.
No se inició ningún servicio durante esta preparación.

## Diagnóstico retomado el 30 de octubre de 2026

Base: `fb64b4f068b6121063475333320524725436e0c0`, con cambios locales de
PDGLD-106/107/108 conciliados. Se leyó el `startup.json` original del run
`9b20d39a-8e8c-4a92-91ea-3fcc8f7d6a21`: ready=false, HTTP 500,
module-resolution/turbopack-error, unresolvedModules=[pg], cleaned=true.
La ruta registrada es `src/app/api/auth/[...nextauth]/route.ts`; la petición fue
GET `/api/auth/csrf`. El registro no conserva el importador exacto ni una causa
interna de resolución.

Comprobaciones sin servicios:

- `pg` 8.23.1 está físicamente instalado, con entrypoint CommonJS
  `node_modules/pg/lib/index.js` y wrapper ESM `pg/esm/index.mjs`.
- `@prisma/adapter-pg` 7.10.1 declara dependencia de pg; su ESM importa pg.
- Node resuelve pg desde el origen, desde la copia y desde el adaptador en ella.
  Esto no prueba la resolución de Turbopack.
- node_modules original es un directorio; el copiador crea un symlink hacia él.
  cwd y turbopack.root son la copia; la única raíz adicional es el node_modules
  instalado. La configuración original, regla CSS y alias @/* se conservan.
- El arranque habitual usa el repositorio y su detección de raíz. El aislado usa
  copia, raíz explícita, raíz adicional, entorno allowlist sin .env ni destino
  de base, y AUTH_TEST_RUN=1 para `.next-auth-tests`. No se inició el arranque
  habitual ni se leyeron sus archivos de entorno. La comparación es estática.

Ejecuciones mínimas (sin PostgreSQL, Docker, Chrome, login ni cookies):

| Run | Variante | Resultado |
| --- | --- | --- |
| `2e64eb05-1bc6-4d84-bd80-f2fb39bb71cc` | Sandbox | probeFailed antes de HTTP; cleaned=true. No diagnostica pg. |
| `5a8fc203-bf87-4a91-98cb-fc7bd9494ee4` | Copiador actual, fuera del sandbox | HTTP 500, pg sin resolver; ready=false, cleaned=true. |
| `6dc957a1-40f9-4c19-9045-27b82c11fcaa` | Comparación temporal con node_modules local y enlaces por paquete | Mismo HTTP 500 y pg sin resolver; ready=false, cleaned=true. |

Cada registro se conserva en `/private/tmp/pdgld-startup-<run-id>/startup.json`.
La comparación reutilizó el probe con un copiador temporal en
`/private/tmp/pdgld-startup-layout-comparison.mjs`; no se incorporó esa variante
al proyecto. Cambiar solo el enlace de la carpeta no solucionó el fallo.
No se amplió la raíz al repositorio/HOME, ni se añadieron aliases, instalaciones,
externalizaciones o cambios a Webpack para intentar ocultarlo.

Se añadió la categoría fija external-package-resolution al diagnóstico, con
prueba de saneamiento; no apareció en estos fallos. Sigue faltando el contexto
exacto de resolución de Turbopack para justificar una corrección del entorno.
Los logs brutos y cuerpos HTTP no se persistieron. No se afirma una causa raíz.

## Captura original privada y diagnóstico completo (30 de octubre)

Run `c794c2ab-ef02-4cc0-b451-87743379af56`, misma base `fb64b4f` y mismo
copiador/configuración. Solo se instrumentó captura; no se probaron aliases,
raíces alternativas, externalización ni otro bundler. El comando fue
`npm run test:account-startup-isolated -- --execute --run-id c794c2ab-ef02-4cc0-b451-87743379af56`.

Resultado: HTTP 500, ready=false, cleaned=true. Se conservó fuera del repositorio
la salida original de Next stdout/stderr, el log de desarrollo, el primer cuerpo
HTTP de error y las configuraciones Next/TypeScript de la copia. Hay copia privada
duradera en Documents, carpeta `PDGLD-107-diagnostico-c794c2ab-ef02-4cc0-b451-87743379af56`,
con archivos 0600, directorios 0700 y hashes verificados contra el original en
`/private/tmp/pdgld-startup-c794c2ab-ef02-4cc0-b451-87743379af56`.
`private-manifest.json` registra SHA-256; `diagnostic-sanitized.json` contiene
82 contextos únicos de error, correspondientes a 27 identificadores sin resolver.
No se publica aquí la salida original.

### Mensaje e importador exactos

```text
Module not found: Can't resolve 'pg'
[@installedDependencies]/@prisma/adapter-pg/dist/index.mjs:3:1
> 3 | import pg2 from "pg";
```

El mismo mensaje aparece en `index.mjs:13:1`, para `import pg from "pg"`.
La cadena registrada (desde importador hacia entrada) es:

```text
App Route:
  [@installedDependencies]/@prisma/adapter-pg/dist/index.mjs
  ./src/server/db/prisma.ts
  ./src/server/auth/persistent-session.ts
  ./src/server/auth/options.ts
  ./src/app/api/auth/[...nextauth]/route.ts
```

Es compilación de servidor/App Route, no una importación de Prisma desde UI
cliente. La resolución falla al compilar; el registro no presenta un error de
`require` de Node en tiempo de ejecución ni un rechazo explícito de externalización.

### Contexto mayor del fallo

No falla solamente pg. Ejemplos de otros mensajes exactos:

- `Module not found: Can't resolve '.prisma/client/default'`, desde
  `[@installedDependencies]/@prisma/client/default.js:2:6`, misma cadena App Route.
- `Module not found: Can't resolve '@prisma/driver-adapter-utils'`, desde
  `[@installedDependencies]/@prisma/adapter-pg/dist/index.mjs:2:1`.
- Fallan también cookie, jose, @babel/runtime, @swc/helpers y scheduler, entre
  otros. Los registros incluyen contextos App Route, Browser y SSR: hay un fallo
  de resolución transitiva más amplio que el primer identificador saneado.

Se verificó sin servicios que Node resuelve pg y driver-adapter-utils desde el
adaptador, .prisma/client/default desde Prisma, cookie desde NextAuth y
@swc/helpers desde Next. Son archivos realmente instalados. No demuestra que el
resolver de Turbopack haga el mismo recorrido.

### Rutas, configuración y externalización

`<COPY>` representa el directorio `app` de este run; `<REPO>` el repositorio local.

| Propiedad | Valor |
| --- | --- |
| cwd / turbopack.root | `<COPY>` |
| enlace node_modules | `<COPY>/node_modules` → `<REPO>/node_modules` |
| raíz adicional installedDependencies | `<REPO>/node_modules` |
| ejecutable | `<REPO>/node_modules/next/dist/bin/next` |
| URL / petición | `http://127.0.0.1:56515/api/auth/csrf` |
| salida Next | `.next-auth-tests` (desarrollo: subdirectorio `dev`) |
| aliases / regla CSS | originales, sin cambios |
| serverExternalPackages explícito | no configurado |
| configuración restante | agentUpgrade=security; estrategia CSS workerThreads original |

La documentación instalada y `next/dist/lib/server-external-packages.jsonc`
incluyen pg en la lista automática de externos; @prisma/adapter-pg no está en
esa lista. `serverExternalPackages` usa `require` nativo para paquetes excluidos
del bundle. Esa lista no demuestra que una resolución de paquete haya tenido
éxito: el diagnóstico observado es `Module not found` en el grafo compilado.
No se añadió ninguna exclusión.

La documentación de `turbopack` indica que las raíces adicionales se cruzan por
symlink; no permite imports relativos que escapen de una raíz y desaconseja
ampliar la raíz al HOME. La configuración actual enlaza a un node_modules que
constituye por sí mismo la raíz adicional.

**Hipótesis respaldada, aún no validada:** la búsqueda de paquetes transitivos
originada dentro de `installedDependencies` no encuentra sus paquetes hermanos
con esta disposición de raíces, aunque Node sí los encuentre. La multiplicidad
de fallos y sus importadores apoyan investigar el recorrido de búsqueda en esa
raíz y su interacción con la externalización automática. El diagnóstico no
revela los candidatos internos de búsqueda; no permite afirmar todavía el
algoritmo exacto ni escoger una corrección concreta. No se ejecutaron ensayos
de configuración tras formular esta hipótesis.

### Alcance de la captura y pruebas

Se conservaron completos los streams Next y su log de desarrollo; el cuerpo de
error se capturó con límite de 64 KiB (en este run: 4730 bytes). No se capturaron
respuestas CSRF exitosas, cabeceras, cookies ni entorno. No hubo fichero panic
independiente en el temporal propio. El trace de rendimiento de este run no se
conservó antes de limpiar la copia; el helper ya contempla esos paths para una
captura futura, con prueba pura. Esto no elimina los mensajes y cadenas de error
conservados en los logs originales.

Pruebas puras de captura: bytes originales, permisos restrictivos, rechazo de
reutilización, conservación de diagnósticos/trace y exclusión de symlinks.
No se cambió autenticación, lógica de dominio, copiador ni configuración Next.

## Prueba controlada preparada: instalación independiente

No ejecutada. Se elige una sola variante para contrastar el fallo de dependencias
transitivas desde `installedDependencies`: instalar el mismo lockfile en la copia,
con un directorio node_modules propio dentro de su raíz. Se mantienen Turbopack,
la petición CSRF, el código de aplicación y la externalización predeterminada.
La variante no usa raíces adicionales ni enlaces a paquetes del repositorio.
Esto sigue la disposición normal `<COPY>/node_modules/<package>` y evita cruzar
raíces para buscar dependencias hermanas. No se afirma que esté corregido hasta
obtener la respuesta del probe.

El copiador admite `dependencies: independent` solo cuando se solicita; los
perfiles existentes conservan su comportamiento. La configuración temporal fija
root a la copia y conserva las reglas CSS; no añade aliases ni externalizaciones.
El Next ejecutado será el instalado en la copia, no el del repositorio.

Plan sin servicios e instalación, ya comprobado:

```sh
npm run test:account-startup-isolated -- --independent-dependencies --run-id d47db239-b3fe-4e0a-a210-867dd42c604b
```

Comando de ejecución propuesto, pendiente de autorización:

```sh
npm run test:account-startup-isolated -- --execute --independent-dependencies --run-id d47db239-b3fe-4e0a-a210-867dd42c604b
```

Efectos concretos:

- Directorio nuevo `/private/tmp/pdgld-startup-d47db239-b3fe-4e0a-a210-867dd42c604b`,
  copia privada en `app`; se rechaza reutilizar el run y un puerto ocupado.
- `npm ci --include=dev --foreground-scripts --no-audit --no-fund`, registro
  público `https://registry.npmjs.org/`; caché y configuraciones npm vacías bajo
  `npm-work`. No se copian `.npmrc` ni `.env`; no se heredan credenciales npm,
  NODE_OPTIONS o conexiones de base. XDG_CACHE_HOME y TMPDIR apuntan al run.
- Puede descargar paquetes/binarios y ejecutar los scripts de instalación
  permitidos por el proyecto/lockfile, incluido `postinstall: prisma generate`.
  Este genera el cliente local: no se ejecutan seeds ni comandos de migración.
  Se detiene antes de instalar si cambian los scripts de ciclo de vida revisados.
- Se comprueban SHA-256 de package.json y package-lock.json antes/después; se
  rechazan modificaciones. npm ci usa las versiones del lockfile. Se contrastan
  además las versiones instaladas de Next, pg, Prisma/adaptador y React, y se
  comprueba que las rutas resueltas de pg, adaptador, Next y cliente generado
  permanezcan dentro del node_modules propio.
- Instalación con límite de diez minutos; npm y sus hijos tienen un grupo de
  procesos propio, detenido ante cancelación/timeout y cerrado al terminar.
  Si falla instalación o verificación, no se inicia Next.
- Next/Turbopack escucha solamente `127.0.0.1:56515`; GET `/api/auth/csrf`, sin
  login, cookies, base de datos, Docker, Chrome o Preview/RLS. Conserva el mismo
  polling/readiness y apagado del probe. NEXTAUTH_SECRET es efímero.
- Logs originales privados de npm y Next, configuraciones y diagnósticos/trace
  quedan bajo `private` con permisos restrictivos; el resumen no publica logs.

Limpieza en finally: detener los procesos propios, preservar diagnóstico privado,
eliminar solo `app` (incluido su node_modules independiente) y `npm-work`
(caché/configuración/temporales de instalación). Se conservan startup.json y la
evidencia privada. No se hace prune ni se toca node_modules original o compose.yml.
Una terminación abrupta por SIGKILL del supervisor requiere inspeccionar recursos
propios antes de afirmar limpieza.

Criterio de contraste: si supera instalación/versiones y devuelve CSRF 2xx, apoya
que la disposición de dependencias externas originaba el fallo anterior. Si la
instalación falla, no permite concluir nada sobre Turbopack. Si persiste HTTP 500,
se extrae el diagnóstico privado antes de proponer otra modificación.

Pruebas puras aprobadas: 58 de test:ci, incluidas selección explícita sin efectos,
copia sin enlace/raíz adicional, conservación de manifests, rechazo de scripts
no revisados, aislamiento de configuración/entorno y detección de lock modificado.
No se instaló ningún paquete ni se inició ningún servicio durante la preparación.

## Resultado posterior de la instalación independiente

La ejecución autorizada `d47db239-b3fe-4e0a-a210-867dd42c604b` terminó con éxito:
npm ci y prisma generate correctos, versiones del lockfile verificadas, CSRF HTTP
200 con Turbopack, ready=true, sin errores de resolución y cleaned=true. Se
verificaron ausencia de copia/npm-work, procesos propios y listener 56515, además
de integridad de los manifiestos, compose.yml y controles de dependencias originales.

El run-id está consumido. Sus evidencias privadas, incluidas salida Next/npm y
trace, forman parte del archivo duradero de cinco ejecuciones descrito en la
[matriz actualizada](account-delegate-acceptance-matrix.md). Los perfiles de
navegador y Preview/RLS adaptados posteriormente aprobaron también en PG15/17.
Las secciones previas de preparación y los fallos se conservan como cronología;
no representan el estado pendiente actual. No se repitió este probe al documentar.
