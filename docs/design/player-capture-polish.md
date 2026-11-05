# PDGLD-13/14 — Pulido de captura y revisión, 04/11/2026

## Evidencia y cambios

Se revisaron 16 fotogramas distribuidos a lo largo de los 300 segundos del video privado proporcionado por Víctor. No se transcribió audio ni se copiaron imágenes personales al repositorio. Se observó guía separada muy grande, marco vertical para INE, fondo excesivo en la captura y resultado del envío fuera de la vista.

- La INE utiliza una superficie horizontal (1.586), video centrado con object-fit:cover y guía con margen del 6%. El archivo usa el mismo rectángulo fuente del marco. Se debe dejar margen alrededor de los cuatro bordes. No se promete detección automática, nitidez ni validación local de identidad.
- Selfie y foto del jugador usan retrato 3:4. La vista previa permite comprobar la captura antes de enviarla. Las alternativas de archivos y la liberación de la cámara al cambiar de paso siguen vigentes.
- Se retiró la ilustración grande para priorizar cámara y controles. El resultado tiene región identificada, mensajes de estado y foco al concluir. Una consulta con acuse conserva su resultado; preparar nuevas fotos es una acción explícita que descarta la selección anterior. Incertidumbre conserva el bloqueo de reenvío.
- La revisión documental identifica jugador, equipo, categoría y temporada. Sus tarjetas y selectores muestran estados en español. La información del tutor aparece al revisar su autorización. El acceso deportivo es secundario y está al final, separado de la revisión de archivos.
- Se conserva ManagementShell, ActionLink, SelectField, temas y permisos existentes. No se modifican proveedor, costos, reglas deportivas ni autorización del tutor.

## Skills consultadas

Se consultó el router de ui-skills@0.2.4 desde la caché descargada por el usuario; categorías y lista de accesibilidad. Se aplicaron de forma selectiva [baseline-ui](https://github.com/ibelick/ui-skills/blob/main/skills/baseline-ui/SKILL.md) y [fixing-accessibility](https://github.com/ibelick/ui-skills/blob/main/skills/fixing-accessibility/SKILL.md). Prevalecen los componentes y convenciones del proyecto; no se instalaron paquetes UI ni se migraron primitivas.

## Verificación

- TypeScript sin emisión y ESLint: aprobados. TypeScript excluye .worktrees para no analizar checkouts independientes.
- Dos pruebas puras comprueban rectángulos centrados, proporción horizontal sobre video vertical, retrato y dimensiones inválidas. Se incorporaron a test:player-dossier.
- Chrome: INE con cámara simulada, permisos denegados y tardíos, cambio de paso, envío único, incertidumbre y consulta sin cargo; aprobado. Incluye CSS real de cámara y comprueba dimensiones del JPEG capturado.
- Chrome: registro/revisión de tutor y carga/sustitución del expediente; aprobados en ejecución secuencial. La primera ejecución paralela tuvo fallos de limpieza EBUSY de Chrome en Windows; la secuencial pasó.
- No se consultaron CURP/INE reales ni Storage. Falta validación manual en cámara física, teléfono y orientaciones reales; esta revisión no acredita esa prueba ni una auditoría completa con lector de pantalla.

## Prueba manual

1. Recargar el expediente de un jugador aplicable a la verificación INE. No registrar otra persona para probar este ajuste.
2. Activar cámara: comprobar marco horizontal, mantener toda la INE dentro del margen y tomar la foto. Revisar que el archivo corresponda al marco; repetir si falta un borde.
3. Continuar al reverso, luego selfie. Probar también denegar permiso y elegir un archivo.
4. Revisar las tres imágenes. Para verificar solo interfaz, detenerse antes del envío final: este sí consume una consulta real cuando lo confirma un humano.
5. Revisar un expediente como Secretaría: comprobar nombre/equipo, abrir documento y registrar revisión. El acceso al estado deportivo aparece después de este recorrido.

Sin commit, push, Jira ni despliegue. Develop remoto se comprobó sin nuevos commits respecto a la base de este ajuste.


## Ajuste posterior: consulta privada y guías recuperadas

Por revisión de Víctor se recuperó la tarjeta animada frente/reverso y la guía de selfie en formato compacto. Conserva la transición y movimiento reducido existentes. El video está posicionado dentro del marco para que su tamaño intrínseco vertical no fuerce la altura del contenedor: se comprueba el rectángulo real del viewport móvil en Chrome. INE mantiene 1.586; selfie usa 4:5 con margen del 8%, guía de rostro y apenas inicio de hombros. No hay detección facial ni recorte automático por rasgos.

La consulta desde expediente, revisión administrativa y evidencias INE abre un visor modal compartido. Reutiliza FormDialog (foco, Escape, retorno al control y fondo inerte) y conserva el comportamiento temporal del visor de firmas de Karol. El visor de firmas no fue sustituido. Se incluye ampliación de imagen y PDF embebido. Los endpoints existentes autorizan como antes y ahora devuelven MIME de servidor; no se duplica el servicio de acceso ni se alteran permisos.

El visor obtiene el archivo autorizado con caché no-store y credenciales omitidas hacia Storage, y presenta un blob efímero. No navega al enlace de descarga ni inicia guardado automático. El acceso visible vence como máximo en 60 segundos desde solicitar autorización; se revoca el blob al cerrar, desmontar, cambiar de documento o vencer. No se persisten archivos en localStorage/IndexedDB. Esto no impide capturas de pantalla, guardado manual o controles propios del visor PDF del navegador. Si el navegador no soporta PDF embebido se explica esa limitación; no se fuerza una descarga como alternativa automática.

Validación: 44 pruebas PostgreSQL aislado aprobadas; suite de firmas y recorridos existentes Chrome aprobados; nueva prueba Chrome de visor cubre imagen, iframe PDF, ampliación, Escape/foco, revocación, vencimiento y autorización denegada sin solicitar bytes. La prueba del iframe acredita integración, no lectura visual de un PDF multipágina en todos los teléfonos. Tres pruebas puras de encuadre aprobadas. Se incorporó visor a test:player-workspace. No hubo operaciones contra Supabase ni APIs reales de identidad. Pendiente comprobación humana de cámara física y PDF nativo en el celular.


## Confirmación de captura y verificación final

El recorrido conserva frente, reverso y selfie. Al tomar o seleccionar una foto aparecen borde verde, check y texto que distingue captura/selección de verificación de identidad. Los pasos muestran qué fotos están listas; Continuar conserva revisión humana y activa el giro de la guía. La animación del check dura 180 ms y se desactiva con movimiento reducido. No hay reconocimiento automático de credencial ni evaluación de nitidez durante el encuadre.

La acción final es Verificar identidad con explicación del envío de las tres fotos al servicio. Se retiró la casilla de tokens/saldo: pulsar el botón es la confirmación explícita del envío; el contrato interno acknowledgeCharge sigue vigente. Una nueva consulta tras un resultado anterior requiere confirmar esa intención y conserva retryOf/acknowledgePossiblePreviousCharge. Actualizar resultado solo consulta el acuse y no envía fotos ni consume otra verificación. El bloqueo de incertidumbre y de doble envío permanece.

Chrome sintético comprobó feedback sin invocar proveedor, avance/giro y foco, ausencia de la casilla técnica, envío explícito único, bloqueo tras respuesta perdida, consulta sin reenviar y confirmación separada de una nueva solicitud. TypeScript y lint aprobados. No se ejecutaron consultas reales de CURP/INE.

## Ajustes finales del 05/11/2026

La selfie usa guía 4:5 cerrada y la foto del jugador conserva 3:4. Se restauró la ilustración compacta animada frente/reverso/selfie. Se retiró la tarjeta de prueba y las excepciones de escenario de los servicios; la configuración del entorno sintético queda en scripts y base local.

Una INE favorable y cotejada satisface automáticamente identificación compatible, con fotos en consulta privada y sin segunda carga ni revisión de identidad. No satisface nacimiento, escuela o consentimiento. CURP verificada y constancia PDF se muestran como hechos distintos; no se solicitó el PDF de costo adicional.

El PDF de firma incluye nombre de jugador y UUID. La revisión limpia su captura solo tras un acuse válido, conserva la misma intención si hay incertidumbre y permite refrescar documentos si falla el GET posterior.
