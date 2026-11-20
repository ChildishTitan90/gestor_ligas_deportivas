# Integración PDGLD-24 y PDGLD-25

Se incorporó la rama de Sergio en f2f9b35, incluido el validador compartido
validateScheduleProposalInTransaction y su contrato PDGLD-137.

## Lectura y edición

La pantalla /scheduling/proposals interpreta el calendario JSON completo del
generador, con todas sus jornadas y descansos. POST /api/scheduling/proposal-detail
exige READ en la liga y devuelve autor, versión de edición, estado, versión de
temporada, reglamento y encuentros. El hash de generación permanece en servidor.

POST /api/scheduling/adjustments recibe propuesta, expectedVersion, índice del
encuentro en esa versión, cancha, inicio ISO UTC, intercambio opcional de local
y visitante y motivo. La pantalla convierte la hora de la liga a UTC y rechaza
horas ambiguas o inexistentes. El índice nunca identifica un partido oficial.

El servidor obtiene la identidad de la sesión y exige UPDATE en el ámbito de
liga. En una transacción SERIALIZABLE bloquea autorización, temporada y propuesta
en el mismo orden que el generador, comprueba DRAFT y expectedVersion, construye
el calendario candidato completo y llama al validador de Sergio. Guarda los
encuentros y descansos normalizados, preserva los metadatos y el hash original,
incrementa la versión y registra motivo, actor y cambio en auditoría. No existe
un adaptador de validación sustituible en el servicio de producción.

La validación recalcula duración, holgura y preferencias con datos vigentes.
Un error conserva versión, estado y contenido. Las colisiones de serialización
se devuelven como conflicto recuperable y nunca se reintentan con otra versión.

## Revisión

POST /api/scheduling/review controla DRAFT → IN_REVIEW → APPROVED y devolución
a DRAFT. Cada transición comprueba la versión e incrementa y audita la misma
versión. Enviar y aprobar vuelven a validar todo el calendario en la transacción.
La devolución exige APPROVE y motivo, sin exigir que el borrador siga siendo válido.

El validador compartido conserva UPDATE como permiso predeterminado. La aprobación
pasa APPROVE como cuarto argumento de servidor, para respetar la matriz RF22:
Presidencia puede aprobar sin recibir permisos de edición. Ningún campo del
cliente decide ese permiso. El programador no puede aprobar.

El JSON mantiene state=DRAFT_PROPOSAL como formato del generador; status de la
fila representa la revisión. No se crean partidos oficiales, reservas ni
publicaciones. La confirmación posterior deberá revalidar y reservar recursos.
La prohibición de publicar una propuesta propia corresponde al flujo de publicación.

## Recuperación

Antes de enviar, la pantalla conserva la captura en sessionStorage, separada por
actor, propuesta, versión e índice. Ante respuesta incierta la captura queda
bloqueada para recuperar y reenviar exactamente el mismo comando, incluso tras
cerrar el diálogo o recargar la pestaña. Permite actualizar la propuesta para
comprobar su contenido vigente. El control de versión impide aplicar el reintento
dos veces. Cerrar la pestaña termina esta persistencia.

## Verificación

La prueba tests/integration/scheduling-adjustment-shared.ts usa una propuesta
real del generador y el validador completo, sin simular restricciones. Comprueba
lectura con autor, intercambio de localía, normalización, respuesta perdida tras
guardado, única auditoría, bloqueo posterior que impide guardar y enviar,
ediciones simultáneas, versión antigua, revisión y separación de permisos,
sin crear partidos ni reservas. La invoca la suite de Sergio a través de
npm run test:scheduling:integration, incluida en la matriz PostgreSQL 15/17 del CI.

La prueba Chrome tests/e2e/scheduling-proposals.test.mjs usa transporte simulado
para comprobar recuperación exacta del comando, separación por usuario y versión,
y controles de revisión en 390 y 1440 píxeles con ambas preferencias de tema.
No sustituye una prueba visual ni una sesión conjunta con Sergio sobre la aplicación.

El flujo anterior de propuestas basadas en filas de matches conserva su propia
validación y pruebas. Las propuestas generadas formato 1 se editan exclusivamente
mediante el JSON y el validador compartido.

## Evidencia local — 19 de noviembre de 2026

| Subtarea | Entrega | Comprobación |
| --- | --- | --- |
| PDGLD-138 | Ajuste del JSON, versión, motivo, auditoría y revisión atómica | Generador y validador reales; permisos por liga, bloqueo, concurrencia, respuesta perdida y versión obsoleta |
| PDGLD-139 | Pantalla de propuestas y diálogo con captura recuperable | Cuatro pruebas Chrome con transporte simulado: 390/1440 px, claro/oscuro |
| PDGLD-140 | Integración y conexión al CI | Suite completa sobre PostgreSQL 15 y 17 temporales; 17 pruebas puras de programación y conservación de metadatos |

TypeScript y ESLint pasaron. El YAML del workflow se analizó correctamente.
La suite integrada también crea y ajusta una propuesta con un rol SQL limitado,
sin conceder privilegios de propietario. Ese runner no activa RLS; las sesiones
HTTP/RLS del flujo anterior y la prueba con transporte simulado tienen alcances
separados. El recorrido visual conjunto de la pantalla nueva con Sergio sigue
siendo una comprobación de aceptación pendiente.

La incorporación de status/version exige incluir esas columnas en el INSERT
del rol backend. Se actualizó el plan de permisos y se probó ese recorrido.
La espera para adquirir una transacción es de hasta 10 segundos; su tiempo de
ejecución conserva el límite de 30 segundos.

La suite general test:ci obtuvo 89/94 en Windows. Sus cinco fallos corresponden
a permisos POSIX, rutas temporales y ejecución de procesos no compatibles con
Windows. Los cinco se reprodujeron en una copia archivada de f2f9b35, anterior
a los cambios de PDGLD-25. No se presentan como una ejecución remota verde del CI.

Esta rama incorpora PDGLD-24 como dependencia. Antes de comparar el PR contra
develop debe integrarse allí la rama de Sergio, o revisar temporalmente PDGLD-25
con su rama como base. La publicación y las reservas oficiales siguen separadas.

La reconstrucción desde migraciones y prisma migrate diff terminaron sin
diferencias. La regresión PostgreSQL 15 del flujo anterior también pasó.
