# INE y selfie para Veteranos

Entrega local del 1 de noviembre de 2026. Continúa el registro y el expediente existentes; PDGLD-13 conserva su estado de pruebas. Sin migraciones nuevas, cambios remotos ni aprobación deportiva.

## Contrato externo y alcance

Se utiliza POST `https://api.verificamex.com/identity/v2/validations/basic` con Bearer privado `VMX_API_KEY`, frente/reverso/selfie como data URLs y `qr_validation:false`. Se eligió V2 para integración nueva conforme a la documentación oficial. El proveedor documenta OCR, comparación facial, Lista Nominal y RENAPO. No se añaden llamadas separadas a comparación facial o CURP por esta operación.

Fuentes consultadas el 1/11/2026:

- [Contrato V2 y costo publicado](https://identity.docs.verificamex.com/ine-validation/complete-validation-v2/): 20 tokens con selfie, sin QR; verificar costo/saldo con el proveedor antes de la prueba humana. No asumir 3 tokens por esta operación.
- [Respuesta detallada V1 compartida por V2](https://identity.docs.verificamex.com/ine-validation/complete-validation/).
- [Comparación facial independiente](https://identity.docs.verificamex.com/ine-validation/compare-face/): es otro servicio; no se ejecuta adicionalmente.

El adaptador obtiene `PROVIDER_PASSED` únicamente de `data.object=ine_validations` y `data.status=true`; es un resultado intermedio, no identidad verificada. El servicio coteja los cinco datos contra la identidad del servidor capturada bajo lock: CURP, nombres, apellido paterno, materno y nacimiento. Solo igualdad completa produce `IDENTITY_VERIFIED`. No se inventan umbrales faciales ni códigos para subvalidaciones. Una respuesta negativa o incompleta genera `ADMIN_REVIEW_REQUIRED`; no rechaza al jugador. JSON ilegible o respuesta interrumpida conserva incertidumbre. HTTP 200 por sí solo no basta.

Se leen exclusivamente entradas de `documentInformation.documentData`: Name, FatherSurname, MotherSurname y DateOfBirth de OCR/MRZ; PersonalNumber de OCR para CURP. PersonalNumber de MRZ es otro identificador y no se usa como CURP. Nacimiento exige DD/MM/AAAA válido según el contrato documentado; no se infiere siglo desde `dataOcr.date_birth` de seis dígitos ni se divide FullName para adivinar apellidos. Las lecturas conocidas de un mismo campo deben coincidir todas con el registro. Ausencia, formato inválido o lecturas contradictorias requieren administración. Si se informan documentVerifications, solo se aceptan result=Ok/resultCode=0; un fallo o código desconocido impide la verificación automática, aunque el dictamen global sea favorable.

Nombres: comparación exacta normalizando mayúsculas, acentos y espacios, conservando Ñ distinta de N, separadores y orden. Sin coincidencia aproximada ni corrección de nombres o CURP. CURP completa con estructura/dígito y nacimiento concordantes. Si el registro no tiene apellido materno, exige una lectura explícitamente vacía; ausencia del campo no acredita que no exista apellido. Estas reglas conservadoras pueden enviar imágenes válidas a revisión; no se inventan valores para aprobarlas.

La auditoría guarda matchingVersion=1 y únicamente nombres de campos faltantes/diferentes, sin sus valores. Los datos extraídos se mantienen transitoriamente en servidor para el cotejo; no se envían al navegador ni se guardan completos en logs. Un cambio de identity_version o contexto invalida el acuse como STALE. Resultados anteriores PROVIDER_PASSED sin cotejo permanecen en revisión; nunca se promueven ni vuelven a consultar automáticamente.

La condición es `season_categories.type=VETERANS`, nunca el nombre visible ni una edad mínima inventada. La interfaz conserva el shell y tokens existentes; el panel aparece al final del expediente. Solo operadores con UPDATE y READ dentro del alcance pueden consultar al proveedor. Secretaría con APPROVE/READ ve la bandeja y evidencia, sin requerir UPDATE ni poder consumir créditos por ese solo permiso.

## Permisos, evidencia y operaciones inciertas

- GET `/api/player-registrations/{id}/ine-verification?attemptId={opcional}`: acuse local autorizado, sin proveedor ni Storage. Sin parámetro consulta el intento más reciente del registro, incluso después de recargar.
- POST a la misma ruta: multipart con `intent` JSON y archivos `front`, `back`, `selfie`. Se autentica, verifica origen/actor y autoriza antes de leer cuerpo; límite total de 30 MiB más 16 KiB de envoltura y 10 MiB por imagen. PNG/JPEG reales validados con la validación binaria compartida, no por extensión.
- POST `.../ine-verification/evidence`: JSON `{attemptId,part}`; autoriza antes de Storage, comprueba hash/tamaño y reautoriza antes de devolver URL privada de 60 segundos.

Intención explícita: `operationKey`, `identityVersion`, `acknowledgeCharge:true`, `retryOf:null|uuid` y `acknowledgePossiblePreviousCharge`. Identidad/alcance vienen del servidor. Una clave repetida con los mismos bytes devuelve acuse sin subir ni consultar otra vez; bytes distintos con la misma clave generan conflicto. Un intento nuevo tras un resultado requiere referenciar el último y reconocer posible cobro anterior. PENDING e IDENTITY_VERIFIED no admiten otro cobro para ese contexto. Tras cambios de identidad/contexto el resultado es STALE, no vigente.

La cuota técnica inicial es dos intenciones globales y una por operador al día civil de Ciudad de México. Se arbitra en PostgreSQL mediante lock de transacción y auditoría persistente. Es un límite técnico conservador, independiente de las cuotas de CURP y del precio del proveedor; cuenta incluso intentos que fallan antes de la red. Las pruebas aisladas inyectan límites propios.

Eventos inmutables `PLAYER_INE_PREPARED` y `PLAYER_INE_RESULT` en `audit_logs`, IDs deterministas, contienen versiones, huellas, tamaños, MIME y dictamen mínimo. Se reutilizan permisos ya existentes; no se requieren columnas nuevas ni UPDATE de auditoría. No se guardan OCR, dirección, respuestas crudas, nombres de archivo, base64, secretos ni URL de certificado. El certificado externo no se descarga ni se presenta como conservado.

Antes de llamar al proveedor se resguardan las tres imágenes en el bucket privado existente. Rutas de servidor `player-documents/v1/{liga}/{temporada}/{registro}/{purposeUuid}/{attemptId}`, con UUID fijo por propósito frente/reverso/selfie. Sin upsert, sin nombres originales ni entradas de ruta del cliente. Son evidencia separada: no crean `player_documents`, no satisfacen requisitos CURP/INE/tutor/credencial estudiantil ni acreditan consentimiento. Se mantienen las políticas documentales existentes.

La transacción termina antes de Storage y proveedor; se reautoriza tras Storage, justo antes de consultar, y al responder. El acuse se conserva aunque se revoquen permisos durante la red, pero no se devuelve a ese usuario. Un corte antes de guardar resultado deja PENDING; tras dos minutos se informa UNCERTAIN. El intento nunca se reejecuta automáticamente, ni con la misma clave. La interfaz bloquea otro envío ante una respuesta incierta y ofrece consultar acuse. Al recargar deben consultar ese acuse antes de preparar otra consulta. No se persisten imágenes en navegador y no se afirma borrador guardado.

Puede quedar evidencia parcial/huérfana si falla Storage, la autorización o el proceso. No existe limpieza automática: la auditoría identifica intento, propósitos y huellas; reconstruir la ruta desde esos datos para una revisión autorizada. No borrar ni sobrescribir para resolver incertidumbre. No se crearon objetos remotos durante esta entrega.

La bandeja `/players/review` añade INE sin cambiar la revisión de posibles duplicados. Muestra casos no verificados, con diferencias, datos incompletos o incertidumbre dentro del alcance APPROVE/READ y enlaza expediente/evidencia. IDENTITY_VERIFIED sale de la bandeja de INE; la revisión independiente de posibles duplicados de PDGLD-13 permanece intacta. La decisión administrativa formal para casos dudosos, retención de evidencia y resolución de casos permanecen pendientes. `approvalAllowed` siempre es false: el cotejo no valida documentos ni activa la inscripción. Subir GUARDIAN_CONSENT sigue sin acreditar tutor ni autorizar participación.

## Comprobación humana

1. Iniciar Docker y aplicación con la configuración local de pruebas. Registrar en lunes–miércoles un jugador en equipo afiliado e inscrito en una categoría cuyo tipo real sea VETERANS. No basta renombrar una categoría OPEN.
2. Entrar como delegado a Jugadores → Expediente documental; al final aparece INE y selfie. Consultar primero el acuse sin gastar créditos.
3. Seleccionar frente, reverso y selfie PNG/JPEG; confirmar envío al proveedor y consumo publicado. Comprobar previamente saldo/costo. Solo Víctor o compañeros pueden pulsar la consulta real.
4. Esperar el dictamen y consultar acuse. Reconsultarlo no debe consumir créditos. Si la red se corta, no iniciar otra intención sin revisar el acuse y aceptar un eventual cobro adicional.
5. Comprobar el acuse: resultado favorable con los cinco datos coincidentes muestra Identidad verificada; la inscripción sigue pendiente de requisitos documentales/deportivos. Con diferencias o datos incompletos, Secretaría ve el caso en Revisión de identidad → INE; puede consultar expediente y enlaces privados. Nunca se rechaza automáticamente al jugador.
6. Con delegado ajeno comprobar denegación; con categoría OPEN comprobar ausencia del panel. No ejecutar consultas adicionales solo para provocar errores de proveedor.

`npm run test:ine-provider` usa transporte sintético obligatorio. `npm run test:player-registrations` añade PostgreSQL local desechable y Storage/proveedor simulados: categoría, RBAC, concurrentes, huellas, cuotas, incertidumbre, revocación y versiones. Nunca se permite cableado real con AUTH_TEST_RUN=1. La disponibilidad de VMX_API_KEY no autoriza su uso por agentes.
