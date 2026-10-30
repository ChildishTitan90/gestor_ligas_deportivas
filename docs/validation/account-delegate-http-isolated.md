# PDGLD-107 — Validación HTTP/SSR aislada

Fecha: 28 de octubre de 2026. Ejecución autorizada expresamente; sin staging,
commit ni push. Se conservó el trabajo de PDGLD-106.

```sh
npm run test:account-isolated -- --execute --run-id c3d52110-9e44-4472-aebc-500a02f72a12
```

## Resultados reales

| Orden | PostgreSQL | Imagen | SQL | Next HTTP/SSR | Resultado |
| --- | --- | --- | --- | --- | --- |
| 1 | 15 | postgres:15-bookworm | 127.0.0.1:55415 | 127.0.0.1:56515 | Aprobado |
| 2 | 17 | postgres:17-bookworm | 127.0.0.1:55417 | 127.0.0.1:56517 | Aprobado |

El proceso terminó con exit code 0. PostgreSQL 17 comenzó después de aprobar y
limpiar 15. No fue necesario modificar código, SQL o restricciones durante esta
ejecución. Se comprobó la versión mayor del servidor; no se inventa una versión
menor o digest de imagen que no se haya registrado.

La suite verificó contra Next y PostgreSQL reales:

- Login con fixtures sintéticos y navegación /accounts/new → /access.
- Opciones privadas/no-store; denegación anónima, sin permisos y con liga/club
  inconsistentes.
- Cargo obligatorio y rechazo de valores no admitidos, sin cargo implícito.
- Alta de PRIMARY y DEPUTY en el mismo club, con cargo persistido y fin abierto.
- Cambio obligatorio de contraseña, nueva sesión y presentación de Subdelegado.
- Cupos agotados y conflicto 409, sin residuos de cuenta, persona o auditoría.
- Opciones bloqueadas por legado y conflicto DELEGATE_LEGACY_OVERLAP.
- Presentación «Cargo no identificado» y conservación de NULL en el legado.
- Vigencias finitas, intervalos contiguos y rechazo de solapamientos/intervalos
  inválidos.
- Revocación de users CREATE efectiva en opciones y alta con la misma sesión;
  restauración del fixture exclusivamente dentro de la base temporal.

Los fixtures instalaron en la base temporal las concesiones reales del catálogo;
no se ejecutó ningún CLI de seeds ni se modificaron permisos en otros entornos.
Este recorrido HTTP/SSR complementa, no sustituye, las pruebas SQL de concurrencia
15/17 de PDGLD-106 y las pruebas sin base de interacción/selección.

## Aislamiento y limpieza confirmados

Bases temporales:

- PG15: pdgld48_test_c3d521109e444415 y pdgld106_model_c3d521109e444415.
- PG17: pdgld48_test_c3d521109e444417 y pdgld106_model_c3d521109e444417.

Se usaron contenedores/redes exclusivos y datos PostgreSQL en tmpfs. Next arrancó
desde copias privadas app-pg15/app-pg17 bajo el directorio de ejecución, sin copiar
.env ni su configuración habitual. No se accedió a gestor_ligas_dev o Supabase.
No se instaló ningún paquete ni se modificaron las migraciones compartidas.

Registro sin credenciales conservado:
`/private/tmp/pdgld106-c3d52110-9e44-4472-aebc-500a02f72a12/run.json`.
Ambas entradas muestran passed=true, cleaned=true, pending=false.

Después del cierre se comprobó independientemente:

- Docker inspect informa No such container para
  pdgld106-c3d52110-9e44-4472-aebc-500a02f72a12-pg15 y -pg17.
- Docker inspect informa network ... not found para las redes correspondientes
  -pg15-net y -pg17-net.
- No existen las copias app-pg15 ni app-pg17 del directorio de ejecución.
- lsof no devuelve listeners en 56515/56517.

El hijo completó eliminación de bases/cierre de clientes antes de salir con éxito;
la eliminación de contenedores descarta además todo su almacenamiento tmpfs.
Permanecen solo el registro local sin secretos y las imágenes en caché previstas.
No se detuvieron procesos ni eliminaron recursos ajenos.

## Alcance de esta ejecución histórica

No es una prueba gráfica en navegador: no acredita diseño visual, interacción de
teclado ni un recorrido de clics completo del formulario. Estos tienen cobertura
parcial de componentes/estado sin base y requieren revisión de UI. Tampoco se
aprovisionó ni validó Supabase Preview/RLS. La coordinación final con PDGLD-110 y
la revisión humana siguen abiertas; no se afirma que esté aprobado un merge.

## Actualización del 30 de octubre de 2026

El recorrido gráfico posterior `c2bf8520-6197-4fae-8a60-4b0e6d2b0729` y el
runtime Preview/RLS temporal `e8d3af10-f264-48b2-9fae-b90bb865630d` aprobaron en
PostgreSQL 15 y 17, con Turbopack e instalación independiente por copia y limpieza
verificada. Preview ejecutó nuevamente las aserciones de verifyAccountDelegateHTTP
con un runtime limitado; no fue Supabase real ni una repetición del perfil E2.

La [matriz](account-delegate-acceptance-matrix.md) separa resultados aprobados de
criterios de PDGLD-108 aún sin implementación/prueba y decisiones pendientes.
Las capturas, logs y registros originales permanecen en el archivo privado
fuera del repositorio. La revisión humana y CI remoto siguen sin acreditarse.
