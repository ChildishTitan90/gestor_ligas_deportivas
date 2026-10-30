# PDGLD-106/107/108 — Matriz de implementación y evidencia

Actualización: 30 de octubre de 2026, America/Mexico_City. Base local
`fb64b4f068b6121063475333320524725436e0c0`, con cambios aún sin commit.
Se revisaron los registros conservados y las aserciones del código; no se
iniciaron servicios ni se repitieron pruebas para elaborar este documento.

Navegador y Preview/RLS aprobaron en PostgreSQL 15 y 17 y su limpieza fue
verificada. Esto completa esas verificaciones de PDGLD-107; **no completa
PDGLD-108 ni acredita por sí solo el cierre de PDGLD-93**. La matriz evalúa los
criterios pedidos en esta revisión; no sustituye decisiones de producto,
revisión independiente o CI remoto.

Se conservaron las decisiones propuestas en el
[contrato pendiente de validación](../architecture/representative-assignment-contract-draft.md).
Se añadieron [tres regresiones de reglas acordadas](representative-agreed-rule-tests.md),
**aprobadas en E6 con PostgreSQL 15 y 17 y limpieza verificada**. Las
aprobaciones anteriores E1–E5 no cubren esos casos nuevos. Las rutas, versión y función SQL privilegiada siguen sin implementarse.

## Ejecuciones y procedencia

| Referencia | Ejecución conservada | Evidencia y alcance |
| --- | --- | --- |
| E1 | SQL `0829cdc5-5cb2-4df5-bbe3-c86c46af553c`, 28 de octubre | PostgreSQL 15/17 aprobados según run.json y [registro SQL](PDGLD-106-postgresql-aislado.md). Ejecutó verifyDelegatePositionMigration, SQL directo. No se repitió. |
| E2 | HTTP/SSR `c3d52110-9e44-4472-aebc-500a02f72a12`, 28 de octubre | PostgreSQL 15/17 aprobados; [registro HTTP](account-delegate-http-isolated.md). Webpack en esa ejecución histórica. No se repitió. |
| E3 | Probe `d47db239-b3fe-4e0a-a210-867dd42c604b` | npm ci independiente y Turbopack: HTTP 200 en /api/auth/csrf, sin módulos sin resolver, cleaned=true. No usa base ni Chrome. |
| E4 | Navegador `c2bf8520-6197-4fae-8a60-4b0e6d2b0729`, 30 de octubre | PG15 → limpieza → PG17 → limpieza. Next/Turbopack y Chrome reales, datos sintéticos, node_modules propio por copia. checks.json y capturas de escritorio/móvil en ambas versiones. |
| E5 | Preview/RLS `e8d3af10-f264-48b2-9fae-b90bb865630d`, 30 de octubre | Solo comenzó después de aprobar y verificar limpieza de E4. PG15 → limpieza → PG17 → limpieza. HTTP/SSR con Next/Turbopack y rol PostgreSQL limitado, sin Chrome. |

| E6 | SQL `8f6e123a-9241-4afc-a9ad-c8c91e3be7d2`, 30 de octubre | Suite SQL y tres regresiones nuevas aprobadas en PG15 → limpieza → PG17 → limpieza. Guards reales; reloj SQL controlado y cambio de representantes mediante fixture SQL. No acredita servicio de reemplazo. |

[Resultados estructurados saneados](account-delegate-approved-results.json).
No se copian a Git run.json originales, logs, capturas, conexiones ni credenciales.
Los hashes incluidos identifican package.json y el lockfile; no son hashes de
contraseñas ni tokens. Las versiones clave verificadas en las cuatro copias:
Next 16.4.3, pg 8.23.1, Prisma/cliente/adaptador 7.10.1 y React/React DOM 19.3.0.

| Perfil | PostgreSQL | Instalación y suite | Limpieza registrada | Verificación independiente |
| --- | --- | --- | --- | --- |
| Navegador E4 | 15 | Aprobadas | cleaned=true, pending=false | Contenedor/red y rutas propios ausentes |
| Navegador E4 | 17 | Aprobadas | cleaned=true, pending=false | Contenedor/red y rutas propios ausentes |
| Preview E5 | 15 | Aprobadas | cleaned=true, pending=false | Contenedor/red y rutas propios ausentes |
| Preview E5 | 17 | Aprobadas | cleaned=true, pending=false | Contenedor/red y rutas propios ausentes |

Se verificaron libres 55415/55417/56515/56517 y ausencia de procesos con las rutas
propias. app-pgN, chrome-pgN y npm-work-pgN fueron eliminados; los contenedores
usaron tmpfs, sin volúmenes persistentes ni montajes del repositorio. Se conservan
registros/evidencias. Los hashes de manifiestos, compose.yml y archivos de control
de dependencias originales permanecieron iguales. No se cargó el .env habitual
ni se conectó a gestor_ligas_dev o Supabase real.

## Matriz criterio → implementación → prueba → resultado

**Aprobado acotado** significa que las aserciones descritas pasaron; no atribuye
cobertura a operaciones que la suite no llama. **Parcial** separa la protección
existente de una entrada de aplicación o recorrido todavía ausente.

| Criterio | Implementación comprobada en lectura | Prueba/aserción concreta y ejecución | Resultado y brecha |
| --- | --- | --- | --- |
| Titular y subdelegado explícitos, máximo uno por cargo/club/intervalo | [Migración PDGLD-106](../../prisma/migrations/20261028010000_pdgld106_delegate_positions/migration.sql): exclusión GiST cargo/club/[inicio,fin), CHECK PRIMARY/DEPUTY y legado sin default. [Servicio](../../src/features/accounts/server/service.ts) guarda el cargo validado. | E1: inserta PRIMARY y DEPUTY; rechaza un tercero PRIMARY por user_roles_delegate_position_overlap (SQLSTATE 23P01). E5 ejecuta [HTTP](../../tests/integration/account-delegates-http.mjs), líneas 80 y 98: crea ambos y rechaza otro PRIMARY con 409 DELEGATE_POSITION_OCCUPIED, sin residuos. | **Aprobado acotado:** esos casos concretos. El segundo DEPUTY distinto se prueba explícitamente en E6 (fila siguiente). |
| Dos subdelegados distintos rechazados por cupo | La misma exclusión SQL protege DEPUTY. | [SQL](../../tests/integration/delegate-positions-migration.mjs), línea 115, crea un DEPUTY, pero el siguiente rechazo por cupo es PRIMARY. HTTP rechaza PRIMARY tras llenar ambos cargos; E4 ocupa PRIMARY con un competidor y después crea un único DEPUTY. No aparece una segunda cuenta/persona DEPUTY rechazada por cupo. | **Aprobado E6, SQL 15/17:** distinct-deputies-capacity usa dos personas/cuentas; exige 23P01/user_roles_delegate_position_overlap, sin segunda asignación ni auditoría residual. E1/E4/E5 no ejecutaron este caso. |
| Una persona/cuenta no ocupa los dos cargos simultáneamente | users.person_id UNIQUE y exclusión user_roles_delegate_account_overlap. | E1 [SQL](../../tests/integration/delegate-positions-migration.mjs), líneas 52, 114 y 188: segunda cuenta para la misma persona rechazada; misma cuenta PRIMARY/DEPUTY rechazada; altas concurrentes de ambos cargos para la misma cuenta dejan un único éxito. | **Aprobado en SQL 15/17**. No equivale a concurrencia de reemplazos. |
| Reemplazo exitoso y atómico mediante servicio autorizado | createAccount crea una cuenta y asignaciones nuevas. No se encontró contrato/servicio de reemplazo. Preview permite INSERT de campos cerrados; no autoriza UPDATE de ends_at/cargo. | E1 líneas 209–215: BEGIN, cierre, INSERT solapado que falla y ROLLBACK; se conserva fin abierto y cuenta de auditoría. Los cierres/altas contiguos exitosos de líneas 118–120 y 139–140 son SQL directo, no un reemplazo exitoso por servicio en una única transacción. E4/E5 no llaman reemplazos. | **Pendiente de implementación y prueba.** Definir entrada, permisos/ámbito, identidad existente, cierre/alta en una transacción, instante de corte y auditoría correlacionada. Revisar privilegios necesarios sin conceder UPDATE general para hacer pasar pruebas. |
| Reemplazos concurrentes sobre la misma asignación | No existe contrato de reemplazo con versión esperada, idempotencia o política de reintento. Las exclusiones protegen solapamientos de filas. | E1 líneas 154–194: cierre de legado no confirmado bloquea un alta; commit/rollback e inserciones PRIMARY concurrentes bajo tres aislamientos. No hay dos servicios intentando reemplazar la misma fila. | **Pendiente de implementación y prueba.** Verificar ganador/conflicto, versión/reintento, rollback integral de cierre + alta + auditoría y conservación de ambas identidades. |
| Historial conservado y consultable con autorización | Trigger protege identidad/periodos efectivos y reutiliza auditoría. [Presentación de cuenta](../../src/features/auth/server/account-presentation.ts) consulta asignaciones vigentes; [queries de cuentas](../../src/features/accounts/server/queries.ts) prepara el formulario. No se encontró lectura histórica autorizada de representantes. | E1 snapshot antes/después de migrar conserva filas/auditoría; rechaza DELETE/cambio de cargo efectivo y conserva legado. E5 líneas 62–74 de [runtime](../../tests/integration/account-preview-runtime.mjs) verifica auditoría única de inserciones, no una consulta histórica por usuario autorizado. | **Parcial: conservación SQL aprobada; consulta de historial pendiente.** Faltan contrato/DTO, alcance y recorrido con persona anterior/nueva, corte exacto, actor/motivo/correlación y conservación de cuenta, solicitudes y firmas después de reemplazar. |
| Baja del titular sin promoción automática | No se añade promoción automática. No se encontró servicio de baja/cierre de representante. | E1 SQL líneas 118–120 inserta otro PRIMARY contiguo al fin previsto y lee que el DEPUTY conserva su cargo. No ejecuta una baja/desactivación del titular mediante servicio ni observa el momento de su vencimiento. E4/E5 son altas. | **Parcial.** La aserción SQL conserva DEPUTY; faltan baja real autorizada, vacante posterior, continuidad/revocación de permisos según vigencia y comprobación de que no se crea ni promueve otro titular. |
| Vigencia abierta/finita, contigüidad, solapamientos y periodo inválido | Exclusions sobre tstzrange '[)'; contrato Zod valida fin posterior; servicio persiste fechas. [Autorización](../../src/server/auth/authorization.ts), línea 114, filtra starts_at <= ahora y ends_at > ahora. | E1 SQL inserta periodos contiguos y rechaza solapamientos. E5 HTTP líneas 108–113 crea dos PRIMARY contiguos, consulta disponibilidad posterior y rechaza solapamiento e intervalo invertido. E4 cambia club/modo/fin y comprueba que se borra la selección anterior. | **Aprobado acotado** para integridad/alta/formulario. **Aprobado E6, SQL 15/17:** autorización de ambos cargos antes/en inicio y antes/en fin, con reloj SQL controlado; no acredita HTTP, baja ni vencimiento de reloj real. No se confunden fechas futuras insertadas con un reloj que ya atravesó el límite. |
| Legados ambiguos, sin clasificación ni promoción implícita | NULL se conserva para delegados anteriores; exclusión legado/conocido bloquea nuevas asignaciones solapadas. | E1 preserva duplicados/NULL, permite clasificación explícita compatible y prueba esperas ante cierre de legado. E4 bloquea opciones, muestra Cargo no identificado y comprueba NULL persistente; E5 HTTP rechaza DELEGATE_LEGACY_OVERLAP. | **Aprobado acotado** en SQL, UI y HTTP/runtime. No se implementó un proceso administrativo completo de regularización. |
| Propiedad de solicitudes y facultades de ambos cargos | Los permisos continúan por CLUB_DELEGATE/ámbito, sin una matriz nueva por cargo. [Corrección de afiliación](../../src/features/clubs/server/affiliation-service.ts), línea 62, exige requested_by=actor. No transfiere la autoría al otro representante. | E4/E5 verifican alta y presentación de DEPUTY; no crean/corrigen solicitudes con dos representantes operativos del mismo club. [affiliations.test.mjs](../../tests/integration/affiliations.test.mjs), líneas 51–54, tiene PRIMARY operativo y DEPUTY restringido por cambio obligatorio, no la matriz de dos actores operativos; esa suite no se ejecutó en E4/E5. | **Aprobado acotado E6, SQL 15/17:** conserva requested_by y registros de solicitud tras cambio SQL para ambos cargos; guards rechazan corrección ajena. La matriz completa de operaciones sigue **pendiente de decisión y prueba específica**. Mantener propiedad actual. Acordar actuaciones propias/ajenas, correcciones y continuidad tras baja/reemplazo; después probar ambos cargos con permisos reales, sin ampliar facultades por inferencia. |
| Firmas para ambos cargos y conservación después de reemplazo | [Carga](../../src/features/clubs/server/signature-access.ts), línea 53, exige autor de la solicitud cuando es corrección, además de permiso/ámbito. [Descarga](../../src/features/clubs/server/signature-download-service.ts), línea 95, usa READ del club y contexto derivado del archivo; no exige ser su uploader. No se generaliza una regla de autoría idéntica a carga y descarga. | [authorization-signature-access.test.ts](../../tests/integration/authorization-signature-access.test.ts), línea 133, usa PRIMARY. No fue ejecutada por E4/E5. Los perfiles aprobados no suben/descargan firmas ni reemplazan al representante de una solicitud. | **Aprobado acotado E6, SQL 15/17:** conservación de autoría, uploaded_by/storage_key y referencias; guards de carga/descarga y vínculo de firma, con cambio SQL de fixture para ambos cargos. No ejecuta almacenamiento ni servicio de reemplazo. Sigue pendiente la matriz completa y decisiones cuando correspondan: operación HTTP de solicitud propia/ajena, club ajeno y vigencias. Comprobar persistencia de referencias tras reemplazo sin transferir ni eliminar firmas/solicitudes automáticamente. |
| Ámbito, permiso revocado y opciones privadas | Servicio reautoriza CREATE y club/liga en servidor; disponibilidad no reserva el cargo. | E5 HTTP líneas 52–61: anónimo 401, sin permiso/ámbito ajeno 403, private/no-store. Líneas 119–124 revocan/restauran permiso del fixture y comprueban denegación con la misma sesión. E5 runtime líneas 84–94 usa SUPERADMIN con alcance de club: propio 200, ajeno/alta ajena 403. | **Aprobado acotado 15/17** para cuentas. Ese actor acotado no es DEPUTY y no demuestra sus facultades sobre solicitudes/firmas. |
| Runtime limitado, RLS, ACL y auditoría obligatoria | Provisionador Preview restringe permisos/columnas, con RLS solo en la base temporal; no modifica facultades por cargo. | E5 runtime líneas 20–40: RLS efectivo, sin SUPERUSER/BYPASSRLS/membresías y lista exacta de INSERT. Líneas 42–67: UPDATE/DELETE/ledger denegados, falta de actor/motivo falla, inserción auditada única y rollback restaura conteos. Líneas 69–74: cuatro asignaciones HTTP con cuatro eventos y cargo explícito. Worker compara role_permissions antes/después del aprovisionamiento. | **Aprobado local 15/17.** La revocación de permiso del fixture HTTP se restaura dentro de la base temporal. No acredita Supabase real ni habilita privilegios de reemplazo. |
| Interacción de formulario, conflicto y presentación | SelectField compartido, selección vacía, disponibilidad por contexto, códigos de conflicto y datos mínimos de presentación. | E4 [recorrido real](../../tests/e2e/account-delegates-browser.mjs): vacío, tabulación/foco/ARIA, PRIMARY ocupado entre consulta y envío; conserva captura, borra contraseña y comprueba ausencia de cuenta residual; cambia club/vigencia; viewport 390×844 sin overflow; crea DEPUTY y muestra cargo; legado sigue NULL. | **Aprobado en Chrome 15/17.** Capturas sintéticas y aserciones no sustituyen revisión humana, lector de pantalla o dispositivo físico. |

## Trabajo que queda

1. Conservar las tres regresiones E6 aprobadas sin atribuirles cobertura de un
   servicio de reemplazo o recorrido HTTP de solicitudes/firmas.
2. Acordar el contrato de baja/reemplazo y las facultades pendientes, conservando
   la propiedad actual de solicitudes y firmas hasta una decisión explícita.
3. Implementar reemplazo atómico autorizado, control de concurrencia y la lectura
   de historial. Evaluar privilegios mínimos del runtime para ese contrato.
4. Probar dos reemplazos concurrentes, baja sin promoción, límites operativos de
   vigencia y conservación de solicitudes/firmas/cuentas y auditoría del historial.
5. Completar la matriz PRIMARY/DEPUTY por operación, propiedad y ámbito sin usar
   una prueba de alta como evidencia de permiso sobre solicitudes o firmas.
6. Revisión independiente, CI remoto y revisión visual/accesible acordada con el
   equipo. develop/PDGLD-110 están integrados localmente; eso no acredita por sí
   solo aprobación de la integración final.

## Archivo privado y publicación

Copia privada duradera: `Documents/PDGLD-106-107-108-evidencias-20261030`, fuera del
repositorio, 37 archivos de E1–E6, con manifest-v2.json y SHA-256 verificados;
se conserva también manifest.json original, permisos
0700 en directorios y 0600 en archivos. Los originales permanecen en /private/tmp.
El diagnóstico original de Turbopack anterior conserva además su archivo privado
separado en Documents. Ningún original se incorpora al árbol de Git.

Los resultados versionables son esta matriz, el JSON con campos permitidos y
las actualizaciones documentales. run.json privado contiene metadatos internos
que no deben copiarse directamente. No se incluyen logs, cuerpos HTTP, imágenes,
credenciales, cookies o tokens en los nuevos resultados saneados.

Los originales privados, compose.yml, los inventarios locales y los planes de
preparación del PR quedan fuera de la evidencia versionable del proyecto.

## Preparación nueva: reglas acordadas, no contrato nuevo

Se prepararon distinct-deputies-capacity,
authorization-inclusive-start-exclusive-end y
representation-change-preserves-authorship. El detalle de sus oráculos, límites,
comando y recursos está en [pruebas nuevas](representative-agreed-rule-tests.md).
E6 ejecutó las tres regresiones y la suite SQL en PostgreSQL 15 y 17, con
limpieza verificada entre versiones y al terminar. E1–E5 permanecen históricas.
Esta actualización documental no ejecutó servicios.
Ninguno de los nuevos casos acredita reemplazo autorizado, revisión concurrente,
consulta de historial o recuperación idempotente, que siguen pendientes.
