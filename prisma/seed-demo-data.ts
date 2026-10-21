// Solo datos sintéticos para un perfil local explícito. No contiene concesiones.
export const DEMO_PASSWORD = "LigaDemo2026!";
export const DEMO_CONTEXT = {
  leagueId: "54000000-0000-4000-8000-000000000001",
  otherLeagueId: "54000000-0000-4000-8000-000000000002",
  leagueName: "DEMO Liga de Fútbol Morelia",
  otherLeagueName: "DEMO Liga de contraste",
  seasonId: "54000000-0000-4000-8000-000000000003",
  otherSeasonId: "54000000-0000-4000-8000-000000000004",
  seasonName: "DEMO Temporada 2026",
  clubAId: "54000000-0000-4000-8000-000000000005",
  clubBId: "54000000-0000-4000-8000-000000000006",
} as const;

export const DEMO_ACCOUNTS = [
  { personId: "54000000-0000-4000-8000-000000000011", username: "demo-admin",
    email: "admin@demo.example.test", name: "Administrador", roleCode: "SUPERADMIN", scope: "global", active: true, temporary: false },
  { personId: "54000000-0000-4000-8000-000000000012", username: "demo-secretario",
    email: "secretario@demo.example.test", name: "Secretario", roleCode: "SECRETARY", scope: "league", active: true, temporary: false },
  { personId: "54000000-0000-4000-8000-000000000013", username: "demo-programador",
    email: "programador@demo.example.test", name: "Programador", roleCode: "SCHEDULER", scope: "league", active: true, temporary: false },
  { personId: "54000000-0000-4000-8000-000000000014", username: "demo-delegado-a",
    email: "delegado-a@demo.example.test", name: "Delegado A", roleCode: "CLUB_DELEGATE", scope: "clubA", active: true, temporary: false },
  { personId: "54000000-0000-4000-8000-000000000015", username: "demo-delegado-b",
    email: "delegado-b@demo.example.test", name: "Delegado B", roleCode: "CLUB_DELEGATE", scope: "clubB", active: true, temporary: false },
  { personId: "54000000-0000-4000-8000-000000000016", username: "demo-temporal",
    email: "temporal@demo.example.test", name: "Temporal", roleCode: "SECRETARY", scope: "league", active: true, temporary: true },
  { personId: "54000000-0000-4000-8000-000000000017", username: "demo-inactiva",
    email: "inactiva@demo.example.test", name: "Inactiva", roleCode: "SECRETARY", scope: "league", active: false, temporary: false },
] as const;

// Compatibilidad con PDGLD-48: solo se crean si faltan, nunca reciben roles.
export const LEGACY_DEMO_ACCOUNTS = [
  { email: "operativa@example.test", username: "pdgld48_dev_operational", mustChangePassword: false },
  { email: "temporal@example.test", username: "pdgld48_dev_temporary", mustChangePassword: true },
] as const;
