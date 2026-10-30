# PDGLD-108 — Pruebas nuevas de reglas ya acordadas

Estado: **aprobadas en PostgreSQL 15 y 17, con limpieza verificada**,
run-id `8f6e123a-9241-4afc-a9ad-c8c91e3be7d2` (E6). No se han
implementado rutas de representantes, versión de user_roles, función SQL
privilegiada ni nuevas facultades. La
[propuesta de contrato](../architecture/representative-assignment-contract-draft.md)
permanece pendiente de validación.

## Nuevos casos y oráculos

Los casos viven en tests/integration/representative-agreed-rules.mjs y se llaman
al finalizar la verificación SQL existente de delegate-positions-migration.mjs.
Usan Prisma y los guards de servidor reales, con el cliente/adaptador ya instalado.
El worker de modelo carga la condición react-server; no inicia Next ni una sesión
HTTP. Sus fixtures solo usan concesiones CLUB_DELEGATE/clubs del catálogo vigente
en código, sin aliases ni overrides de facultades.

| Caso nuevo | Qué comprueba | Qué no acredita |
| --- | --- | --- |
| distinct-deputies-capacity | Dos cuentas y personas distintas; mismo club y periodos DEPUTY solapados; segundo INSERT rechaza 23P01/user_roles_delegate_position_overlap, sin asignación ni auditoría residual | Resultado de un servicio nuevo de reemplazo |
| authorization-inclusive-start-exclusive-end | assertPermission real para PRIMARY y DEPUTY: un microsegundo antes de inicio deniega; en inicio permite; un microsegundo antes del fin permite; en fin deniega | Paso del reloj de pared, recorrido HTTP/sesión o contrato de baja |
| representation-change-preserves-authorship | Para ambos cargos, cierre/alta SQL de fixture conserva solicitud requested_by, archivo uploaded_by/storage_key, referencias de firma/directivo y estado/versión de cuentas. Entrante tiene UPDATE propio como control positivo, pero no puede cargar corrección ajena; saliente cerrado tampoco. La descarga autorizada por READ funciona sin cambiar propietario; matchesSignatureBinding rechaza que el entrante presente esa firma como propia | Servicio autorizado de reemplazo, UI de corrección ni una ampliación de facultades |

El test de autoría no transfiere requested_by para forzar un rechazo: cambia las
asignaciones y compara los registros completos de solicitud, archivo y directivo
antes/después. La representación cambia mediante SQL **solo en el fixture**;
no se interpreta como implementación del contrato pendiente.

Para igualdad temporal exacta, authorization-clock.mjs sustituye únicamente las
llamadas clock_timestamp() en las consultas SQL emitidas por el autorizador durante
la prueba. Mantiene parámetros y ejecución PostgreSQL; no fabrica filas/permisos,
no replica el predicado y no altera código o funciones de producción. Se comprueba
que el reloj controlado fue utilizado. No depende de sleeps ni de llegar a una
fecha con precisión de microsegundos.

## Diferencia respecto de las aprobaciones existentes

- SQL E1, HTTP E2, navegador E4 y Preview E5 de la
  [matriz de aceptación](account-delegate-acceptance-matrix.md) conservan sus
  aprobaciones y su código de procedencia. Esos runs **no ejecutaron estos casos**.
- E6 repitió la suite SQL ya aprobada y añadió las tres regresiones. No
  repitió HTTP/SSR, navegador o Preview/RLS.
- test:ci ejecuta solo las pruebas puras del adaptador/guardas y runner, no estos
  nuevos casos de base. Sintaxis, imports sin servicios y lint tampoco los aprueban.
- evidence-pg15/17/agreed-rules.json contiene las tres etiquetas aprobadas.
  cleanup-verified.json acredita limpieza, puertos libres e integridad del proyecto.

## Ejecución aprobada — comandos históricos, ID consumido

```sh
npm run test:delegate-isolated -- --run-id 8f6e123a-9241-4afc-a9ad-c8c91e3be7d2
```

Comando con servicios autorizado y ejecutado:

```sh
npm run test:delegate-isolated -- --execute --run-id 8f6e123a-9241-4afc-a9ad-c8c91e3be7d2
```

Recursos: PostgreSQL 15 y luego 17, tmpfs, redes/contenedores exclusivos
pdgld106-8f6e123a-9241-4afc-a9ad-c8c91e3be7d2-pg15/17 y sufijo -net; publicaciones
solo 127.0.0.1:55415/55417. Bases padre pdgld48_test_8f6e123a92414a15/17 e interiores
pdgld106_model_8f6e123a92414a15/17. Se aplican SQL y fixtures únicamente ahí.
Puede descargar imágenes Docker ausentes; no instala paquetes ni ejecuta seeds.
No usa .env, gestor_ligas_dev, Supabase, Next, Chrome o Preview/RLS.

PG17 solo empieza tras aprobar y limpiar PG15. El verificador cierra Prisma/pg y
elimina su base interior; el worker elimina la padre; el supervisor verifica
identidad y elimina solo contenedor/red propios. Conserva run.json y evidencias
saneadas bajo /private/tmp/pdgld106-<run-id>. No hay montajes del repositorio,
volúmenes persistentes ni prune. Una caída abrupta requiere comprobar recursos y
procesos propios antes de afirmar limpieza.

## Resultados por regresión

| Regresión | PG15 | PG17 | Límite |
| --- | --- | --- | --- |
| Dos DEPUTY distintos | Aprobada | Aprobada | Cupo y ausencia de residuos SQL |
| Inicio incluido, fin excluido | Aprobada | Aprobada | Guards reales y reloj SQL controlado, ambos cargos |
| Autoría de solicitudes y firmas | Aprobada | Aprobada | Cambio de representantes por fixture SQL, ambos cargos; no servicio autorizado |

Limpieza de PG15 verificada antes de PG17; ambas limpias al terminar.
Verificación registrada: 2026-10-30T20:24:12.193Z. Evidencia privada duradera y
resumen saneado enlazados desde la matriz. No reutilizar este run-id.
