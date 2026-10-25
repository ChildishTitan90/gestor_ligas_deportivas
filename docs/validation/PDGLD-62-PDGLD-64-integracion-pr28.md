# PDGLD-62/64 — Integración del PR #28 en el PR #27

Fecha: 25/10/2026, America/Mexico_City. Carpeta de trabajo:
`C:/Users/victo/gestor_ligas_deportivas`.
Rama: `feat/PDGLD-62-PDGLD-64-inscripcion-equipos`.

## Referencias y conservación de cambios

El árbol y el índice estaban limpios al iniciar, con HEAD en `be121de`.
Tras `git fetch origin develop`, la referencia remota avanzó de `1d732d6` a
`a9c681009198c5133de6f1a1064cb7e9a8e4b36a`. Ese commit registra el merge del
PR #28 `feat/PDGLD-60-aprobacion-afiliacion`, con padres `1d732d6` y `5bb973d`.
Se recibió exclusivamente por origin/develop; no se fusionó un PR ni se hizo cherry-pick.

Se ejecutó `git merge --no-commit --no-ff origin/develop`. La integración local
permanece abierta para revisión, con conflictos resueltos y sin crear el commit.
HEAD no incorpora todavía el merge como commit; MERGE_HEAD identifica develop.
No se hizo reset, rebase, descarte global de ours/theirs, push o cambio en Jira.

## Conflictos resueltos y archivos combinados

- `package.json`: unión de comandos de ambas ramas. Se conserva
  `test:team-enrollments`, revisión/reenvío, las pruebas del comprobador de firmas
  y `verify:signature-download`. Next y eslint-config-next permanecen en 16.4.3;
  se comprobó la coherencia de dependencias directas con el lockfile.
- `scripts/test-auth.mjs`: conserva `--team-enrollments`, `--affiliation-demo`,
  los demás modos y la limpieza de ambas demostraciones. Las suites automatizadas
  conservan el origen Storage sintético y la clave de pruebas; no usan Storage real.
  Se mantiene el reintento acotado del aviso de seguridad de Next.
- `affiliation-form.tsx`: conserva correcciones, datos/firmas precargados,
  submissionKey, expectedVersion, respuestas inciertas y recarga explícita. La
  identidad incluye actor, club, temporada, Storage, correction.id y expectedVersion.
- Prisma conserva review_version y los campos de autorización/inscripción, junto
  con ambas migraciones. No se editaron migraciones compartidas.
- README conserva ambos flujos y actualiza el resultado del build. El workflow
  mantiene revisión de afiliaciones, firmas e inscripción en la matriz 15/17.

## Ajuste acotado de estilos

Se corrigió `wrap-break-words` a `wrap-break-word` en Temporada. La prueba real
detectó que una palabra sin espacios aún ampliaba la columna implícita de CSS Grid;
se añadió `min-w-0` únicamente a su contenedor, sin rediseñar la bandeja.

Se renderizó el componente real con el CSS del build en Chrome headless aislado
y sin red. Nombres extensos con y sin espacios pasaron en 320, 375, 768 y 1280 px:
ocho casos, overflow-wrap calculado break-word, ancho de página igual al viewport
y ancho desplazable del texto igual al contenedor, sin desbordamiento horizontal.
Es una comprobación de layout del componente, no un recorrido completo por la UI.

## Contrato real de categorías y pruebas PDGLD-64

El servicio recibido expone GET `/api/affiliations/{id}` y PATCH
`/api/affiliations/{id}/review` con decision y expectedVersion. Valida Secretaría,
permiso, ámbito, separación de funciones, versión y concurrencia; aprueba y audita
la afiliación. No recibe categorías autorizadas ni escribe sus dos marcas.

La prueba ejecuta el POST real del delegado, comprueba rechazo de inscripción por
afiliación PENDING, consulta el detalle como secretario y obtiene expectedVersion
de esa respuesta. Aprueba mediante el PATCH real, verifica responsable, versión
e historial y confirma que ambas marcas de todas las categorías siguen nulas.
La inscripción devuelve CATEGORY_NOT_AUTHORIZED y las opciones siguen vacías.
Un equipo legado sintético previamente REGISTERED conserva su estado tras aprobar.

No hay UPDATE SQL que simule aprobación/autorización dentro de ese recorrido.
Para las pruebas aisladas de inscripción se prepara otra temporada mediante un
fixture aprobado y autorizado explícito. Así se siguen verificando REGISTERED,
duplicados, distintos grupos/categorías, concurrencia, reintentos, rollback,
auditoría, alcance e historial, sin presentar el fixture como autorización real.

**Dependencia exacta:** Checo coordina la operación real que registrará
authorized_by/authorized_at por categoría y su auditoría. Si necesita selección
visual, debe acordarla con Nick. No se inventó selección o aprobación alternativa,
no se retiró CATEGORY_NOT_AUTHORIZED ni se autorizaron filas por migración.
El recorrido completo solicitud → aprobación/autorización → inscripción positiva
permanece pendiente de esa operación. ACTIVE sigue pendiente de definición de negocio.

## Migraciones locales

Se verificó previamente DIRECT_URL sin imprimir credenciales: localhost:5433,
gestor_ligas_dev, PostgreSQL 15.19. Tenía baseline y solicitud de afiliación.
Se aplicaron con migrate deploy las migraciones pendientes de seguridad PDGLD-57,
review PDGLD-60 e inscripción PDGLD-62, y después generate. Historial: cinco
migraciones completadas. No se modificó Supabase ni se usó reset/db push.

Conteos antes/después: clubes 3, equipos 0, inscripciones 0, afiliaciones 2 y
auditoría 146, iguales. Esa comprobación verifica conteos; no pretende comparar
todo el contenido de cada fila. Las pruebas de comportamiento usan bases desechables.

## Resultados locales

| Comprobación | Resultado |
| --- | --- |
| Prisma validate/generate y lockfile | Correctos |
| Reconstrucción temporal y migrate diff | Sin diferencias |
| typecheck / lint / build | Correctos; revisión y build repetidos tras el ajuste final de layout |
| test:ci | 18 aprobadas |
| test:database-config | 6 aprobadas |
| test:account-form | 12 aprobadas |
| test:affiliation-input | 15 aprobadas |
| test:affiliation-review | 27 aprobadas |
| test:signatures | 42 aprobadas, sin comprobación manual contra Storage real |
| test:team-enrollments | 17 aprobadas (16 escenarios y agrupadora) |
| test:auth | Políticas 6 + 3, autorización TypeScript 39, HTTP 92 aprobadas |
| test:seed | 19 + 7 aprobadas; contenedor temporal detenido |
| guard de migraciones | Correcto; migraciones compartidas conservadas |
| Layout en navegador aislado | 8 casos aprobados |

Solo se atribuyen resultados locales PostgreSQL 15. La matriz 15/17 se conserva
en el workflow, pero **no se ejecutó ni publicó CI remoto de estos cambios**.
La revisión independiente, autorización individual de categorías y recorrido
visual completo de PDGLD-63 siguen pendientes. No se declaran cerradas las subtareas.
