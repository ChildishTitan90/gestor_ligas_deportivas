# Secretaría y temporadas (PDGLD-38)

La ampliación autorizada agrega `competitions:CREATE` y `competitions:UPDATE` a SECRETARY. Es una ampliación posterior a RF22; el catálogo original conserva la matriz aprobada. Los controles del servidor siguen comprobando la liga de cada asignación: una asignación a una liga no permite gestionar otra.

En desarrollo local, después de integrar estos cambios, ejecutar `npm run seed:dev`. La instalación de permisos también incorpora esta ampliación. Se registra un marcador de auditoría independiente y se ejecuta dentro de la transacción y bloqueo existentes. Si las concesiones ya estaban presentes, se conservan. Las ejecuciones posteriores no restauran permisos retirados después de instalar la ampliación.

Esto no crea asignaciones globales ni concede administración de cuentas. El permiso `clubs:CREATE` de Secretaría ya figura en RF22; la creación e inscripción de equipos conserva los controles de ámbito y afiliación aprobada. Crear ligas sigue requiriendo una asignación global autorizada.

Los comandos de seed validan un destino local. Para un entorno remoto, coordinar una aplicación administrativa autorizada equivalente; no ejecutar estos seeds contra producción ni copiar credenciales al repositorio.
