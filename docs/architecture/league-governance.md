# PDGLD-37 · Órganos y cargos de la Liga

En **Administración → Órganos y cargos**, selecciona la liga. La pantalla
registra los tres órganos institucionales que falten: Asamblea General,
Consejo Directivo y Comité Ejecutivo. Registra los cargos por órgano con el
nombre aprobado por la Liga. El rol del cargo es una referencia a un rol
existente. La autorización sigue evaluando asignaciones en `user_roles`.

Busca a una persona existente por nombre o apellido. La selección muestra
personas con relación registrada en la liga mediante asignación de cuenta,
registro deportivo, directiva de club o nombramiento previo. Un registro sin
vínculo acreditado en la liga queda fuera de la selección. La pantalla muestra
solo el nombre para identificar candidatos, y el servidor comprueba nuevamente
la relación antes de crear el nombramiento.

Las fechas son días calendario en la zona de la liga. La fecha final es
inclusiva. La composición se filtra por liga, órgano y estado del periodo.
Para finalizar, registra el último día de vigencia y el motivo. Una
finalización conserva el registro, y la auditoría incluye la fecha anterior,
la nueva, el actor, la hora y el motivo. PostgreSQL impide borrar un
nombramiento, cambiar su identidad/cargo/inicio o ampliar su final.

RF22 usa los permisos existentes `users:READ` y `users:UPDATE` para la liga.
Se verifica el ámbito real del recurso y se usa una actualización condicional
para detectar una finalización concurrente. El motivo debe describir el cambio
administrativo y mantenerse libre de datos personales o referencias a
documentación privada.

La Liga todavía debe confirmar el catálogo de cargos y las reglas de
simultaneidad. La implementación admite cargos definidos por la persona
autorizada y periodos concurrentes, sin sustitución automática. El esquema
conserva la referencia opcional a documentación privada ya existente. Esta
pantalla opera con el motivo administrativo y las fechas.

## Verificación local

Aplica las migraciones y la matriz de permisos en un PostgreSQL desechable
en `127.0.0.1:55437/pdgld37`. Configura `DATABASE_URL` y ejecuta
`node --conditions=react-server --import tsx --test tests/integration/league-governance.test.ts`.
La prueba utiliza personas sintéticas y verifica el registro, la vigencia,
la auditoría, el aislamiento por liga y la separación entre cargo y permiso.
