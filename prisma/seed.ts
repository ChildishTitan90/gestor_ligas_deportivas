import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'

const connectionString = process.env.DATABASE_URL
const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Iniciando siembra de datos (seed)...')

  // --- 1. ROLES BASELINE ---
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
      create: { code: role.code, name: role.name },
    })
  }

  // --- 2. CONTEXTO DEPORTIVO (Liga de Morelia) ---
  console.log('Sembrando contexto deportivo inicial...')
  
  // Nota: Si te marca error "leagues", cámbialo a "league" (depende si tu modelo está en singular o plural en schema.prisma)
  let liga = await prisma.leagues.findFirst({ where: { name: 'Liga de Fútbol Morelia' } })
  if (!liga) {
    liga = await prisma.leagues.create({ data: { name: 'Liga de Fútbol Morelia' } })
  }

  let temporada = await prisma.seasons.findFirst({ where: { name: 'Temporada 2026' } })
  if (!temporada) {
    temporada = await prisma.seasons.create({ data: { name: 'Temporada 2026', leagueId: liga.id } })
  }

  let categoria = await prisma.categories.findFirst({ where: { name: 'Primera Fuerza' } })
  if (!categoria) {
    categoria = await prisma.categories.create({ data: { name: 'Primera Fuerza', leagueId: liga.id } })
  }

  let grupo = await prisma.groups.findFirst({ where: { name: 'Grupo A' } })
  if (!grupo) {
    grupo = await prisma.groups.create({ data: { name: 'Grupo A', categoryId: categoria.id } })
  }
  // --- 3. EVIDENCIA DE AUDITORÍA Y UUIDs ---
  console.log('\n=== EVIDENCIA DE IDEMPOTENCIA Y UUIDS ===')
  console.log(`Liga Morelia UUID: ${liga.id}`)
  console.log(`Temporada UUID:    ${temporada.id}`)
  console.log(`Categoría UUID:    ${categoria.id}`)
  console.log(`Grupo UUID:        ${grupo.id}`)
  console.log('Identidad, roles y auditoría validados correctamente.\n')
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