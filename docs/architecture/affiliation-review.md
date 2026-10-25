# PDGLD-60 — Revisión de afiliaciones

Actualización de integración 25/10/2026: el PR #28 se recibió desde develop en
la rama PDGLD-62/64, conservando este servicio y los contratos de corrección.
La aprobación de este documento cambia la afiliación; **no autoriza categorías
individuales**. No escribe `club_affiliation_categories.authorized_by` ni
`authorized_at`. La inscripción consume esas marcas y rechaza
`CATEGORY_NOT_AUTHORIZED` si faltan. Checo coordina esa autorización y, si necesita
selección visual, debe acordarla con Nick. No se introduce una aprobación alternativa.
Consulta la [evidencia conjunta](../validation/PDGLD-62-PDGLD-64-integracion-pr28.md)
para resultados actuales; las verificaciones anteriores se conservan como historial.

Contrato para integrar la bandeja PDGLD-61. Implementación backend en esta rama;
no representa cierre de HU01-02 ni validación del flujo de archivos de PDGLD-59.

## Consultas

- GET /api/affiliations?leagueId=UUID&status=PENDING&page=1&pageSize=20
  admite clubId y seasonId opcionales. leagueId obligatorio, pageSize máximo 100.
  Respuesta: { items, page, pageSize, hasMore }. Orden estable por id.
  Requiere clubs:READ en el contexto completo; un delegado debe enviar su clubId.
- GET /api/affiliations/{id}: detalle autorizado por liga, club y temporada.
  Todos los resultados son privados y no se almacenan en caché.

Cada resumen contiene id, referenceNumber, clubId, leagueId, seasonId, clubName,
status, reviewPhase, observations, reviewedAt, version y seasonName.
El detalle añade uniformColors, categoryIds, officers (arreglo por office),
signedAffiliationFileId, categories (nombres), allowedActions e history. Las acciones
se calculan con las mismas reglas de revisión de la escritura y no sustituyen la
autorización de PATCH. Cada directivo incluye nombre y apellidos,
signatureFileId y supportFileId. Solo el solicitante recibe submissionKey.
Los archivos se representan por identificador, nunca storage_key ni URL pública.
Su carga/descarga privada y validación del contenido pertenecen a PDGLD-59.
El historial contiene id, action, occurredAt, actorId y observations.
La bandeja presenta acción, fecha y observaciones del historial autorizado, en orden
cronológico y con zona America/Mexico_City. Su adaptador descarta actorId del modelo
de presentación; no expone identificadores de usuarios en la vista. Los motivos se
renderizan como texto y el historial se retira con el detalle al perder autorización.

## Revisión y concurrencia

PATCH /api/affiliations/{id}/review, con JSON y Origin del mismo sitio:

```json
{ "decision": "APPROVE", "expectedVersion": 0 }
```

o:

```json
{ "decision": "REQUEST_CORRECTIONS", "expectedVersion": 0, "observations": "Aclarar colores del uniforme." }
```

expectedVersion es el version obtenido al consultar el detalle. Nunca incrementarlo
desde la UI suponiendo que la operación tuvo éxito. Observaciones obligatorias,
recortadas y de 1 a 2000 caracteres. El servidor no acepta autor, fecha ni estado.
Éxito 200 con resumen actualizado.

Se aplica el criterio vigente de HU01-02: asignación SECRETARY con clubs:APPROVE
vigente y alcance suficiente en la misma concesión. El permiso no se deduce del
nombre del rol. SUPERADMIN u otro rol con APPROVE por RF22 no adquiere por ello
la función específica de secretario en esta historia. Se impide revisar al
solicitante y a quien tenga una asignación vigente CLUB_DELEGATE del mismo club,
incluso si también es secretario. No se cambia el catálogo RF22.

La transacción toma el bloqueo compartido de autorización y bloquea la solicitud
FOR UPDATE antes de resolver su contexto. Comprueba estado, versión y temporada
abierta; actualiza revisión y versión y añade un evento inmutable en audit_logs.
Un fallo en cualquiera de esos pasos revierte todo. No modifica estado/nombre
operativo del club ni inscribe equipos.

Errores con cuerpo { code }:

| HTTP | code | Acción de la interfaz |
| --- | --- | --- |
| 401/403 | UNAUTHENTICATED / PASSWORD_CHANGE_REQUIRED / FORBIDDEN | Aplicar flujo de acceso; no mostrar éxito |
| 400 | VALIDATION_ERROR / INVALID_PAYLOAD | Corregir entrada |
| 403 | INVALID_ORIGIN | No enviar desde otro sitio |
| 404 | NOT_FOUND | Refrescar bandeja |
| 409 | AFFILIATION_ALREADY_REVIEWED | Otra operación resolvió la solicitud; recargar detalle |
| 409 | STALE_AFFILIATION | Cambiaron los datos; recargar y pedir revisión explícita |
| 409 | CORRECTIONS_PENDING | Esperar reenvío del solicitante |
| 409 | CORRECTIONS_NOT_REQUESTED | No corresponde un reenvío |
| 409 | SEASON_CLOSED | Temporada cerrada |
| 413 | PAYLOAD_TOO_LARGE | Máximo 64 KiB |
| 503 | SERVICE_UNAVAILABLE | No asumir resultado; consultar antes de reintentar |

Dos aprobaciones simultáneas producen un éxito y un conflicto, con un solo evento.
El conflicto no devuelve datos del estado actual: se consulta nuevamente el detalle.

## Correcciones y reenvío

Correcciones solicitadas conserva status=PENDING, review_reason, reviewer y fecha.
reviewPhase se deriva: PENDING sin motivo es AWAITING_REVIEW; con motivo es
CORRECTIONS_REQUESTED. Para APPROVED/REJECTED, reviewPhase es null; no se implementa
rechazo definitivo ni nuevas transiciones.

PATCH /api/affiliations/{id}/resubmit recibe el contrato completo de envío de
PDGLD-57 más expectedVersion. Conserva clubId, seasonId y submissionKey originales.
El detalle del solicitante permite recuperar esa clave. Requiere el solicitante
original con asignación de delegado del club y clubs:UPDATE vigente.
Valida nuevamente categorías, temporada y metadatos de las tres firmas.
Actualiza el mismo folio, categorías y directivos, conserva PENDING, limpia la
revisión actual y aumenta version. No elimina el historial de revisiones.
Las identidades previas de los directivos se conservan en people.

Respuesta 200: id, referenceNumber, status, replayed=false, version y
reviewPhase=AWAITING_REVIEW. Un reintento con versión antigua devuelve 409;
consultar detalle para confirmar el resultado. No se debe reenviar automáticamente
con una versión nueva. El hash y la clave originales de POST se conservan: un
reintento del envío inicial sigue recuperando el folio y nunca sobrescribe correcciones.

Las observaciones forman parte del historial funcional privado, dentro de new_data,
y se devuelven solo tras autorizar READ. Los motivos técnicos de auditoría son fijos.
No se imprimen observaciones, nombres, firmas, claves de almacenamiento o SQL en
logs de errores. La UI debe pedir únicamente observaciones sobre la solicitud,
sin credenciales ni documentos completos.

## Migración y verificación

Migración aditiva 20261022180000_pdgld60_affiliation_review: review_version entero,
NOT NULL, valor inicial 0 y CHECK no negativo. No modifica migraciones compartidas,
políticas RLS, permisos ni tablas de archivos. Recibir por migrate deploy en entorno
local según docs/migraciones.md; Supabase conserva su proceso de despliegue revisado.

Las pruebas nuevas están en la suite existente test:affiliations, también incluida
en test:auth, y los contratos en test:affiliation-input. Cubren permisos, alcance,
revocación, separación de funciones, correcciones, versión obsoleta, rollback y
operaciones simultáneas.

Verificación local del 22/10/2026: lint, typecheck, 18 controles de migración y 15 pruebas
de contratos pasan. Con Docker encendido, test:affiliations terminó con 23 resultados
aprobados (incluidos dos contenedores de pruebas), cero fallos: envío, permisos,
correcciones, reenvío, rollback y concurrencia. El runner aplicó las migraciones y
comparó el esquema en una base temporal local; al finalizar eliminó esa base y detuvo
su servidor. El primer intento no logró iniciar Next.js; el segundo completó la suite.
Build pendiente: el reintento sigue fallando al crear el proceso CSS de Turbopack local.
El comando también emitió un aviso de seguridad de Next.js; no se verificó el advisory
ni se actualizaron dependencias en este ticket. No declarar la compilación aprobada.
Falta integración con PDGLD-59/61, revisión independiente y evidencia en CI.

Actualización 24/10/2026: la bandeja PDGLD-61 ya consume estos endpoints en esta
rama. Pasaron 18 pruebas de interfaz/controlador/adaptador y 24 resultados de
integración HTTP/PostgreSQL (incluidos contenedores de pruebas). El recorrido real
del adaptador cubre consulta, correcciones, reenvío, conflicto de versión y
aprobación; no equivale a una prueba de clics en navegador. También pasaron lint,
typecheck y las seis pruebas de configuración de conexión de PDGLD-73.
El build sigue detenido por el proceso CSS de Turbopack con Node 24.21.0.
Se conservan las dependencias actuales por indicación del usuario. Quedan pendientes
PDGLD-59, validación en navegador, revisión independiente, CI y compilación exitosa.

Actualización posterior del 24/10/2026: Víctor autorizó Node 24.22.1 LTS. Se instaló
correctamente (npm 11.19.1) y test:affiliations volvió a completar 24 resultados
aprobados, cero fallos, con limpieza de la base temporal. El primer arranque de
Next.js falló y el segundo completó la suite. El build sigue fallando al iniciar
el proceso CSS de Turbopack; la actualización de Node no corrigió ese fallo.
No se actualizaron dependencias npm del proyecto.

Verificación del historial visible, 24/10/2026: pasaron lint, typecheck y las 20
pruebas de test:affiliation-review. Se comprobó el orden correcciones/reenvío/
aprobación, el estado vacío, el escape de observaciones, el rechazo de un historial
inválido y la retirada del detalle privado tras 401/403. test:affiliations completó
24 resultados aprobados, cero fallos, contra PostgreSQL temporal, incluyendo la
conservación de los cinco eventos reales de dos rondas de corrección y la aprobación
en el adaptador/controlador. El primer arranque de Next.js falló; el reintento pasó.
No se repitió el build, cuyo fallo CSS sigue pendiente; no se modificó su configuración.
Esta comprobación no cubre clics, foco e hidratación en navegador, documentos privados
de PDGLD-59, CI remoto, despliegue ni revisión independiente. Los cambios locales
todavía deben consolidarse en commit; hay una integración de develop en curso.

## Integración con PDGLD-59 — 24/10/2026

Se incorporó origin/develop en 1d732d6 (PR #26 de Karol), conservando validación
del contenido y vinculación de firmas, catálogo, migraciones y suites de ambos tickets.
La bandeja utiliza opciones de liga autorizadas y presenta los directivos actuales,
historial y acceso explícito a enlaces temporales del endpoint privado de firmas.

El delegado encuentra sus correcciones desde `/affiliations/new` y abre
`/affiliations/{id}/correct`, con READ/UPDATE, propiedad, fase y versión verificadas.
Las firmas existentes pueden conservarse o sustituirse; su carga deriva UPDATE
de la solicitud pendiente propia y no exige conservar CREATE. Un alta nueva sí
requiere CREATE. El servidor revalida firma y contexto durante el reenvío.

Los nuevos reenvíos guardan en la auditoría referencias a las personas, archivos y
categorías previas y actuales. Esto conserva la relación histórica que se perdía
al actualizar los directivos en su fila. Son identificadores privados: no se copian
nombres, bytes, claves de Storage ni enlaces firmados. El DTO de historial de la
bandeja sigue limitado a acción, fecha y observaciones.

Pruebas y límites actuales: [evidencia de integración](../validation/PDGLD-60-integracion-afiliaciones.md).
