import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Iniciando siembra de datos...')

  // 1. Definir los roles base del sistema
  const roles = [
    { name: 'SUPERADMIN', description: 'Administrador general del sistema' },
    { name: 'PRESIDENTE_LIGA', description: 'Presidente o directivo de la liga' },
    { name: 'SECRETARIO', description: 'Secretario administrativo' },
    { name: 'DELEGADO', description: 'Representante de un club' },
    { name: 'ARBITRO', description: 'Árbitro de partidos' },
    { name: 'CAPTURISTA', description: 'Capturista de cédulas y datos' },
    { name: 'JUGADOR', description: 'Jugador registrado' },
  ]

  // 2. Insertar o actualizar roles usando upsert (idempotente)
  for (const role of roles) {
    await prisma.roles.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: {
        name: role.name,
        description: role.description,
      },
    })
  }

  console.log('Semillas de roles creadas con éxito.')
}

main()
  .catch((e) => {
    console.error('Error al ejecutar semillas:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })