# PDGLD-103: evaluación de edad y días de alta

Primera entrega de PDGLD-15. Añade `evaluatePlayerMovement` en el módulo de
competencias para componer las funciones vigentes de `player-policy.ts` sin
duplicar el cálculo de edad o el día de la semana. Base revisada: develop
2469e6f. No modifica tablas, dependencias, rutas ni servicios existentes.

## Contrato

- REGISTER recibe política, fecha de nacimiento y reloj explícito. Revalida la
  política con el esquema vigente y devuelve todos los bloqueos de edad/día.
- Edad = año de referencia menos año de nacimiento. Conserva los rangos
  configurados, límites inclusivos y máximo nulo. Rechaza fechas inválidas o
  futuras respecto del calendario local de la política.
- Usa registrationDays y timezone de la política de la categoría. Para el
  criterio lunes a miércoles de Morelia, configurar [1,2,3] y
  America/Mexico_City; no reemplazar configuraciones de otras ligas.
- Una edad excepcional devuelve AGE_EXCEPTION_REQUIRED. Ninguna carta ni
  propiedad del cliente convierte este resultado en aprobación.
- WITHDRAW omite estas restricciones de alta. Esto no concede autoridad para
  dar de baja ni omite otras condiciones del trámite.
- RULES_SATISFIED significa únicamente que estas reglas no bloquearon. No es
  autorización, aprobación documental o habilitación deportiva.

## Integración pendiente

El registro de jugadores de PDGLD-13/14 se encuentra en el PR #39, fuera de la
base develop examinada. Este módulo aún no bloquea escrituras de la aplicación.
Al integrar: autorizar actor, permiso y contexto reales; leer política vigente
mediante readPlayerPolicy y obtener reloj del servidor dentro de la misma
transacción; ejecutar la evaluación antes de crear Persona/inscripción. Nunca
confiar en política, edad, reloj, permisos o aprobación enviados por navegador.
Conservar idempotencia, restricciones SQL y rollback. Revisar los triggers de
ventana existentes para no mantener criterios contradictorios.

El esquema actual no ofrece ventanas por fase ni horas de recepción: esta
entrega no inventa fechas, horarios o reglas históricas de otra temporada.
La autorización de excepciones necesita resolver la autoridad y evidencia de
PV-04: la documentación de competencias menciona aprobación administrativa y
la historia menciona Secretaría. No se implementa un permiso nuevo por inferencia.
Quedan pendientes integración HTTP/base, revocación de permisos, concurrencia,
fases, UI y proceso de excepción: PDGLD-15 no está completada por estas pruebas.

## Verificación

Desde la raíz del repositorio:

```powershell
node --import tsx --test src/features/competitions/player-policy.test.ts src/features/competitions/player-admission.test.ts
npm run typecheck
npm run lint
git diff --check
```

Las pruebas son de reglas puras. No requieren migraciones ni base de datos.
Este comando explícito no supone incorporación automática al pipeline de CI.
