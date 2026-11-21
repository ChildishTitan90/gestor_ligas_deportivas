# Vista previa offline de la cédula · PDGLD-19/20

La vista previa usa la estructura de gestión, las tarjetas de Mis partidos y el
mismo espacio de captura de la cédula. Solo se sirve en desarrollo con una
sesión activa. La preparación, el guardado local y los acuses son simulados.
Los cambios viven en la página y se pierden al recargar o abandonar la vista.
Usa únicamente datos y firmas sintéticos.

## Abrir la vista

Con una sesión local activa, abre `/matches/offline-preview`. Para iniciar un
entorno aislado, ejecuta `npm run match-reports:local` con Docker activo, abre
`http://127.0.0.1:3198/matches/offline-preview` e inicia sesión como
`arbitro@example.test` con la clave sintética `Arbitraje-Local-141!`. Mantén el
proceso abierto durante la revisión. Para probar el tamaño móvil en ese entorno,
activa la vista adaptable del navegador de escritorio.

| Ruta | Escenario |
| --- | --- |
| `/matches/offline-preview?case=prepare` | Preparar el partido y abrirlo cuando termine. |
| `/matches/offline-preview?case=incomplete` | La primera descarga queda incompleta. El reintento termina la preparación. |
| `/matches/offline-preview?case=space` | La primera descarga falla por falta de espacio. El reintento simula que se liberó espacio. |
| `/matches/offline-preview/demo-018?case=ready` | Abrir la ficha del partido y entrar a la captura. |
| `/matches/offline-preview/demo-018?case=offline` | Retomar un borrador sin red y seguir editándolo. |
| `/matches/offline-preview/demo-018?case=pending` | Hay conexión y un borrador en espera de sincronización manual. |
| `/matches/offline-preview/demo-018?case=storage` | El guardado del borrador falla por falta de espacio. El reintento simula que se liberó espacio. |
| `/matches/offline-preview/demo-018?case=session` | Renovar la sesión simulada y sincronizar el mismo borrador. |
| `/matches/offline-preview/demo-018?case=conflict` | Comparar la captura con la referencia y conservar el borrador actual. |
| `/matches/offline-preview/demo-018?case=uncertain` | Consultar el resultado y reenviar la misma operación si la consulta simulada devuelve que no se aplicó. |
| `/matches/offline-preview/demo-018?case=receipt` | Ver el acuse de borrador y comprobar que la cédula sigue abierta. |
| `/matches/offline-preview/demo-018?case=confirmed` | Ver la confirmación oficial simulada y la vista de solo consulta. |

## Recorrido de cinco minutos

1. En escritorio, abre el listado y pulsa **Preparar para usar sin conexión**.
   Cuando aparezca **Disponible sin conexión · Simulación**, abre la cédula.
2. Activa la vista móvil a 390 px y entra a **Capturar cédula**. Pulsa
   **Simular pérdida de red**. En **Cierre y firmas**, escribe una observación
   de ejemplo y observa cómo el estado pasa de guardando a guardado en este
   dispositivo.
3. Pulsa **Volver a la ficha del partido** y luego **Retomar borrador de
   ejemplo**. Comprueba el folio, la versión y la observación. Pulsa **Simular
   regreso de red** y luego **Sincronizar borrador**. Verifica el acuse y que
   la cédula siga como borrador.
4. Regresa al índice y abre **Conflicto de versiones**. Abre la comparación
   con el teclado y ciérrala con Escape. En **Respuesta del servidor perdida**,
   usa **Simular consulta: no aplicada** y **Reintentar misma operación simulada**.
5. Abre **Confirmación oficial simulada** y compara la vista de consulta con el
   acuse del borrador. Cambia al tema oscuro desde el menú de cuenta.
