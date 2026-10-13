import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Iniciando siembra de datos...')

  // Roles base usando 'code' y 'name' como define la estructura del proyecto
  const roles = [
    { code: 'SUPERADMIN', name: 'Administrador General' },
    { code: 'PRESIDENTE_LIGA', name: 'Presidente de Liga' },
    { code: 'SECRETARIO', name: 'Secretario' },
    { code: 'DELEGADO', name: 'Delegado de Club' },
    { code: 'ARBITRO', name: 'Árbitro' },
    { code: 'CAPTURISTA', name: 'Capturista' },
    { code: 'JUGADOR', name: 'Jugador' },
  ]

  for (const role of roles) {
    await prisma.roles.upsert({
      where: { code: role.code },
      update: { name: role.name },
      create: {
        code: role.code,
        name: role.name,
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