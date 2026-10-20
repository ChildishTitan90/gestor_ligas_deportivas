# PDGLD-71 — Dependencias y comprobaciones del 19/10/2026

## Resultado actual

Sobre develop integrado hasta `8141346`, se retomó el trabajo guardado del
16/10. Se actualizaron únicamente Prisma CLI, Client y adapter-pg de 7.10.0 a
**7.10.1**, con sus transitivas necesarias. El lockfile resuelve ahora
`deepmerge-ts@8.0.2` y `mysql2@3.24.4`. Se conservan versiones exactas para
todas las dependencias directas y el lockfile versionado.

Entorno: Windows x64, Node **24.21.0**, npm **11.19.0**. `package.json` declara
Node 24.x, npm >=11.19.0 <12 y packageManager npm@11.19.0; `.npmrc` activa
`engine-strict` para impedir instalaciones con runtimes incompatibles o npm
que no respete la política de scripts revisada. El workflow existente usa Node
24; su ejecución con este cambio debe confirmar también el requisito de npm.

**El trabajo técnico tiene comprobaciones aprobadas y pendientes concretos.
La subtarea todavía no cumple su cierre:** el usuario aportó un build de producción
satisfactorio desde su terminal; faltan decisión de revisión sobre el hallazgo residual, publicación/revisión
del PR y comprobación del entorno de pruebas según DoD. No se registra riesgo
aceptado ni se atribuyen resultados de otros PR a este cambio.

## Auditoría del lockfile actual

Evidencia reproducible, resumen anterior y reportes finales sin secretos:
[pdgld71-audit.json](pdgld71-audit.json). Incluye fecha, entorno, base y SHA-256
del lockfile; al crear el commit del cambio se debe añadir su SHA al PR/Jira.

| Ejecución real del 19/10 | Resultado | Código de salida |
| --- | --- | --- |
| Antes: npm audit --json --ignore-scripts | 9 entradas altas, 0 críticas | 1 |
| Después: npm audit --json --ignore-scripts | 5 entradas altas, 0 críticas | 1 |
| Después: npm audit --omit=dev --json --ignore-scripts | 0 avisos | 0 |

Los conteos son entradas de paquetes y propagaciones de avisos, no un conteo de
fallos independientes. El resultado omit=dev evalúa ese subconjunto del lockfile;
no certifica que un futuro artefacto de despliegue excluya todas las herramientas.

| Paquete/ruta | Tipo y exposición comprobada | Resultado / siguiente acción |
| --- | --- | --- |
| prisma (directa de desarrollo) → @prisma/config → deepmerge-ts | Configuración de CLI. No se encontró paso de payloads HTTP a prisma.config.ts. El peer opcional del Client puede conservar la CLI en instalaciones de producción. | Actualización compatible 7.10.1: deepmerge-ts 8.0.2. GHSA-ggr8-5vv4-36mx ya no aparece en el audit final. |
| prisma → mysql2 | Transitiva de la CLI. El backend usa PostgreSQL con PrismaPg; no se encontró conexión MySQL en la aplicación. | mysql2 3.24.4: ya no aparecen GHSA-3f6p-5ww8-9rcr ni GHSA-rgwj-5xj2-c3m3. |
| eslint-config-next 16.4.0 → @next/eslint-plugin-next 16.4.0 → fast-glob 3.3.1 → micromatch 4.0.8 → braces 3.0.3 | Una dependencia directa de desarrollo y cuatro transitivas. Riesgo de agotamiento de pila al procesar patrones profundamente anidados. Uso identificado en tooling de lint; no se encontró una entrada de la aplicación que invoque esta cadena con datos HTTP. Configuración/patrones del repositorio y entradas de CI requieren revisión. | Residual: GHSA-vfj7-8cjw-p6xm. Sergio conserva seguimiento; Víctor debe revisar el tratamiento propuesto y decidir el cierre. No aceptado automáticamente. |

Fuentes verificadas: el audit actual de npm, metadatos `npm view` de cada versión
y el [advisory de braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
El advisory declara que no hay versión corregida; el registro npm publicado
termina en braces 3.0.3. También se comprobaron los paquetes Next 16.4.1/16.4.2:
su plugin sigue dependiendo de fast-glob 3.3.1, por lo que actualizarlos no resuelve
este hallazgo. No se hizo un cambio de Next sin relación con la corrección.

**Propuesta de tratamiento para revisión de Víctor:** conservar el hallazgo
abierto como riesgo de tooling, revisar los patrones/configuración que ejecuta
CI y actualizar la cadena cuando se publique una solución compatible.
Sergio debe adjuntar un nuevo audit al aplicar esa solución. Si se decide diferirlo,
registrar explícitamente responsable, decisión y siguiente revisión en Jira.
No se sustituye esta decisión por un audit verde artificial ni por eliminar reglas.
No se usaron audit fix --force, legacy-peer-deps ni overrides incompatibles.

## Compatibilidad y deprecación ESLint

Las peerDependencies instaladas y `npm ls --all --omit=optional` son compatibles,
sin problemas de dependencias. Se verificaron Next 16.4.0, React/React DOM 19.3.0,
TypeScript 5.9.3, Prisma/Client/adapter-pg 7.10.1, Zod 4.6.5 y NextAuth 4.24.15.
NextAuth admite Next 16 y React 19; Prisma admite Node 24 y TypeScript >=5.4.
El flujo integrado con PostgreSQL se volvió a ejecutar con estas versiones.

Se conserva ESLint 9.39.5 y se documenta su deprecación. Las versiones publicadas
consultadas de eslint-plugin-react 7.37.5 y eslint-plugin-import 2.32.0 admiten
ESLint hasta 9, por lo que ESLint 10.13.0 no constituye hoy una actualización
compatible de este conjunto. Esta advertencia no se cuenta como una vulnerabilidad
adicional. Sergio debe reevaluarla cuando ambos plugins publiquen soporte compatible.

## Scripts de instalación: decisión acorde con npm 11.19

Se inspeccionaron los scripts locales, el origen de los tarballs/integridades del
lockfile y la implementación de `allowScripts` del npm instalado. La instalación
inicial de inspección usó ignore-scripts; la comprobación final ejecutó **npm ci
normal** con la política explícita de package.json, sin habilitación global.

| Paquete | Política | Justificación |
| --- | --- | --- |
| prisma@7.10.1 | Permitir esa versión | preinstall valida la versión Node. |
| @prisma/engines@7.10.1 | Permitir esa versión | postinstall prepara/descarga el motor de esquema que usa la CLI, con la versión fijada por Prisma. |
| argon2@0.45.1 | Permitir esa versión | node-gyp-build carga el binding nativo de hashing; hash/verificación sintéticos comprobados. |
| esbuild@0.28.2 | Permitir esa versión | Prepara/verifica el binario de plataforma utilizado por tsx; transformación TypeScript comprobada. |
| unrs-resolver | Omitir el script | El binding opcional fijado para Windows está presente y ResolverFactory carga correctamente sin el postinstall. Se evita el fallback de descarga fuera del flujo normal del lockfile. Lint también pasó. |
| fsevents | Omitir el script | Dependencia opcional para observación en macOS; no es necesaria para el entorno Windows comprobado ni el CI Linux. No se comprobó desarrollo en macOS. |

`unrs-resolver@1.12.2` procede de registry.npmjs.org y del repositorio
https://github.com/unrs/unrs-resolver. Su postinstall delega en
`napi-postinstall@0.3.4`: comprueba versiones/bindings y puede ejecutar npm o
descargar un tarball si falta el binding. El script no es necesario cuando
ese paquete opcional ya está instalado. No se interpretó su nombre como evidencia
de código malicioso. Al cambiar plataforma se necesita el binding opcional
correspondiente; no instalar con omit=optional para desarrollar.

`npm approve-scripts --allow-scripts-pending` informó que no quedan scripts sin
revisar. No se cambió la configuración global. La política se debe revisar al
actualizar cualquiera de las versiones aprobadas. Fuente adicional:
[configuración npm allow-scripts](https://docs.npmjs.com/cli/v11/using-npm/config/#allow-scripts).

## Comprobaciones reales y límites

| Comprobación con el lockfile actualizado | Resultado |
| --- | --- |
| npm ci --no-audit --no-fund | 523 paquetes; postinstall genera Prisma Client 7.10.1 correctamente |
| Generación y bindings | Prisma, unrs-resolver, esbuild y Argon2 comprobados |
| npm ls --all --omit=optional | Salida 0, sin problemas declarados |
| npm run lint | Correcto |
| npm run typecheck | Correcto, sin omitir errores |
| npm run test:ci | 12/12 |
| npm run test:session-policy | 6/6 |
| Cuerpo existente de test:auth, node scripts/test-auth.mjs | 83/83: 63 HTTP y 20 de autorización; 0 fallos/omisiones |
| npm run test:seed | 26/26: 19 base y 7 perfiles/catálogo |
| npm run build, Windows Node 24.21.0 | Falló por descarga de fuentes dentro del sandbox; con acceso externo falló el proceso CSS de Turbopack antes de conectarse por IPC |
| npm run build desde la terminal del usuario, Windows Node 24.21.0 | Correcto según salida compartida: Next 16.4.0 compiló, terminó TypeScript, generó 11/11 páginas y finalizó la optimización |
| next build con Node 24.19.0 ya instalado | Mismo fallo CSS/IPC; no demuestra que cambiar a ese runtime lo resuelva |
| Contraste build Linux | No ejecutado: se rechazó autorizar la descarga del contenedor Node |
| CI/PR/entorno del cambio PDGLD-71 | Pendiente de publicación y revisión |

La prueba de autenticación utilizó un PostgreSQL 15 propio con tmpfs y publicación
únicamente en loopback IPv6, separado del contenedor del equipo en IPv4:5433.
El runner creó y eliminó su base temporal y detuvo su servidor; se eliminó su
contenedor propio. test:seed utilizó su propio contenedor desechable y también
lo detuvo. La reserva Windows del puerto 5432 impidió el primer intento;
se comprobó que no quedó el contenedor de ese intento. No se usaron datos de
Supabase ni se migró la base persistente del equipo.

El problema de CSS/IPC ya estaba registrado en la revisión del 16/10. La
documentación instalada de Next 16.4 indica que Node >=24.13.1 desactiva
workerThreads por un problema de cierre de workers con módulos nativos; ambos
runtimes probados entran en ese caso y usan childProcesses. No se atribuye el
fallo de build a Prisma sin evidencia, ni se fuerza una opción insegura para
ocultarlo. Posteriormente, el usuario ejecutó npm run build en su terminal y
compartió la salida completa satisfactoria: compilación en 2.2 s, TypeScript
en 7.2 s y 11/11 páginas generadas. El aviso de workerThreads siguió presente,
pero el fallback automático a childProcesses permitió completar ese build.
Esta es evidencia aportada por el usuario, no una ejecución exitosa del agente;
no establece la causa del fallo anterior. El hash local del lockfile se mantiene
igual al registrado en el audit. Los resultados de CI de otros commits no
validan este lockfile.

## Pendientes de cierre

1. Confirmar el build en CI del nuevo PR; el build local ya pasó en la terminal
   del usuario según la salida aportada.
2. Víctor: revisar el hallazgo residual de braces y la propuesta documentada.
   Si se difiere, registrar la decisión pertinente y el seguimiento de Sergio.
3. Publicar rama/commit/PR con clave PDGLD-71 hacia develop. Adjuntar este informe
   y audit, obtener revisión de otra persona y comprobar CI listo para integrar.
4. Integrar y verificar el entorno de pruebas según DoD antes de pasar a Hecho.

## Antecedente histórico del 16/10/2026

Lo siguiente conserva la revisión previa sin conexión. Sus estados de versiones,
build y auditoría corresponden a esa fecha y quedan sustituidos por el informe
actual precedente.

## Resultado y alcance

Se completó la revisión local de compatibilidad y del script de `unrs-resolver`, y se fijaron las dependencias directas a las versiones que ya resolvía `package-lock.json`. No cambiaron los paquetes instalables, sus versiones, URLs ni integridades. Esta fijación evita actualizaciones implícitas al modificar el manifiesto, pero **no corrige las alertas de seguridad**.

Por instrucción del usuario, esta revisión utiliza únicamente archivos y paquetes ya descargados. La caché local solo contiene Prisma 7.10.0, braces 3.0.3, deepmerge-ts 7.1.5 y mysql2 3.15.3 para esas rutas. No hay paquetes corregidos disponibles localmente. No se hicieron sustituciones manuales en `node_modules`, overrides incompatibles, `audit fix --force` ni instalaciones con `--legacy-peer-deps`.

**El ticket permanece pendiente de cierre.** Hace falta corregir o acordar explícitamente el tratamiento de los hallazgos residuales, verificar el build, publicar y revisar el PR y completar CI/entorno de pruebas. Este informe no registra aceptación de riesgo ni aprobación de Víctor.

## Identificación de la revisión

- Base local: `c2687171f6b4aa9b2377e78d550e36de73467d3b`, correspondiente a los ajustes de autenticación del PR #7.
- Rama de trabajo: `chore/PDGLD-71-dependencias`. La actualización de referencias remotas no fue autorizada; falta incorporar el `develop` remoto vigente antes de publicar.
- Entorno observado: Windows x64, Node.js `24.21.0`, npm `11.19.0`.
- SHA-256 del lockfile local antes de fijar rangos: `C8E5F8D2AC13E6996B50B5DB45F6F44DC0384C70F7E743254FD1B1CC208CAB6D`.
- SHA-256 de los bytes del lockfile local después de fijarlos: `DAE56A6A44FF7CE951BD28359744997BEA174802EAD9C103BCEB0CA440E32FB6`.
- Se comprobó por comparación estructural que todas las entradas de paquetes del lockfile son idénticas a las de la base; solo cambian los rangos del paquete raíz. El manifiesto y ese paquete raíz coinciden.

## Compatibilidad comprobada con los paquetes locales

| Componente | Versión | Contrato declarado / resultado |
| --- | --- | --- |
| Next.js | 16.4.0 | Node >=20.9; React/React DOM ^19 aceptados |
| React / React DOM | 19.3.0 | React DOM declara React ^19.3.0 |
| NextAuth | 4.24.15 | Admite Next ^16 y React/React DOM ^19; se conserva v4, sin migración a una beta v5 |
| Prisma CLI / Client / adapter-pg | 7.10.0 | CLI y Client admiten Node >=24 y TypeScript >=5.4; versiones alineadas |
| TypeScript | 5.9.3 | Compatible con los requisitos declarados; comprobación de tipos correcta |
| Zod | 4.6.5 | Se conserva la versión usada por la aplicación y sus pruebas anteriores |
| ESLint / eslint-config-next | 9.39.5 / 16.4.0 | Lint correcto; npm sigue mostrando la deprecación de ESLint 9.39.5 |
| Tailwind / loader Turbopack | 4.3.3 | Se conservan ambas versiones ya instaladas |

Fuentes reproducibles: `node_modules/<paquete>/package.json`, `package-lock.json` y `npm ls`. Una coincidencia de peerDependencies no sustituye la compilación ni las pruebas del recorrido integrado.

La deprecación de ESLint no demuestra por sí sola una vulnerabilidad. Evaluar su versión sucesora junto con `eslint-config-next` y plugins cuando se permita disponer de paquetes adicionales; no cambiar la versión principal sin comprobar compatibilidad.

## Auditoría disponible y exposición

El último `npm audit --json` consultado en esta conversación el 16/10/2026, **antes de la restricción de trabajo sin conexión**, informó 9 entradas altas y 0 críticas. Son paquetes afectados o que heredan avisos, no nueve vulnerabilidades independientes. No se afirma que se haya ejecutado un nuevo audit de red tras los cambios: se conservó exactamente el mismo árbol afectado.

| Ruta observada | Avisos del audit | Uso y evaluación local | Tratamiento pendiente |
| --- | --- | --- | --- |
| `eslint-config-next@16.4.0 → @next/eslint-plugin-next@16.4.0 → fast-glob@3.3.1 → micromatch@4.0.8 → braces@3.0.3` | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): agotamiento de pila con patrones profundamente anidados | Herramientas de lint. No se encontró entrada HTTP de la aplicación que invoque esta cadena; patrones/configuración de lint y código revisado en CI siguen siendo una superficie a evaluar. | Sergio: evaluar una cadena corregida compatible con Next 16. El downgrade a eslint-config-next 14.2.35 sugerido por npm no es una corrección compatible automática. |
| `prisma@7.10.0 → @prisma/config@7.10.0 → deepmerge-ts@7.1.5` | [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx): agotamiento de pila al combinar grafos recursivos | `prisma.config.ts` usa configuración controlada por el repositorio; no se encontró paso de objetos de una solicitud HTTP a esa configuración. | Sergio: comprobar una actualización de Prisma 7 que incorpore una dependencia corregida, alineando CLI/Client/adaptador. No forzar deepmerge-ts 8 sobre una API que espera 7 sin validación. |
| `prisma@7.10.0 → mysql2@3.15.3` | [GHSA-3f6p-5ww8-9rcr](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr): downgrade de autenticación; [GHSA-rgwj-5xj2-c3m3](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3): descompresión sin límite | El backend usa `PrismaPg` con PostgreSQL; no se encontró uso de MySQL en la aplicación. La presencia del paquete sigue siendo un hallazgo; no prueba que el backend sea explotable por estas rutas. | Sergio: evaluar la actualización compatible del paquete padre/dependencia transitiva y repetir generación, pruebas PostgreSQL y audit. |

**Matiz de empaquetado:** `npm ls --omit=dev mysql2 deepmerge-ts prisma --all` conserva esa cadena mediante el peer opcional `@prisma/client → prisma`. No basta con que `prisma` figure en `devDependencies` para asegurar que sus dependencias desaparecen de una instalación de producción. Evaluar también el artefacto real de despliegue cuando exista.

Víctor revisa las correcciones y cualquier decisión sobre riesgo residual conforme a la planificación del ticket. No se declara ninguno de estos riesgos aceptado. No se cambia el baseline ni se toca Supabase para esta revisión.

## Script de unrs-resolver

- Ruta: `eslint-config-next → eslint-import-resolver-typescript@3.10.1 → unrs-resolver@1.12.2`.
- Origen declarado: `https://github.com/unrs/unrs-resolver`; tarball fijado en el lockfile desde `https://registry.npmjs.org/unrs-resolver/-/unrs-resolver-1.12.2.tgz` con integridad SHA-512.
- Se leyeron `unrs-resolver/postinstall.js` y `napi-postinstall/lib/index.js` de la versión instalada, no solo su nombre.
- El postinstall llama a `checkAndPreparePackage(packageJson, true)`: verifica versión y busca el binding nativo de la plataforma. Si falta, puede instalarlo mediante npm o descargar el tarball del registro. Por ello `npm --offline` no debe interpretarse como bloqueo de red para cualquier script hijo.
- El binding `@unrs/resolver-binding-win32-x64-msvc@1.12.2` ya estaba descargado. La carga de `ResolverFactory` funciona sin ejecutar de nuevo ese postinstall.
- Decisión para esta revisión sin conexión: instalar desde caché con `--ignore-scripts` y verificar explícitamente los componentes necesarios. No se habilitaron scripts en bloque ni se cambió la configuración global de npm. Este procedimiento de validación no sustituye silenciosamente el `npm ci` normal del equipo.
- npm 11.19.0 local informa `ignore-scripts=false` y no tiene una lista `allow-scripts` configurada. No se encontró evidencia local de una cola de aprobación pendiente para ese paquete. El aviso histórico no acredita por sí mismo un bloqueo actual.

## Comprobaciones y límites

| Comprobación | Evidencia / estado |
| --- | --- |
| Manifiesto y lockfile | Rangos directos fijados a las versiones existentes; árbol, URLs e integridades sin cambios |
| Instalación limpia sin conexión | `npm ci --offline --ignore-scripts --no-audit --no-fund` desde la caché local en un directorio de validación separado: 525 paquetes instalados |
| Generación en la copia limpia | `npm run postinstall --offline`: Prisma Client 7.10 generado correctamente, usando `PRISMA_SCHEMA_ENGINE_BINARY` con el ejecutable local ya descargado; sin migraciones ni consultas a base de datos |
| Componentes nativos en la copia limpia | Carga de `unrs-resolver.ResolverFactory`, carga de `PrismaClient` y hash/verificación Argon2 con texto sintético: correctos |
| ESLint | `npm run lint`: correcto sobre la aplicación local |
| TypeScript | `npx --no-install tsc --noEmit --incremental false`: correcto sobre la aplicación local |
| Controles del pipeline | `npm run test:ci`: 12/12 correctos |
| Autenticación HTTP | En el trabajo anterior, la misma base y árbol de paquetes pasaron 20 pruebas. No se repitieron ni se presentan como una ejecución nueva de PDGLD-71 |
| Build | No validado en esta revisión sin conexión. La ejecución anterior con Node 24.21 encontró el fallo IPC del loader CSS. El layout también usa `next/font/google`, que puede requerir acceso externo durante un build limpio |
| Audit posterior | Pendiente de una consulta actualizada del registro; la fijación de rangos conserva los mismos paquetes afectados |
| CI remoto / PR / entorno de pruebas | Pendientes; no se publicaron cambios ni se modificó el estado de Jira |

La documentación instalada de Next 16.4 (`turbopackPluginRuntimeStrategy.md`) indica que Node >=24.13.1 provoca fallback de `workerThreads` a `childProcesses` por un problema de cierre de workers con módulos nativos. No se usó `forceWorkerThreads` ni se desactivaron validaciones para ocultarlo. El segundo runtime local observado, Node 24.19.0, también cae en ese rango; no se considera una solución comprobada.

## Pendientes concretos para revisión y cierre

1. Sergio: disponer de paquetes corregidos compatibles, aplicar el cambio mínimo y repetir instalación, generación, lint, tipos, build y pruebas afectadas. Si no hay una corrección aplicable, documentar una propuesta de tratamiento que Víctor pueda revisar, sin convertirla en aceptación implícita.
2. Sergio: resolver/verificar la compilación con el entorno acordado, conservando Next 16 y Tailwind 4; adjuntar evidencia del resultado.
3. Sergio: repetir audit con el lockfile final y registrar el commit, fecha, rutas, impacto y responsable de cualquier hallazgo residual.
4. Actualizar la rama respecto de `develop`, publicar un PR con prefijo `PDGLD-71`, obtener revisión de Víctor y comprobar `CI listo para integrar` y el entorno de pruebas. Vincular esos resultados al ticket antes de marcarlo Hecho.

El informe del 11/10 se conserva en [revision-entorno.md](revision-entorno.md) como antecedente. El trabajo de esta rama cubre reproducibilidad y evidencia local; no debe presentarse como eliminación de las nueve alertas.
