# PDGLD-60 — Revisión de afiliaciones

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
status, reviewPhase, observations, reviewedAt y version.
El detalle añade uniformColors, categoryIds, officers (arreglo por office),
signedAffiliationFileId e history. Cada directivo incluye nombre y apellidos,
signatureFileId y supportFileId. Solo el solicitante recibe submissionKey.
Los archivos se representan por identificador, nunca storage_key ni URL pública.
Su carga/descarga privada y validación del contenido pertenecen a PDGLD-59.
El historial contiene id, action, occurredAt, actorId y observations.

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
CORRECTIONS_REQUESTED. APPROVED/REJECTED se muestran como tales; no se implementa
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
