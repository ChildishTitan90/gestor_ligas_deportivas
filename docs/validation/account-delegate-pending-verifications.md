# PDGLD-93 — Verificaciones del alcance acordado y seguimiento

Actualizado el 1 de noviembre de 2026 conforme al acuerdo de Víctor.
La [matriz](account-delegate-acceptance-matrix.md) es la referencia por criterio;
los [resultados históricos](account-delegate-approved-results.json) se conservan.

## Dentro del incremento

Un titular y un subdelegado de personas distintas pueden operar normalmente a
la vez con las mismas capacidades CLUB_DELEGATE, según permisos, ámbito y vigencia.
No hay modo sustitución. La autoría de solicitudes y firmas sigue protegida.
No queda pendiente decidir esas capacidades: el acuerdo las confirma.

- E1–E6 acreditan cupos, persona/cuenta distinta, concurrencia SQL de altas,
  periodos, autoría y validaciones HTTP/Chrome/Preview en el alcance de la matriz.
- E7 aprobó equal-capabilities-scoped-authorship en SQL aislado 15/17: ambos
  representantes activos, capacidades iguales, revocación, club ajeno y guard de
  firmas propias/ajenas. Limpieza verificada entre versiones y al terminar.
- E8 aprobó carreras HTTP PRIMARY/DEPUTY en 15/17, dos identidades por plaza:
  un 201 y un 409 de cupo, un vínculo y ningún residuo del perdedor. Limpieza
  verificada. Estas nuevas comprobaciones ya no están pendientes.
- CI remoto requiere nueva ejecución tras publicar la corrección portátil. El
  último run falló por /private/tmp en Ubuntu; ambos jobs PostgreSQL aprobaron.
- Quedan revisión independiente y revisión humana de accesibilidad/dispositivos.
  Las capturas históricas no prueban la nueva leyenda del formulario.

## Seguimiento separado: no implementado ni requerido en este incremento

Reemplazo atómico autorizado, reemplazos concurrentes, cierre administrativo,
historial completo, elegibilidad de cuenta entrante y recuperación de respuestas
inciertas de ese futuro contrato. No se implementa PDGLD-117. El
[contrato previo](../architecture/representative-assignment-contract-draft.md)
se conserva como propuesta pendiente de validación. No se crean tickets Jira aquí.

Conservar datos, vigencias y auditoría no significa implementar la lectura
administrativa ni un servicio de reemplazo. E6 usa SQL de fixture únicamente
para verificar conservación de autoría/referencias; no acredita ese servicio.

## Evidencia y ejecución futura

E1–E6 siguen privados y duraderos fuera del repositorio (37 archivos y manifiesto
SHA-256). Solo resúmenes saneados en Git. No reutilizar run-id consumidos.
E7 y E8 también están archivados privadamente con hashes y limpieza verificados.
Las [regresiones](representative-agreed-rule-tests.md) y la matriz conservan sus
resultados y límites; esta actualización no repitió servicios. No hace falta
repetir SQL, HTTP, Chrome o Preview para documentar las aprobaciones.
