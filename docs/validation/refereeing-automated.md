# PDGLD-143 — pruebas y evidencia de arbitraje

Rama `feat/PDGLD-86-arbitros-designaciones`. Validación del 14 de noviembre de
2026 sobre el flujo revisado de PDGLD-141/142. Datos exclusivamente sintéticos;
las bases temporales y contenedores pertenecen a cada ejecución. No se modifica
la base Docker habitual ni un proyecto Supabase. No se ejecutan CURP/INE reales.

## Comandos reproducibles

Requisitos: Node 24, dependencias del lockfile, Docker y Chrome. En Windows el
harness descubre Chrome; configurar `CHROME_BIN` si no está instalado en una
ruta habitual. En GitHub se usa `/usr/bin/google-chrome`. Chrome ausente o un
fallo de preparación produce error; ninguna prueba crítica se omite.

```powershell
npm run test:referees:components
npm run test:referees:integration -- --postgres=15
npm run test:referees:integration -- --postgres=17
npm run test:referees:regression -- --postgres=15
npm run test:referees:regression -- --postgres=17
npm run test:season-identity-history
npm run test:match-eligibility-integration
npm run test:database-config
npm run test:management-navigation
npm run typecheck
npm run lint
npm run ci:guard-migrations
```

Las integraciones se ejecutan secuencialmente: usan Next temporal en 3193 y la
salida `.next-auth-tests`. No ejecutar simultáneamente otros runners Next que
usen esa misma salida. El servidor habitual de 3000 no se detiene. Los usuarios
Comisión, Programación, árbitro, lector SUPERADMIN y otra liga se crean y se
eliminan con el contenedor; sus credenciales no son cuentas del Docker habitual.
La [guía manual](refereeing-manual.md) conserva el recorrido humano.

`test:referees:regression` usa Linux y dependencias propias, copia sin `.env` y
montaje de origen de solo lectura. Comparte solamente la red del PostgreSQL
propio: 5432 permanece dentro de Docker, sin publicar 5432/5433. Así conserva
los validadores originales de destino, incluso en Windows con puertos reservados.
Necesita descargar las imágenes y ejecutar `npm ci`; no reutiliza binarios de
Windows en Linux. Comprueba las etiquetas de propiedad antes de limpiar.

## Cobertura y correspondencia

| Criterio | Evidencia ejecutable |
| --- | --- |
| PDGLD-86/141: cuota y contexto | `refereeing-acceptance.ts`: conteos SQL reales de 0/1/4/5/9 → 0/1/1/2/3; excluye equipos inactivos y retirados; otro club/temporada no se mezcla. Solo cuentan `season_teams` REGISTERED/ACTIVE, equipo y club ACTIVE, afiliación APPROVED. No calcula sanciones. |
| PDGLD-141: elegibilidad | Actividad, cobertura completa, indisponibilidad, horario ausente y traslape; grupo único con tercer equipo del club que no disputa el encuentro; revalidación tras cambiar actividad o incorporar un equipo después de proponer. |
| PDGLD-141/143: integridad | Dos claves para un partido y dos partidos traslapados con un árbitro: un ganador. Reenvío sin nuevo efecto, contenido diferente con misma clave, versión obsoleta, fallo inyectado al aprobar y rollback de propuesta/acuse. |
| PDGLD-141: flujo acordado | Programación propone sin publicar. Comisión asigna y aprueba atómicamente; UPDATE solo y SUPERADMIN sin APPROVE se deniegan. Revocar conserva el antecedente; la siguiente asignación es una fila nueva. |
| PDGLD-141: incorporación y acceso | `refereeing-additions.ts`: delegado presenta con acreditación; Comisión debe cotejar hash; misma Persona, club conservado, ninguna cuenta implícita. Alta de acceso separada: solo REFEREE, misma Persona, idempotencia y recuperación; delegado/Programación/roles adicionales rechazados. |
| PDGLD-141: disponibilidad propia | Permiso contextual y vinculación Persona/cuenta; intervalos ajenos y versión obsoleta rechazados. |
| PDGLD-143: sesión y seguridad | `refereeing-http.ts`: login NextAuth real, anónimo/otra liga/padrón contextual denegados; pendiente no abre partido; aprobado propio sí; UUID ajeno y revocado no; retirar APPROVE afecta la misma cookie. Desactivar con otra aprobación vigente se bloquea en SQL. |
| PDGLD-143: incertidumbre | Se destruye la conexión HTTP tras las cabeceras sin consumir el acuse de aprobación; GET recupera el resultado confirmado. Repetir la misma operación no añade historial. |
| PDGLD-117/141: identidad | `referee-history.ts`: trámite real de corrección y revisión por otro actor; resultado 2–1 existente y captura de partido cerrado permanecen iguales; referencia abierta deja de ser efectiva hasta revisión. Legado sin captura muestra UNAVAILABLE y conserva HISTORICAL_REFEREE_UNPROTECTED. |
| PDGLD-117/143: carreras | `test:season-identity-history`: cierre contra creación/corrección en ambos órdenes, rollback de cierre incompleto, captura inmutable y ausencia de backfill, en PG15/17. |
| PDGLD-142/143: interfaz | Tres suites de componentes con transporte sintético: disponibilidad, acreditación y padrón/designaciones. Chrome real adicional: claro/oscuro, 390/1440 px, sin desbordamiento horizontal, diálogo, Escape, retorno del foco y ausencia del partido revocado en Mis partidos. |
| PDGLD-143: regresión integrada | Catálogo RF22 exacto y extensiones explícitas, cuentas, motor de autorización, navegación, clubes, afiliaciones y elegibilidad PDGLD-16. Fixtures ahora usan propuestas/aprobaciones válidas, acreditación/club separado y revocación sin resucitar antecedentes. |

Las operaciones de servicio de arbitraje usan realmente `gestor_ligas_preview`,
con RLS habilitado en la base de prueba, incluyendo lecturas, escrituras y
bloqueos. El propietario se usa solamente para preparar fixtures, introducir
fallos controlados y verificar invariantes. No sustituye la conexión del backend.

Inventario de lecturas: padrón/designaciones/historial en
`features/referees/server/queries.ts`; identidad preservada y reevaluación en
`identity-history.ts`; acceso/Mis partidos en `features/matches/server/eligibility.ts`
y `server/auth/authorization-domain.ts`; dependencia transversal en
`features/players/server/identity-correction.ts`. El árbol actual no tiene
exportaciones arbitrales ni snapshot HTTP de PDGLD-18/19 que puedan darse por
probados. La ausencia de evidencia sigue bloqueando; el nombre actual nunca
se usa para reconstruir una identidad cerrada.

## Resultados y correcciones

- Matriz de arbitraje PG15/17: servicios, RLS Preview, HTTP y Chrome reales.
- Componentes: 3 pruebas; configuración/transacciones de base: 12;
  navegación/cierre de sesión: 3; elegibilidad por partido: 19.
- Controles generales del pipeline: 93 aprobados en Linux, cero omitidos.
  En Windows cinco casos antiguos fallan por symlinks sin privilegio y diferencias
  de señales; no se saltan ni se presentan como aprobados en Windows. La ejecución
  Linux del comando de regresión usa las mismas pruebas que GitHub.
- Migraciones completas: `migrate deploy`, comparación con Prisma sin diferencias,
  110 tablas y verificaciones existentes de unicidad/rollback; PG15/17.
- Tipado, lint, integridad de migraciones y sintaxis YAML del workflow.

Se corrigieron dos omisiones del plan SQL Preview: lectura únicamente de
`guardian_consents.registration_id/guardian_person_id` y EXECUTE de
`get_match_status_code(uuid)`, necesarios para el trámite histórico existente.
No se conceden escrituras de tutoría, acceso al ledger ni bypass de RLS.
Repetir manualmente la corrección de identidad de un árbitro con referencias
abiertas y cerradas después de reprovisionar el rol Preview con el plan revisado.
Las vistas aprobadas y las reglas de negocio no se reemplazan.

## CI y ensayo de migraciones Supabase

El workflow añade `Arbitraje real PostgreSQL 15/17`, obligatorio para
`CI listo para integrar`. Ejecuta componentes, sesión/HTTP/Chrome, matriz de base,
plan de producción y carreras históricas. Las regresiones originales de
autorización permanecen en el job de base; las de partidos en aplicación.

`refereeing-production-plan.mjs` reconstruye el SQL completo desde el baseline
en otra base propia con marcadores **sintéticos** auth/storage y roles API.
Verifica los mismos checksums/planes que usa el despliegue, RLS de todas las
tablas, denegación real con SET ROLE y detección de un GRANT accidental.
Comprueba además el reintento sin pendientes. Las pruebas originales cubren
marcadores parciales y defaults globales/heredados inseguros. No desactiva guardas
del CD para aprobar el ensayo.

La revisión pública encontró fallos en el paso «Verificar y aplicar las migraciones
de producción» de las ejecuciones [42759493546](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42759493546),
[40467049495](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/40467049495)
y [40456136245](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/40456136245).
La posterior [42765685046](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42765685046)
terminó correctamente. Las anotaciones solo indican exit 1 y la descarga de
logs devuelve 403 sin autenticación: no hay evidencia para atribuir esos fallos
a TLS, historial, privilegios u otra causa concreta.

Pendiente fuera del ensayo: ejecutar el workflow remoto una vez publicado,
diagnóstico de aquellos logs privados, conectividad/CA/secretos del environment
real y migración sobre el estado efectivo de Supabase. No se ejecuta deploy ni
se afirma que producción quedó validada. El CD sigue manual desde main,
con checks obligatorios, revisión de historial/RLS/ACL y exclusión mutua.

## Límites y decisiones externas

Storage de acreditaciones usa transporte explícitamente simulado en integración;
no acredita carga/vista previa contra Supabase real. CURP/INE auténticos siguen
reservados a humanos. El ensayo no reproduce infraestructura administrada,
datos productivos, PWA, snapshot futuro ni el PR pendiente de transiciones.

La restricción de club sigue aplicando al grupo único, sin excepción automática.
La cuota no introduce multas ni consecuencias deportivas. Aceptación del árbitro
y asignación automática al programar partidos quedan fuera del flujo acordado.
La revisión visual humana completa sigue siendo complementaria a Chrome; no se
certifica accesibilidad exhaustiva mediante pruebas de foco y dimensiones.
