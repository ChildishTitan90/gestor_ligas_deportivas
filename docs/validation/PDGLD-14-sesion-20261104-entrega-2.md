# PDGLD-13/14 — segunda entrega de la sesión 04/11/2026

Primera entrega revisada por Víctor. Esta entrega completa el contrato de política
documental y su evaluación de habilitación; no completa las pantallas de familias,
participaciones ni edición documental de la entrega 3. No cierra ambas historias.

Diseño: [política documental](../architecture/player-category-document-policy.md)
y [activación adulta](../architecture/player-automatic-activation.md).

## Qué comprobar

Desde la carpeta del proyecto:

```powershell
npm run test:player-dossier
npm run test:player-registrations
npm run test:player-workspace
```

El runner crea PostgreSQL local desechable y aplica las migraciones ahí. Las
variables de proveedor real se vacían. Las políticas aprobadas y los documentos
son sintéticos: no equivalen a decisiones de la liga. No se escribe en Supabase
ni se consume CURP/INE. Las pruebas nuevas generan un PDF en memoria y registros
de archivos en esa base temporal; no crean objetos remotos ni incorporan
limpieza automática de Storage.

Resultados esperados de los casos nuevos:

1. Crear/editar política requiere permisos y versión. El delegado no puede
   hacerlo. Las inscripciones por grupo también protegen los criterios ya usados.
2. Adulto con política explícita: CURP verificada puede habilitar sin su archivo,
   conservando `dossierComplete: false` y `eligibilityDocumentsComplete: true`.
   La identificación oficial opcional no bloquea, y una licencia puede recibirse
   con la misma intención y recuperarse sin volver a leer Storage.
3. Identificación obligatoria: el jugador continúa pendiente al verificar CURP
   y al recibir un pasaporte. Hace falta aprobación administrativa. Una sanción
   vigente también impide activar. La reevaluación posterior es local, sin nueva
   consulta. Al aprobar la constancia pendiente puede completarse el expediente.
4. Menor: una constancia escolar aprobada cubre la alternativa, pero no acredita
   al tutor ni resuelve nacimiento. El perfil infantil explícito con comprobantes
   pendientes permanece en borrador y no exige un acta por defecto. La aprobación
   ficticia del comprobante en el test no configura categorías reales.
5. Si Administración cambia solo documentos durante una confirmación pendiente,
   la segunda autorización rechaza la huella anterior sin asociar archivos. No se
   alteran edades/cupos/ventana ni se modifican retroactivamente jugadores activos.

## Chrome

Se reprodujo el fallo al abrir Club/Temporada/Equipo: `dialog.open` se volvía
verdadero antes de que el requestAnimationFrame de FormDialog estableciera el
foco seguro. La prueba abría opciones antes y ese foco inicial las cerraba.

La prueba espera el foco inicial y enfoca el combobox antes de abrirlo. No se
subió el timeout, no se omitieron aserciones ni se agregó reintento de acciones.
El caso aislado pasó tres ejecuciones consecutivas; el perfil completo de tres
recorridos también pasó. En Windows, el control anterior de competencias requiere
`CHROME_BIN` apuntando al Chrome instalado.

## Validación ejecutada

- Jugadores/documentos y regresiones de origen/participaciones: 41/41 en
  PostgreSQL temporal. El reloj de vigencia de sanciones se adelanta solo en esa
  base y se restaura; no se modifica el historial inmutable de sanciones.
- Identidad documental/recuperación/política pura: 14/14.
- Competencias: 3 reglas puras y 58 comprobaciones HTTP/base, aprobadas.
- Workspace en Chrome: 3/3, con respuestas sintéticas.
- Control de migraciones y planes/privilegios: 13/13. Migraciones anteriores intactas.
- TypeScript y ESLint de los archivos afectados. Prisma y migraciones coinciden
  en las bases temporales. No se declara validación contra proveedores o Storage
  reales, ni aceptación humana completa desde el celular.

## Entorno habitual y pendientes

La migración de catálogo `20261104030000_pdgld14_document_policy_types` agrega
licencia, pasaporte y acta como tipos disponibles, sin imponerlos. No se aplicó
al Docker habitual ni a Supabase. No se aprobaron políticas reales.

35 frente a 37 para Veteranos, comprobantes de nacimiento aceptados y alcance de
firma adulta siguen pendientes. Se conserva autorización del tutor y carga
documental mientras el expediente esté pendiente; alta de jugadores lunes–miércoles.
Responsables del club y arbitraje siguen fuera de estas historias.

Como atención adicional al problema mostrado por Víctor, se verificó su Docker
`gestor_ligas_dev`: demo-secretario estaba activo con Secretaría vigente por liga,
pero faltaban las dos extensiones de permisos. Se ejecutó `npm run seed:dev` y
se comprobaron CREATE/READ/UPDATE de competencias. El seed conservó datos y
revocaciones. Crear una liga exige asignación global; no se amplió su alcance.

Sin commit, push, merge, despliegue ni cambios de estado en Jira. El CI remoto
todavía no acredita estos cambios locales sin commit.
