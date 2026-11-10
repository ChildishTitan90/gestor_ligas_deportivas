# PDGLD-15 — validación de ventanas y excepciones de edad

Actualización: 8 de noviembre de 2026 (America/Mexico_City).

## Alcance y versión comprobada

PDGLD-103 configura fases de altas por categoría y temporada, con apertura incluida y cierre excluido, en la zona horaria configurada. La fase se intersecta con los días semanales permitidos. Sin fases se conserva la ventana semanal. Las bajas no deben heredar las restricciones de las altas.

Se reutilizan autorización, bloqueos, versión y auditoría de la política deportiva. Las fases se configuran antes de registrar jugadores; esta entrega no permite sustituir una política deportiva ya utilizada. La edición documental conserva las fases. La migración adicional protege INSERT de inscripciones, sin modificar filas históricas ni RLS.

- Implementación: [PR #47](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/47), commit `24a5211e52c711430ad0d256d350c5f258003eba`.
- Aprobación de ChildishTitan90: [revisión registrada](https://github.com/ChildishTitan90/gestor_ligas_deportivas/pull/47#pullrequestreview-5821044726).
- Integrado a develop mediante `52d77ee0e5128c5f782785a92c9060d89f5a8401`.
- Al preparar esta actualización se consultó develop en `f7370afbefd363054300f1f8e072ead654d8d7e8`. La evidencia de CI siguiente corresponde al commit del PR #47, no a todos los cambios posteriores de develop.

## Comprobaciones aprobadas

[CI #150 — ejecución 42546629952](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42546629952): concluida correctamente para el PR #47.

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| Aplicación: revisión de código y compilación | Aprobada | [Job Aplicación](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42546629952/job/128932922094) |
| Migraciones, integridad y suite de jugadores en PostgreSQL 15 | Aprobadas; 62 pruebas de jugadores, 0 fallos | [Job PostgreSQL 15](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42546629952/job/128932921245) |
| Migraciones, integridad y suite de jugadores en PostgreSQL 17 | Aprobadas; 62 pruebas de jugadores, 0 fallos | [Job PostgreSQL 17](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42546629952/job/128932921563) |
| Check conjunto «CI listo para integrar» | Aprobado | [Job conjunto](https://github.com/ChildishTitan90/gestor_ligas_deportivas/actions/runs/42546629952/job/128934835222) |
| Pruebas puras de admisión y política | 21 aprobadas en la ejecución local aportada | `node --import tsx --test src/features/competitions/player-admission.test.ts src/features/competitions/player-policy.test.ts` |
| Migración de fases en PostgreSQL 15 local y generación de Prisma | Aplicación y estado actual confirmados por la salida aportada por Karol | `prisma migrate deploy`, `prisma generate` y `prisma migrate status` |

Los logs de ambos jobs PostgreSQL contienen los cuatro escenarios PDGLD-105 de fases y los escenarios PDGLD-104 de excepción. Las pruebas usan identidades y transportes externos sintéticos. No acreditan consultas reales a proveedores de CURP o INE. El despliegue de migraciones a Supabase producción quedó omitido en esta ejecución; CI verde no equivale a un despliegue de producción.

## Cobertura de los criterios solicitados

| Criterio | Evidencia automática aprobada | Evidencia del recorrido manual |
| --- | --- | --- |
| Captura dentro de ventana permitida | Servicio y trigger admiten apertura y momentos interiores; inscripción inicialmente INELIGIBLE | Karol mostró captura exitosa en fase abierta y apertura del expediente; falta adjuntar la evidencia recortada al PR o Jira |
| Bloqueo fuera de horario/día/fase | Cierre exacto excluido, huecos entre fases, día semanal y zona configurada; rechazo SQL directo y rollback sin residuos | Pendiente de adjuntar un rechazo visible con su configuración y fecha/hora local. No se impone un horario físico fijo no acordado |
| Bloqueo por edad | Fuera de rango rechaza; edad excepcional exige solicitud; no deja identidad, historial ni auditoría parcial | Pendiente de adjuntar intento fuera del rango y mensaje de rechazo con referencia anual y política utilizadas |
| Excepción con documento y motivo | Carta propia confirmada, documento del tutor no sustituye carta y motivo vacío rechazado | Existe material histórico aportado de la excepción anterior; falta vincular en un mismo caso la carta vigente, solicitud y motivo |
| Autorización y auditoría de la excepción | Solo Secretaría con APPROVE del contexto; decisión idempotente y un evento PLAYER_AGE_EXCEPTION_DECIDED; reemplazo de carta invalida aceptación | Pendiente de adjuntar decisión vigente y evidencia autorizada del evento auditado del mismo expediente. No basta una aprobación anterior a reemplazar la carta |
| Reenvíos sin duplicados | Reenvíos, altas concurrentes y recuperación después del cierre conservan inscripción/acuse sin nuevas escrituras | Pendiente de documentar reenvío del mismo caso y conservación del identificador/única inscripción |
| Bajas sin restricción de altas | Prueba pura «la baja no depende de edad, política o día de alta» aprobada localmente | Pendiente recorrido autorizado de baja fuera de ventana, con resultado persistido e historial. La prueba pura no acredita el servicio completo ni la interfaz |

Fuentes de las pruebas: [admisión con PostgreSQL](../../tests/integration/player-admission.ts), [inscripciones y concurrencia](../../tests/integration/player-registrations.test.ts), [excepciones de edad y auditoría](../../tests/integration/player-age-exceptions.ts) y [reglas puras de movimientos](../../src/features/competitions/player-admission.test.ts).

## Recorrido manual ya observado

Entorno local de Karol, con sesión de delegado autorizada, temporada «PRUEBA PDGLD-103 Ventanas 2026», categoría «PRUEBA PDGLD-103 Ventanas» y equipo «Equipo Ventanas PDGLD-103».

La configuración de prueba incluía America/Mexico_City, lunes/martes/miércoles/domingo y fase local desde `2026-11-08T00:00:00` hasta `2026-11-12T00:00:00` (cierre excluido). El domingo fue una configuración del fixture; no modifica el criterio ordinario de lunes a miércoles.

El 8 de noviembre se mostró la captura del caso sintético «Ventana Prueba Demo», de 13 años por referencia 2026, mediante petición explícita de excepción. El resultado fue «Captura recibida sin habilitación» y abrió el expediente `17f18a64-4454-439a-8858-fb9ca922eadb`, con estado «Falta presentar la petición».

Esto acredita recepción dentro de la fase y navegación al expediente. No acredita un alta ordinaria con identidad verificada, autorización de la excepción, aprobación documental ni habilitación para competir. Las capturas fueron compartidas en la conversación; aún deben incorporarse, recortadas y sin información ajena, a la evidencia del PR/Jira.

## Evidencia que falta para el cierre funcional

Para cada escenario pendiente de la matriz, registrar entorno/versión, cuenta o rol autorizado, identificador del caso sintético, política y fecha/hora/zona del servidor, acción, resultado esperado y observado, y enlace a la evidencia en PR/Jira. No publicar CURP, firmas, documentos privados, credenciales ni notificaciones personales.

1. Adjuntar el caso exitoso ya observado y el bloqueo fuera de fase/día, mostrando apertura/cierre y hora local. Si se requiere validar alta ordinaria, documentar un caso propio adicional.
2. Adjuntar bloqueo por edad y completar la trazabilidad de un expediente de excepción: carta vigente confirmada, motivo, petición, decisión de Secretaría y evento auditado del mismo caso. La aprobación de edad no habilita por sí sola al jugador.
3. Documentar el reenvío del mismo caso sin una segunda inscripción ni una segunda decisión auditada.
4. Ejecutar y documentar una baja con autorización vigente fuera de la ventana de altas, verificando persistencia e historial. Si no existe un recorrido soportado, registrar el impedimento; no sustituirlo por una modificación SQL directa.
5. Vincular las evidencias en PDGLD-103/104/105 y obtener aceptación del recorrido completo por el equipo antes de cerrar PDGLD-15.

Usar fixtures aislados para cierres de fase: no cambiar el reloj del equipo ni modificar una política ya utilizada. Los resultados automatizados aprobados no se vuelven a listar como pendientes. Permanece pendiente la evidencia funcional indicada; este documento no declara cerrado PDGLD-15.
