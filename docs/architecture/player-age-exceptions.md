# PDGLD-104: petición y decisión de excepción de edad

## Regla y alcance

Conforme a la aclaración del equipo sobre PV-04, Secretaría acepta o rechaza.
Se exige el rol SECRETARY con players:APPROVE vigente en el contexto concreto;
no basta el nombre del rol ni combinar permisos globales con un cargo en otra liga.
El delegado necesita CREATE para capturar y UPDATE para presentar la petición.
Cada lectura, escritura, recuperación de acuse y enlace documental reautoriza.

La captura excepcional es una intención explícita (`requestAgeException`), válida
solo dentro del margen excepcional de la política aprobada. Sigue exigiendo
ventana semanal, identidad válida y contexto operativo. Crea un expediente
INELIGIBLE, sin consulta automática de CURP. Una edad ordinaria sigue el flujo
existente; una edad fuera del margen excepcional no permite esta captura.

El delegado confirma una Carta de excepción de edad privada del propio expediente
y presenta un motivo. La carta no sustituye el consentimiento del tutor.
Secretaría consulta esa evidencia y confirma aceptación o rechazo con motivo.
La aprobación resuelve exclusivamente el bloqueo de edad de la inscripción de
origen. No activa al jugador, no aprueba otros documentos ni acredita CURP,
tutela o participación adicional en otra categoría. Las comprobaciones restantes
siguen en la evaluación de elegibilidad y el flujo de aprobación administrativa.

## Persistencia y concurrencia

Se reutilizan los campos existentes de player_registrations y audit_logs.
Los eventos CAPTURED, REQUESTED y DECIDED conservan la intención, versiones,
motivos, actores y acuses. No se añaden tablas ni se editan migraciones aplicadas.
La nueva migración incorpora AGE_EXCEPTION_LETTER y un trigger que impide
escribir los campos de autorización sin un acuse de decisión correspondiente.
La autoridad de Secretaría se valida en la capa de servicio; el trigger no
sustituye RBAC ni protege frente al propietario privilegiado de la base.

La vinculación incluye inscripción, categoría, política, identidad, nacimiento
y archivo confirmado (identificador, hash y tamaño). Cambiarlos invalida la
aprobación para la evaluación posterior. Reemplazar la carta exige una nueva
petición. No se interpreta un archivo VALIDATED aislado como aprobación de edad.
Los documentos de excepción se retiran de la aprobación documental genérica.

Las escrituras bloquean inscripción e identidad y leen la política bajo bloqueo.
La versión/fingerprint enviada por el cliente se compara con el estado actual.
Una clave de operación recupera únicamente el mismo cuerpo confirmado; reutilizarla
con otros datos falla. Dos decisiones sobre la misma petición no se sobrescriben.
La autorización se comprueba también al recuperar un envío anterior.

## Contratos y privacidad

GET /api/player-registrations/[id]/age-exception consulta estado o recupera un
acuse con operationKey. POST recibe REQUEST o DECIDE, contratos Zod estrictos,
con identidad de sesión, comprobación de origen y límite de cuerpo.
La respuesta devuelve el estado mínimo de presentación, sin rutas de storage.
La carta usa el expediente, carga confirmada y visor temporal privados existentes.
La bandeja de revisión añade Excepciones de edad sin alterar los otros filtros.

## Comprobación y pendientes

Consultar docs/validation/player-age-exceptions.md para distinguir ejecución
local con datos sintéticos de PostgreSQL 15 y aceptación humana pendientes.
No se consultan proveedores CURP/INE reales desde pruebas automatizadas.
Ventanas por fase/horas y aceptación completa de PDGLD-15 quedan fuera de esta entrega.
