# PDGLD-93 / PDGLD-106/107/108 — Matriz de aceptación del incremento

Alcance actualizado el 1 de noviembre de 2026 conforme al acuerdo de Víctor.
Base revisada: fb64b4f; PR #37, head publicado 973a805. Los cambios de esta
revisión son locales, sin staging, commit o push. Las ejecuciones SQL E7 y HTTP E8 fueron
autorizadas y aprobaron; esta actualización no repite servicios.

- Máximo un titular y un subdelegado vigentes por club, personas distintas.
- Ambos operan normalmente con las mismas capacidades CLUB_DELEGATE, sujetas a
  permisos vigentes, ámbito y vigencias. No hay modo sustitución ni espera por
  ausencia del titular. El cargo no concede permisos nuevos ni transfiere autoría.
- El cargo se muestra y se envía explícitamente. El formulario conserva selección
  inicial vacía: proponer Subdelegado para el segundo representante es una opción
  permitida por el acuerdo, no una selección automática obligatoria implementada.
- Reemplazos, cierres e historial administrativo completo quedan **fuera de este
  incremento** y requieren seguimiento separado. Datos, vigencias y auditoría
  existentes se conservan. El contrato anterior es solo una propuesta no validada.

## Último CI inspeccionado

[Run 41128794859](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/41128794859),
head 973a805: Aplicación falló en controles del pipeline (58/62 pruebas).
Cuatro fixtures puros intentaron crear /private/tmp en Ubuntu: EACCES mkdir
/private y ENOENT mkdtemp. CI listo para integrar falló por esa dependencia.
Migraciones PostgreSQL 15 y 17 aprobaron, incluidos autenticación/cuentas,
inscripciones/concurrencia, Preview/RLS/HTTP y seed. Producción fue omitida.
Lint/build y otros pasos posteriores de Aplicación no llegaron a ejecutarse.

Corrección local: temporales genéricos usan os.tmpdir; las rutas de ejecución
usan una raíz fija por plataforma (/private/tmp en macOS, /tmp en Linux), sin
aceptar raíces arbitrarias ni heredar TMPDIR para decisiones de propiedad.
Se conservan todas las aserciones y se añade rechazo de raíz ajena/anidada.
No se afirma que CI remoto esté corregido hasta otra ejecución publicada.

## Ejecuciones y procedencia

| Referencia | Ejecución conservada | Evidencia y alcance |
| --- | --- | --- |
| E1 | SQL `0829cdc5-5cb2-4df5-bbe3-c86c46af553c`, 28 de octubre | PostgreSQL 15/17 aprobados según run.json y [registro SQL](PDGLD-106-postgresql-aislado.md). Ejecutó verifyDelegatePositionMigration, SQL directo. No se repitió. |
| E2 | HTTP/SSR `c3d52110-9e44-4472-aebc-500a02f72a12`, 28 de octubre | PostgreSQL 15/17 aprobados; [registro HTTP](account-delegate-http-isolated.md). Webpack en esa ejecución histórica. No se repitió. |
| E3 | Probe `d47db239-b3fe-4e0a-a210-867dd42c604b` | npm ci independiente y Turbopack: HTTP 200 en /api/auth/csrf, sin módulos sin resolver, cleaned=true. No usa base ni Chrome. |
| E4 | Navegador `c2bf8520-6197-4fae-8a60-4b0e6d2b0729`, 30 de octubre | PG15 → limpieza → PG17 → limpieza. Next/Turbopack y Chrome reales, datos sintéticos, node_modules propio por copia. checks.json y capturas de escritorio/móvil en ambas versiones. |
| E5 | Preview/RLS `e8d3af10-f264-48b2-9fae-b90bb865630d`, 30 de octubre | Solo comenzó después de aprobar y verificar limpieza de E4. PG15 → limpieza → PG17 → limpieza. HTTP/SSR con Next/Turbopack y rol PostgreSQL limitado, sin Chrome. |
| E6 | SQL `8f6e123a-9241-4afc-a9ad-c8c91e3be7d2`, 30 de octubre | Suite SQL y tres regresiones nuevas aprobadas en PG15 → limpieza → PG17 → limpieza. Guards reales; reloj SQL controlado y cambio de representantes mediante fixture SQL. No acredita servicio de reemplazo. |
| E7 | SQL `43a36e41-31cf-4dae-b1c1-042464fc41f7`, 1 de noviembre | PG15 aprobó y quedó limpio antes de PG17; ambos aprobaron y quedaron limpios. Incluye equal-capabilities-scoped-authorship y las tres regresiones previas. Guards reales, ambas posiciones activas, CREATE/READ/UPDATE, club ajeno, revocación UPDATE y autoría. |

| E8 | HTTP `6bd8ef26-16ef-4ac1-aec3-cd7f6fc7f09d`, 1 de noviembre | PRIMARY y DEPUTY, cada uno con dos identidades y POST concurrentes: 201/409 DELEGATE_POSITION_OCCUPIED, un vínculo, sin residuos del perdedor. PG15 aprobado y limpio antes de PG17; ambos aprobados y limpios. Perfil HTTP existente, Webpack y dependencias enlazadas. |

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
| SQL E7 | 15 | Suite aprobada, sin instalación | cleaned=true, pending=false | Contenedor/red ausentes, puertos libres y sin procesos propios |
| SQL E7 | 17 | Suite aprobada, sin instalación | cleaned=true, pending=false | Contenedor/red ausentes, puertos libres y sin procesos propios |
| HTTP E8 | 15 | Suite y ambas carreras aprobadas | cleaned=true, pending=false | Contenedor/red/copias ausentes; cuatro puertos libres y sin procesos propios |
| HTTP E8 | 17 | Suite y ambas carreras aprobadas | cleaned=true, pending=false | Contenedor/red/copias ausentes; cuatro puertos libres y sin procesos propios |

Se verificaron libres 55415/55417/56515/56517 y ausencia de procesos con las rutas
propias. app-pgN, chrome-pgN y npm-work-pgN fueron eliminados; los contenedores
usaron tmpfs, sin volúmenes persistentes ni montajes del repositorio. Se conservan
registros/evidencias. Los hashes de manifiestos, compose.yml y archivos de control
de dependencias originales permanecieron iguales. No se cargó el .env habitual
ni se conectó a gestor_ligas_dev o Supabase real.

## Matriz criterio → implementación → prueba → resultado

Los resultados históricos corresponden a su código de ejecución. Una prueba
nueva pendiente no hereda la aprobación de una suite de nombre parecido.

| Criterio acordado | Implementación | Prueba concreta | Resultado / límite |
| --- | --- | --- | --- |
| Un titular y un subdelegado de personas distintas | delegate_position explícito, exclusión club/cargo/[inicio,fin), FK y personas únicas | E1 inserta PRIMARY/DEPUTY de cuentas distintas; E5 alta HTTP de ambos | Aprobado SQL y HTTP 15/17 |
| Dos titulares rechazados | user_roles_delegate_position_overlap | E1 23P01 y E5 409 DELEGATE_POSITION_OCCUPIED, rollback sin residuos | Aprobado 15/17 |
| Dos subdelegados distintos rechazados | Misma exclusión por cargo | E6 distinct-deputies-capacity: dos personas/cuentas; 23P01 exacto, sin asignación/auditoría residual | Aprobado SQL 15/17 |
| Misma persona/cuenta no ocupa ambos cargos | users.person_id UNIQUE y user_roles_delegate_account_overlap | E1 rechaza segunda cuenta de una persona y misma cuenta PRIMARY/DEPUTY | Aprobado SQL 15/17 |
| Altas concurrentes | Restricciones finales SQL y transacción/reautorización del alta | E1 dos PRIMARY compiten en READ COMMITTED, REPEATABLE READ y SERIALIZABLE; misma cuenta en ambos cargos tiene un único éxito | Aprobado SQL 15/17; no confundir con reemplazos concurrentes. La prueba HTTP existente de accounts.test.mjs repite la misma identidad y espera DUPLICATE_ACCOUNT: no acredita cupo. **E8 HTTP aprobado en 15/17**: dos identidades distintas disputan la misma plaza, por separado PRIMARY y DEPUTY; un 201 y un 409 DELEGATE_POSITION_OCCUPIED; un vínculo y ningún residuo del perdedor |
| Ambos cargos operan normalmente con las mismas capacidades | Autorización resuelve CLUB_DELEGATE, permisos y ámbito; no filtra por cargo ni presencia del titular | Nueva equal-capabilities-scoped-authorship: PRIMARY y DEPUTY activos en el mismo club; ambos CREATE/READ/UPDATE; revocar UPDATE deniega a ambos | **Aprobado E7 SQL 15/17**, con ambos cargos vigentes simultáneamente. E6 anterior no ejecutó este caso. Igualdad acordada, sin modo sustitución |
| Autoría de solicitudes y firmas | affiliation-service exige requested_by para corrección; signature-access también; signature binding mantiene uploader/actor; descarga usa READ autorizado | E6 conserva solicitud, archivo, storage_key, uploaded_by y directivos para ambos cargos tras fixture SQL; guards y vínculo; nueva prueba corrige firma propia y deniega la del otro representante activo | E6 aprobado acotado 15/17. **Prueba simultánea aprobada E7 SQL 15/17**: guard de carga permite corrección propia y rechaza ajena para ambos, requested_by conservado. No prueba almacenamiento ni servicio de reemplazo. Igualdad de permisos no transfiere propiedad |
| Aislamiento entre clubes y permisos vigentes | assertPermission deriva contexto de servidor, rol/capacidad y asignación | E5 opciones/alta ajenas 403, revocación efectiva con misma sesión. Nueva prueba ambos cargos CREATE/READ/UPDATE propio permitido, ajeno denegado y UPDATE revocado denegado | E5 aprobado para actor administrativo acotado; **E7 aprobado SQL 15/17 para ambos representantes**: CREATE/READ/UPDATE propio, rechazo ajeno y revocación UPDATE deniega a ambos |
| Vigencias | Inicio incluido, fin excluido; periodos abiertos/finitos, sin solapamientos | E1/E5 contigüidad y rechazo de intervalos inválidos; E6 assertPermission para ambos cargos antes/en inicio y antes/en fin | Aprobado SQL 15/17 con reloj SQL controlado; E5 alta HTTP de periodos. No acredita vencimiento por reloj de pared vía HTTP |
| Selección y conflicto en UI | SelectField compartido, selección vacía, cargo explícito, reinicio por contexto, contraseña limpiada ante envío | E4 Chrome vacío, teclado/foco, conflicto entre lectura/envío sin residuos, móvil, alta DEPUTY y presentación; pruebas puras verifican texto de mismas capacidades/sin sustitución/autoría | E4 aprobado 15/17 antes del nuevo texto. Nueva leyenda aprobada en render puro, sin nueva captura Chrome |
| Legados, datos y auditoría conservados | NULL sin backfill/promoción; guards de historial y audit baseline | E1 snapshots y restricciones; E4 legado NULL; E5 auditoría única, rollback y privilegios mínimos | Aprobado acotado 15/17. No equivale a consulta administrativa histórica |
| Runtime Preview limitado | INSERT cerrado; sin UPDATE general ni nuevas facultades | E5 RLS, ACL, actor/motivo obligatorios, ledger privado y role_permissions conservado | Aprobado local 15/17, no Supabase real |

Implementación: [migración](../../prisma/migrations/20261028010000_pdgld106_delegate_positions/migration.sql),
[servicio](../../src/features/accounts/server/service.ts),
[autorización](../../src/server/auth/authorization.ts),
[regresiones](../../tests/integration/representative-agreed-rules.mjs).

## Seguimiento separado, fuera del incremento

No implementados: reemplazo atómico autorizado, concurrencia de reemplazos,
cierre administrativo y consulta de historial completo. Requieren seguimiento,
definición de autoridad/contrato y pruebas propias. No se amplían aquí privilegios
Preview ni se implementa desactivación de cuenta PDGLD-117. Se conserva la
[propuesta de contrato](../architecture/representative-assignment-contract-draft.md)
como antecedente pendiente, sin convertirla en condición funcional de este alcance.
El cambio de representantes por SQL en E6 **solo prueba conservación de autoría y
referencias**, no un servicio autorizado. No se elimina su cobertura histórica.

## Verificación local y siguiente ejecución

test:ci 63/63, formulario 24/24, configuración de conexión 6/6, entradas de
afiliación 15/15 y revisión de afiliación 31/31: 139 pruebas puras aprobadas;
lint aprobado. Tipado directo encuentra caché
.next con rutas antiguas; typegen y tsc aprobaron en copia limpia sin .env,
eliminada al terminar, sin modificar archivos generados del equipo. No se declara aprobado build remoto.
E7 cierra la nueva comprobación SQL de capacidades/ámbito/autoría. No repetir las
suites SQL aprobadas. Los resultados E1–E8 conservan su procedencia. E8 cierra la carrera HTTP de alta
por plaza para ambos cargos. No quedan casos SQL/HTTP nuevos pendientes de
ejecución en esta matriz; CI remoto y revisiones se mantienen separados.

### Carrera HTTP por la misma plaza — aprobada E8

Se revisó accounts.test.mjs, caso «los duplicados y dos altas concurrentes se
resuelven sin residuos»: envía el mismo username/email y club nuevo dos veces,
espera DUPLICATE_ACCOUNT. El paso de cuentas de ambos jobs PostgreSQL del run
41128794859 aprobó esa suite, pero no prueba dos identidades por la misma plaza.
account-delegates-http.mjs no tenía una carrera de ese tipo en E2/E5; esa
cobertura corresponde ahora a E8, no a esas aprobaciones anteriores.

Ahora el perfil HTTP aislado activa concurrentPositions en
account-delegates-http.mjs; Preview y navegador conservan sus recorridos actuales.
Se prueban PRIMARY y DEPUTY por separado, dos sesiones autenticadas independientes
del actor autorizado y dos payloads con username, correo y persona distintos,
mismo club existente/cargo/intervalo. Promise.all lanza ambos POST antes de esperar:
se verificó un 201 y un 409 DELEGATE_POSITION_OCCUPIED, un único vínculo persistido,
periodo correcto, ausencia de cuenta/persona del perdedor, incrementos de una
persona/cuenta/asignación, exactamente dos auditorías del ganador y ningún club
nuevo. No fuerza simultaneidad de transacciones: el servicio conserva su
serialización normal de autoridad. No prueba reemplazos.

El worker HTTP conservó evidence-pg15/concurrent-http.json y
evidence-pg17/concurrent-http.json saneados: ambas posiciones aprobadas en cada
versión. cleanup-verified.json confirma limpieza de ambas versiones, contenedores,
redes y copias ausentes, puertos 55415/55417/56515/56517 libres, sin procesos propios
y hashes de compose.yml/manifiestos/dependencias originales conservados.

| Versión | Carrera | Estados HTTP | Persistencia ganadora | Auditoría | Perdedor |
| --- | --- | --- | --- | --- | --- |
| 15 | PRIMARY | 201 y 409 DELEGATE_POSITION_OCCUPIED | 1 persona, cuenta y vínculo | 2 eventos: users y user_roles | Sin persona/cuenta/auditoría residual |
| 15 | DEPUTY | 201 y 409 DELEGATE_POSITION_OCCUPIED | 1 persona, cuenta y vínculo | 2 eventos: users y user_roles | Sin persona/cuenta/auditoría residual |
| 17 | PRIMARY | 201 y 409 DELEGATE_POSITION_OCCUPIED | 1 persona, cuenta y vínculo | 2 eventos: users y user_roles | Sin persona/cuenta/auditoría residual |
| 17 | DEPUTY | 201 y 409 DELEGATE_POSITION_OCCUPIED | 1 persona, cuenta y vínculo | 2 eventos: users y user_roles | Sin persona/cuenta/auditoría residual |

Comando histórico autorizado y ejecutado; run-id consumido, no reutilizar:

```sh
npm run test:account-isolated -- --execute --run-id 6bd8ef26-16ef-4ac1-aec3-cd7f6fc7f09d
```

PG15 aprobó y quedó limpio antes de iniciar PG17. Se usaron exclusivamente las
bases pdgld48_test_6bd8ef2616ef4a15/17 y pdgld106_model_6bd8ef2616ef4a15/17,
contenedores/redes propios, tmpfs y loopback. El perfil HTTP existente conservó
Webpack y enlace a dependencias instaladas, sin npm ci. No se ejecutó navegador,
Preview/RLS ni el worker de la suite SQL independiente. No hubo seeds, .env,
gestor_ligas_dev ni Supabase. Los datos de las pruebas se eliminaron con las bases
exclusivas; la evidencia conserva los resultados, no PII ni payloads originales.

## Evidencia privada

37 archivos E1–E6 conservados en Documents/PDGLD-106-107-108-evidencias-20261030,
fuera del repositorio; manifest-v2.json con hashes verificados, original conservado.
Solo resultados saneados se proponen para Git. Sin logs, cookies, tokens,
credenciales, capturas originales, compose.yml o documentos internos del PR.

E7: copia privada adicional en Documents/PDGLD-93-evidencia-43a36e41-20261101:
run.json, cleanup-verified.json y agreed-rules.json de PG15/17; cuatro archivos
más manifest.json con SHA-256 verificados contra /private/tmp. Directorios 0700,
archivos 0600; originales conservados. run.json y el manifiesto privado no se
incorporan a Git. El JSON saneado incluye E7 y E8 como aprobados, sin nuevas pruebas pendientes.

E8: copia privada duradera dentro de esa misma carpeta, subdirectorio
http-6bd8ef26-16ef-4ac1-aec3-cd7f6fc7f09d: run.json, cleanup-verified.json y
concurrent-http.json de PG15/17, más manifest.json. Cuatro archivos y hashes
verificados contra los originales; 0700/0600. Copias previas y originales intactos.
Los resultados saneados no incorporan run.json ni el manifiesto privado.
