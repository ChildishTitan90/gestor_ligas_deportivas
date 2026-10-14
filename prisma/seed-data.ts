// Fixtures sintéticos; las fechas y parámetros no son reglas aprobadas de la liga.
export const SEED_ROLES = [
  { code: "SUPERADMIN", name: "Administrador general" },
  { code: "EXECUTIVE_PRESIDENT", name: "Presidente ejecutivo" },
  { code: "SECRETARY", name: "Secretario" },
  { code: "TREASURER", name: "Tesorero" },
  { code: "DISCIPLINARY_BOARD", name: "Comisión disciplinaria" },
  { code: "REFEREE_MANAGER", name: "Comisión de arbitraje" },
  { code: "SCHEDULER", name: "Programador" },
  { code: "CLUB_DELEGATE", name: "Delegado de club" },
  { code: "REFEREE", name: "Árbitro" },
  { code: "DATA_ENTRY", name: "Capturista" },
  { code: "PLAYER", name: "Jugador" },
  { code: "GUEST", name: "Público" },
] as const;

export const SEED_CONTEXT = {
  leagueName: "Liga de Fútbol Morelia",
  seasonName: "Temporada 2026",
  categoryName: "Primera Fuerza",
  groupName: "Grupo A",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  ageCutoffDate: "2026-01-01",
  ruleVersion: 1,
  hierarchyOrder: 1,
  categoryType: "OPEN",
} as const;

// UUID reservado solo para esta persona sintética; los catálogos y el contexto
// recuperan sus UUID mediante las claves únicas de la base.
export const SEED_ACTOR = {
  personId: "47000000-0000-4000-8000-000000000001",
  username: "seed-pdgld-47-audit",
  email: "seed-pdgld-47-audit@example.invalid",
  firstName: "Actor sintético PDGLD-47",
  surname: "Auditoría de pruebas",
  // Marcador inválido como hash: no existe contraseña de acceso.
  passwordHash: "!PDGLD-47-SEED-DISABLED!",
} as const;

export const SEED_AUDIT_REASON = "PDGLD-47: creación de reglamento sintético de pruebas";
