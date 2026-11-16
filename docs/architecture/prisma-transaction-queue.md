# Consultas secuenciales en una transacción PostgreSQL

PDGLD-86, 14/11/2026. Prisma/adapter-pg 7.10.1 y pg 8.23.1.

Al cargar relaciones hermanas, el intérprete de Prisma envía consultas en
paralelo sobre el único cliente PostgreSQL de la transacción. La traza local
mostró consultas de afiliación, árbitro, club, temporada y Persona superpuestas.
pg advierte que su cola implícita se retirará en pg 9; Next.js presenta esta
advertencia de servidor en su overlay de desarrollo.

`server/db/transaction-queue.ts` conserva PrismaPg y añade una cola FIFO por
transacción. Serializa queryRaw/executeRaw, savepoints y hooks de cierre en esa
conexión. Las transacciones y los clientes distintos siguen siendo independientes.
Un rechazo llega intacto al llamador y permite el rollback siguiente. Los hooks
de commit/rollback solo delegan limpieza: no generan otro comando SQL.

Se conservan aislamiento, mapeo de resultados/errores, metadatos, TLS, pools y
su propiedad/dispose en el adaptador oficial. La fábrica aplica la misma capa
al adaptador de shadow, sin crear ni usar una base shadow en esta validación.
No se modifican node_modules, versiones, permisos, RLS o datos del negocio.

`npm run test:database-config` comprueba orden, resultados, errores, rollback,
savepoints, transacciones independientes y delegación de ciclo de vida junto
con los controles TLS existentes. La validación local de presentaciones/acceso
también pasa sobre PostgreSQL habitual con rollback y sin la advertencia que
se reproducía antes. La prueba UI verifica Acceso → Editar → Historial y Tab
en ambos temas a 390/1440 px, con datos sintéticos.
La comprobación adicional de solo lectura en Docker verificó dos conexiones
PostgreSQL distintas, numeric/null preservados, SQLSTATE 22012 tras un error y
recuperación del pool después del rollback. Padrón y contextos de Comisión no
superpusieron consultas al observar el cliente pg durante esa comprobación.

La caché global ahora identifica el esquema generado y la fábrica del adaptador.
Una recarga de módulos conserva el cliente compatible y retira un singleton de
otro esquema, liberando su pool. Se comprobó con un cliente anterior sin el
delegado de cédulas. Después de `prisma generate`, reiniciar `npm run dev` si
Next.js todavía conserva el paquete de node_modules anterior: renovar únicamente
la página no garantiza que el proceso haya recibido el generador nuevo.
