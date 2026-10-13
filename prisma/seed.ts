import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

// 1. Configuración de conexión compatible con Prisma 7 via @prisma/adapter-pg
const connectionString = process.env.DATABASE_URL
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Iniciando siembra de datos (seed)...')

  // 2. Catálogo oficial de los 12 roles baseline del proyecto
  const roles = [
    { code: 'SUPERADMIN', name: 'Super Administrador' },
    { code: 'EXECUTIVE_PRESIDENT', name: 'Presidente Ejecutivo' },
    { code: 'SECRETARY', name: 'Secretario' },
    { code: 'TREASURER', name: 'Tesorero' },
    { code: 'DISCIPLINARY_BOARD', name: 'Comisión Disciplinaria' },
    { code: 'REFEREE_MANAGER', name: 'Encargado de Árbitros' },
    { code: 'SCHEDULER', name: 'Programador de Partidos' },
    { code: 'CLUB_DELEGATE', name: 'Delegado de Club' },
    { code: 'REFEREE', name: 'Árbitro' },
    { code: 'DATA_ENTRY', name: 'Capturista' },
    { code: 'PLAYER', name: 'Jugador' },
    { code: 'GUEST', name: 'Invitado' },
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

  console.log('12 roles baseline verificados e insertados sin duplicados.')
}

main()
  .catch((e) => {
    console.error('Error al ejecutar el seed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })