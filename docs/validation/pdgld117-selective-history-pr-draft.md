PDGLD-117: corregir identidad deportiva y preservar el historial de temporadas

La corrección deja de bloquear globalmente a toda persona con referencias en
cierres. Antes de permitirla se protegen los lectores históricos: nombres por
snapshot o ausencia, expediente sin evaluación vigente, CURP/INE operativos
bloqueados en CLOSED y participaciones sin afirmar habilitación actual.
Las referencias arbitrales cerradas conservan un bloqueo específico.

APPLY conserva people.id, unicidad CURP, versionado, permisos completos y auditoría;
solo invalida/revalúa inscripciones y participaciones de temporadas abiertas.
Una migración aditiva captura nacimiento, política/regla versionada, estado y
referencias privadas en cierres futuros. No hay backfill ni copias de documentos.
Cierre/corrección comparten el orden de bloqueo y requieren atomicidad; SQL
sin un trámite válido/finalizado no puede alterar identidad con historia.

Validación local del incremento: PG15 y PG17 aprobados con 35 comprobaciones
de identidad por versión; migraciones, drift y regresiones de aplicación
aprobadas en ambas versiones, con datos sintéticos y limpieza entre versiones. Incluye el caso mixto,
hechos ausentes, resultados/sanciones no vacíos sin cambios, dos órdenes de
concurrencia, permisos, CURP duplicada y rollback. Contratos/UI se prueban en
Chrome real; nunca proveedores ni correo reales.

Límites: historial arbitral sin lector validado sigue bloqueado; no se
atribuyen reportes/exportaciones inexistentes ni lectores externos como aprobados.
ACL/RLS productivos, retención, respaldos y protección de evidencia privada
requieren revisión. El fallo de browser-harness de CI #159 permanece como
incidencia separada, sin aumentar tiempos ni relajar sus aserciones.

Actualización del mismo PR #45 hacia `develop`, sobre `7ba6b35`, con base
`780795e`. No cambia reglas de edad ni excepciones; conserva cuentas y correo
ya integrados. No habilita despliegue productivo.

Tipado, lint afectado, build y controles CI locales (93) aprobados. La matriz
SQL también aprobó captura futura, inmutabilidad, ausencia de backfill y rechazo
de correcciones sin finalización/auditoría. Evidencia detallada:
`docs/validation/pdgld117-selective-history-results.md`. El resultado del nuevo
CI remoto se consulta por separado; los resultados locales no lo sustituyen.
