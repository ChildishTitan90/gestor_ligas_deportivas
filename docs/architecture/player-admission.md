# PDGLD-103: edad y días de alta

## Reglas compartidas

`evaluatePlayerMovement` compone las funciones vigentes de `player-policy.ts`.
REGISTER recibe política, nacimiento y reloj explícito; devuelve todos los
bloqueos de edad y día. Revalida el esquema y rechaza fechas inválidas/futuras.
La edad es año de referencia menos año de nacimiento; los extremos son
inclusivos y el máximo puede ser nulo. Usa registrationDays y timezone de la
categoría. Para Morelia el criterio lunes a miércoles corresponde a [1,2,3]
y America/Mexico_City, sin imponer esa configuración a otras ligas.

Una edad excepcional devuelve AGE_EXCEPTION_REQUIRED: una carta por sí sola
no aprueba un alta. WITHDRAW omite estas restricciones de alta; no concede
permisos ni omite las demás condiciones de baja. RULES_SATISFIED no constituye
autorización, aprobación documental o habilitación deportiva.

## Integración al registro

Base examinada: develop 53c2628, con PDGLD-13/14 integrado. El servicio conserva
la autorización y los bloqueos de contexto, Persona e identidad existentes.
Un reintento válido recupera la inscripción antes de comprobar la ventana,
sin nuevas escrituras; sigue exigiendo permiso y datos de identidad coincidentes.
Para altas nuevas, readPlayerPolicy bloquea temporada y categoría y lee la
política vigente dentro de la misma transacción. El reloj se obtiene de
player_participation_now(), la función SQL existente que en producción usa now().
El navegador no puede enviar política, reloj o aprobación dentro del contrato.

Un bloqueo revierte toda la transacción, incluida una Persona creada, su evento
de auditoría y los registros dependientes. Los errores se traducen a códigos y
mensajes seguros en player-feedback.ts, sin devolver SQL o datos personales.
Los estados iniciales y la verificación documental/CURP existentes se conservan.

## Migración aditiva

20261106010000_pdgld103_registration_window_policy reemplaza únicamente el cuerpo
de validate_player_registration. Su trigger conserva identidad, INSERT/UPDATE y
las protecciones de CURP, pertenencia inmutable y cambio de equipo tras iniciar
la competencia. En INSERT consulta días/zona de la categoría con FOR SHARE,
rechaza política pendiente o ventana inválida y comparte el reloj SQL del servicio.
La edad se comprueba en el servicio con las reglas compartidas; el trigger
protege la ventana también ante una escritura directa. UPDATE no hereda la
ventana de altas. No modifica datos históricos, RLS, tablas ni migraciones previas.
No cambia la ventana del trámite separado de participación adicional en categorías.

## Verificación y límites

```powershell
node --import tsx --test src/features/competitions/player-policy.test.ts src/features/competitions/player-admission.test.ts
npm run typecheck
npm run lint
npm run test:player-registrations
git diff --check
```

El runner de jugadores aplica las migraciones en PostgreSQL temporal; los siete
casos nuevos se incorporan a esa suite. El fixture ahora declara su política
sintética y el reloj SQL compartido. No configuran categorías reales. Cubren
edad ordinaria/excepcional, rollback, política pendiente, ámbito ajeno, cambio
de día/zona, recuperación idempotente, payload forjado y escritura directa SQL.

Durante la preparación: 15 pruebas puras aprobadas; sintaxis TypeScript revisada;
19 comprobaciones del SQL aprobadas en PGlite con esquema mínimo sintético.
Eso no equivale a ejecutar Prisma, PostgreSQL 15, HTTP o la suite completa.
Typecheck, lint y regresión de jugadores deben confirmarse en el proyecto antes
de aplicar la migración a gestor_ligas_dev. No se consultaron proveedores reales.

Quedan pendientes ventanas por fase/horas no representadas en el esquema actual,
el flujo de excepción con autoridad/evidencia acordada en PV-04, revisión de UI y
aceptación integral de PDGLD-15. No se inventan fechas ni horarios históricos.
Las políticas pendientes siguen bloqueando altas; requieren configuración por
el flujo autorizado, no un backfill que las habilite automáticamente.
