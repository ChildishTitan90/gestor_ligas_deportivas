# Bandeja de revisión de identidad — 04/11/2026

La ruta `/players/review` reutiliza el ManagementShell y sus temas. La página
de servidor delega en `review-workspace-queries.ts`; el componente interactivo
solo recibe casos previamente autorizados por los servicios existentes.

## Interacción

- Cuatro tarjetas seleccionables: todas, posibles coincidencias, INE y selfie,
  documentos y tutor. Los contadores representan casos de la colección completa
  autorizada, no personas únicas ni los resultados parciales del filtro.
- Búsqueda local por nombre, equipo, club, categoría o temporada, sin distinguir
  acentos. Filtros de club y temporada con SelectField. Limpiar filtros restablece
  la colección; no modifica documentos ni decisiones.
- Tabla en escritorio y tarjetas en móvil, con nombre del jugador, equipo, club,
  categoría, temporada, motivo y acción específica. Un jugador puede aparecer
  más de una vez si tiene distintos tipos de revisión pendientes.
- Actualizar bandeja vuelve a ejecutar las lecturas autorizadas del servidor,
  conserva filtros vigentes y muestra estado de consulta. Las opciones retiradas
  dejan de filtrar; no se selecciona otra automáticamente.
- Vacío sin pendientes distinto del vacío por búsqueda. Las explicaciones del
  proceso se pueden desplegar; resolver un caso no equivale a habilitar al jugador.

Se conservan las páginas y servicios de comparación, evidencias y revisión
documental, sus permisos READ/APPROVE y enlaces privados temporales. La bandeja
no agrega consultas a proveedores, acreditaciones ni activaciones automáticas.
No implementa las entregas pendientes de política documental o participación
superior de la sesión del profesor.

## Aviso pg en Jugadores

Se reprodujo en PostgreSQL temporal la condición de advertencia del driver:
las proyecciones de relaciones de Prisma generaban cinco superposiciones en el
catálogo y una en el listado sobre la conexión de una transacción. También
existía una proyección similar en el encabezado del expediente.

Los filtros de autorización siguen en Prisma y seleccionan IDs escalares. Una
consulta SQL parametrizada unida obtiene los campos visibles, dentro de la
misma transacción RepeatableRead del catálogo/listado. El encabezado reutiliza
la consulta de etiquetas después de autorizar READ. No se silencia la
advertencia ni se modifica pg o su adaptador.

El catálogo también rechaza explícitamente la ausencia de CREATE o READ,
evitando depender del tratamiento de OR vacíos por Prisma.

## Validación realizada

- `npm run test:player-registrations`: 36 pruebas aprobadas en PostgreSQL local
  desechable. Incluye condición real de la cola pg, permisos, etiquetas de casos,
  tutor, duplicados, concurrencia y regresiones de la primera entrega.
- `npm run test:player-workspace`: recorridos Chrome sintéticos de alta,
  expediente y bandeja. La nueva prueba verifica búsqueda, selección de tipo,
  filtros, destinos por jugador, teclado, refresco y vacíos.
- Componente con CSS de la aplicación compilado: capturas claro/oscuro,
  escritorio/móvil y sin desbordamiento horizontal. Es una prueba de componente
  con datos sintéticos, no un recorrido con sesión y backend reales.
- TypeScript y ESLint de los archivos afectados. Sin migraciones nuevas,
  consultas reales de CURP/INE, Storage ni cambios en Supabase o Jira.

## Revisión humana

1. Con Secretaría o Administración, abrir `/players/review`.
2. Seleccionar Documentos y tutor: cada pendiente debe mostrar el nombre del
   jugador y la acción Revisar documentos. Si no hay casos, comprobar el vacío.
3. Buscar un nombre y combinar club/temporada; limpiar y actualizar la bandeja.
4. Abrir el caso y comprobar que conduce al expediente correspondiente.
5. En `/players/registrations`, abrir Registrar jugador y consultar el listado:
   no debe aparecer la advertencia de consultas superpuestas de pg. No hace falta
   enviar el formulario ni gastar créditos para comprobar estas lecturas.
