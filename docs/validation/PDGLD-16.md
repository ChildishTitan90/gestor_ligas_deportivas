# PDGLD-16 · Evidencia y aceptación pendiente

Primera prioridad Sprint 3. Rama `feat/PDGLD-16-elegibilidad-partido`, worktree
`/private/tmp/pdgld16-20261110`, basado en develop 0a2fc44. Árbol original,
stashes y compose conservados. El fetch inicial actualizó develop a 0a2fc44;
dos reintentos finales fallaron por conexión HTTPS. El endpoint GitHub
`branches/develop` confirmó el mismo SHA completo y un último fetch exitoso
volvió a comprobarlo antes de abrir el PR, el 10/11/2026. No se inició PDGLD-32 ni PDGLD-29.

## Reproducir

1. `npm ci` y `npx next typegen`.
2. `npm run typecheck`, `npm run lint`, `npm run test:ci`.
3. `npm run test:match-eligibility-integration`: Docker local, contenedor PostgreSQL
   15 propio sin volumen, puerto dinámico y base `pdgld48_test_<nonce>`. No hereda
   conexiones/credenciales del entorno ni llama CURP/INE/Storage. Limpia su propio
   contenedor al terminar. Reutiliza fixtures y pruebas de PDGLD-13/14.
4. `npm run test:match-eligibility-browser`: Chrome headless local, DTOs sintéticos.
   Configurar `CHROME_BIN` si Chrome no está en la ruta habitual. Opcionalmente
   `MATCH_ELIGIBILITY_SCREENSHOTS=/private/tmp/pdgld16-screenshots` genera capturas.
5. `npm run build`, con NEXTAUTH_URL local y NEXTAUTH_SECRET efímero de al menos
   32 caracteres; no usar secretos del árbol original para esta compilación.

CI ejecuta las dos suites nuevas en el job Aplicación, sin desactivar controles.

Resultados locales del 10/11/2026: tipado y lint aprobados; controles del pipeline
93/93; integración PostgreSQL 17/17 (incluye ocho casos específicos de PDGLD-16 y
regresiones reutilizadas); Chrome 1/1 con sus cuatro combinaciones tema/tamaño;
compilación de producción aprobada con secreto efímero sintético. La primera
compilación sin ese secreto se detuvo por configuración; no se cambió el control.

## Evidencia por criterio

| Criterio | Evidencia automatizada / límite |
| --- | --- |
| Ascenso consecutivo autorizado y mismo club | Fixture real con origen habilitado y destino AUTHORIZED; evalúa elegible por partido sin cambiar origen |
| Descenso, salto, familia incompatible | Regresiones existentes reutilizadas de `player-category-participations.ts`; el evaluador común vuelve a exigir familia y nivel |
| Equipo no inscrito / destino no autorizado | FK/contexto de season_team existentes; prueba rival inscrito sin autorización queda fuera de la respuesta. No se crea un partido con FK inválida |
| Equipo tras inicio | Prueba PDGLD-16 de pertenencia inmutable y nuevo registro en otro equipo tras competencia iniciada |
| Sanción aplicable / no aplicable | Fecha futura no bloquea partido anterior; inicio bloquea; fin exclusivo permite; otro jugador sancionado no bloquea al evaluado |
| Árbitro ajeno o revocado | Deniega incluso administrador sin designación; revocar designación invalida consulta |
| Tiempos | Inserción de dos periodos reales; versión obsoleta y minutos inválidos no borran captura anterior |
| Cruces | Partidos separados permiten evaluación; coincidencia devuelve pendiente explícito. Excepción de mitades pendiente de precisión de Liga |
| Dorsal | Cambia dorsal sintético, mantiene identidad/documentos y elegibilidad sin consultas al proveedor |
| Historial cerrado | Rama CLOSED devuelve aviso y colección sin recalcular; fixture local temporal, no cierre funcional real |
| Interfaz | Chrome con DTO sintético: elegible, bloqueado, motivo de sanción, Enter, claro/oscuro, 390/1440 y CSS real |

La suite integra servicios reales y PostgreSQL local, con proveedores simulados.
El navegador usa DTOs sintéticos y no acredita una sesión/backend integrado ni la
cédula real. No se ejecutaron API reales CURP/INE, Supabase o bases compartidas.

## Demostración breve

Con un árbitro operativo y designación aprobada en el entorno de revisión:

1. Abrir Arbitraje → Mis partidos · Alineación → Consultar alineación.
2. Revisar un jugador del origen o superior autorizado: «Elegible para este
   partido», origen, destino y dorsal habitual. Abrir «Tiempos registrados» con Enter.
3. Revisar un sancionado: «No habilitado para alinear» y «Hay una sanción vigente
   que impide la participación». La prueba Chrome reproduce ambos estados con
   nombres sintéticos; las pruebas de servicio verifican la decisión real.
4. Probar URL con otro actor/revocar designación: acceso denegado en servidor.

## Antes de aceptar

- Revisar código/contrato por otra persona (Víctor/Sergio), y flujo por Nickte/Karol.
- Liga: precisar excepción de horarios coincidentes descrita en PDGLD-68, periodos,
  reloj y vigencia. El sistema no certifica estos casos mientras falte la decisión.
- Contrastar el PDF completo del ERS: solo se encontró una versión preliminar en
  Drive con numeración distinta de Jira; ver documento de arquitectura.
- Integrar y demostrar PDGLD-18 con cédula, estados y guardado real. Hoy solo se
  valida su contrato sobre fixtures sintéticos de base y DTOs de interfaz.
- Aceptación funcional humana y evidencia en entorno de pruebas. PR y CI verde
  no cierran historia ni subtareas. Mantener Draft mientras existan esos pendientes.

## Corrección de revisión sobre 4b3e48d · 11/11/2026

- Candidatos: prueba PostgreSQL de plantillas local/visitante, inscripción de otra
  categoría del mismo club/temporada excluida y participación superior autorizada
  incluida solo en su destino. La regresión de sanciones conserva el candidato
  autorizado y muestra `PARTICIPATION_BLOCKED`.
- Carrera: dos transacciones PostgreSQL coordinadas con barreras y comprobación
  de `pg_blocking_pids`, sin presumir intercalación por una pausa. Reprogramación
  actualiza horario y versión sin confirmar; el guardado con la versión entonces
  visible espera, recibe `STALE_MATCH` tras el commit y conserva periodos completos
  y versión de cédula. En orden inverso, se termina la función de guardado pero
  se mantiene abierta su transacción; el UPDATE de reprogramación espera hasta
  el commit. Se ejercitan los triggers reales de reservas y auditoría.
- Se mantienen pendientes la regla de cruces por mitades, el contraste con el ERS
  completo y la integración real con PDGLD-18; el PR permanece Draft.

Validación final de la corrección (11/11/2026): `npm run typecheck` y
`npm run lint` aprobados; `npm run test:ci` 93/93;
`npm run test:match-eligibility-integration` 19/19 y
`npm run test:match-eligibility-browser` 1/1 (cuatro combinaciones claro/oscuro,
390/1440 y teclado). El fixture adicional falló inicialmente por omitir CURP y
fecha de nacimiento obligatorias; se completó con valores sintéticos y la suite
final pasó. Sin llamadas reales CURP/INE ni bases compartidas. Fetch final de
`origin/develop`: 0a2fc44, sin avances que integrar ni regresiones ajenas en el diff.

## Integración de develop · 12/11/2026

Merge de `origin/develop` 8313e5c sobre 4ed7905. El único archivo en conflicto fue
`src/features/auth/server/management-navigation.ts`, con dos fragmentos en la
lista de capacidades y sus comprobaciones. Se conservaron `matchEligibility`
con `canAccessMatchEligibility` y `venues` con `canReadVenues`, en el mismo orden
entre resultados y funciones. Permanecen los enlaces autorizados de Arbitraje y
Canchas. El workflow combinó las suites de ambos tickets automáticamente.

El servicio de elegibilidad y sus pruebas conservan exactamente el contenido de
4ed7905. La consulta limita las dos plantillas y ascensos autorizados al destino.
El guardado conserva `FOR SHARE` y la comprobación de versión hasta el final de
su transacción. PostgreSQL aislado pasó 19/19, incluida la exclusión de otra
categoría, la inclusión del ascenso autorizado y la carrera coordinada en ambos
órdenes con `pg_blocking_pids`, `STALE_MATCH` y conservación de la captura.

Pasaron tipado, lint, Chrome sintético 1/1, controles de pipeline 93/93, zonas
horarias de canchas 2/2, cierre compartido 3/3 y panel 6/6. Fue necesario iniciar
Docker Desktop y generar el cliente Prisma en el worktree restaurado antes de
repetir los controles que dependían de esos recursos. El fetch final confirmó
8313e5c. Continúan declarados los pendientes de cruces por mitades, contraste con
el ERS completo e integración real con PDGLD-18.
