/**
 * PDGLD-55: configuración INICIAL aprobada RF22 (ERS, páginas PDF 40-42).
 * Datos puros: no consulta, siembra ni autoriza. Véase docs/architecture/permissions.md.
 * No usar como permisos efectivos ni restaurar concesiones retiradas al repetir un seed.
 */
export const PERMISSION_ROLE_CODES = [
  "SUPERADMIN",
  "EXECUTIVE_PRESIDENT",
  "SECRETARY",
  "TREASURER",
  "DISCIPLINARY_BOARD",
  "REFEREE_MANAGER",
  "SCHEDULER",
  "CLUB_DELEGATE",
  "REFEREE",
  "DATA_ENTRY",
  "PLAYER",
  "GUEST"
] as const;

export const PERMISSION_MODULES = [
  "competitions",
  "clubs",
  "players",
  "venues",
  "scheduling",
  "match-reports",
  "discipline",
  "billing",
  "refereeing",
  "portal",
  "users",
  "audit"
] as const;

// IMPORT es válido en PostgreSQL, pero no tiene concesiones en la matriz RF22.
export const DATABASE_PERMISSION_ACTIONS = [
  "CREATE", "READ", "UPDATE", "APPROVE", "PUBLISH", "IMPORT",
] as const;
export type PermissionRoleCode = (typeof PERMISSION_ROLE_CODES)[number];
export type PermissionModule = (typeof PERMISSION_MODULES)[number];
export type PermissionAction = (typeof DATABASE_PERMISSION_ACTIONS)[number];
/** Clave única del permiso, compartida por todos los roles: ${module}:${action}. */
export type PermissionKey = `${PermissionModule}:${PermissionAction}`;

export type InitialPermissionGrant = Readonly<{
  roleCode: PermissionRoleCode;
  module: PermissionModule;
  action: PermissionAction;
  /** Marca literal del grupo de letras con *, NO la totalidad de reglas de contexto. */
  contextOnly: boolean;
  /** Página física del PDF, fila, columna y contenido/nota de la celda original. */
  ersReference: string;
}>;

/** Una entrada por rol/módulo/acción. Sin concesiones implícitas ni bypass SUPERADMIN. */
export const INITIAL_PERMISSION_GRANTS = [
  // Temporadas, categorías, reglas (RF08).
  { roleCode: "SUPERADMIN", module: "competitions", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Temporadas, categorías, reglas (RF08), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "competitions", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Temporadas, categorías, reglas (RF08), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "competitions", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Temporadas, categorías, reglas (RF08), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "competitions", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Temporadas, categorías, reglas (RF08), SUPERADMIN: CRUA" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "competitions", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Temporadas, categorías, reglas (RF08), EXECUTIVE_PRESIDENT: RA" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "competitions", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Temporadas, categorías, reglas (RF08), EXECUTIVE_PRESIDENT: RA" },
  { roleCode: "SECRETARY", module: "competitions", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Temporadas, categorías, reglas (RF08), SECRETARY: R" },
  { roleCode: "TREASURER", module: "competitions", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Temporadas, categorías, reglas (RF08), TREASURER: R" },
  { roleCode: "DISCIPLINARY_BOARD", module: "competitions", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Temporadas, categorías, reglas (RF08), DISCIPLINARY_BOARD: R" },
  { roleCode: "REFEREE_MANAGER", module: "competitions", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Temporadas, categorías, reglas (RF08), REFEREE_MANAGER: R" },
  { roleCode: "SCHEDULER", module: "competitions", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Temporadas, categorías, reglas (RF08), SCHEDULER: R" },
  { roleCode: "CLUB_DELEGATE", module: "competitions", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Temporadas, categorías, reglas (RF08), CLUB_DELEGATE: R" },
  // Clubes y equipos (RF01, RF21).
  { roleCode: "SUPERADMIN", module: "clubs", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "clubs", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "clubs", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "clubs", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), SUPERADMIN: CRUA" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "clubs", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), EXECUTIVE_PRESIDENT: RA" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "clubs", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), EXECUTIVE_PRESIDENT: RA" },
  { roleCode: "SECRETARY", module: "clubs", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), SECRETARY: CRUA" },
  { roleCode: "SECRETARY", module: "clubs", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), SECRETARY: CRUA" },
  { roleCode: "SECRETARY", module: "clubs", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), SECRETARY: CRUA" },
  { roleCode: "SECRETARY", module: "clubs", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), SECRETARY: CRUA" },
  { roleCode: "TREASURER", module: "clubs", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), TREASURER: R" },
  { roleCode: "DISCIPLINARY_BOARD", module: "clubs", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), DISCIPLINARY_BOARD: R" },
  { roleCode: "REFEREE_MANAGER", module: "clubs", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), REFEREE_MANAGER: R" },
  { roleCode: "SCHEDULER", module: "clubs", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), SCHEDULER: R" },
  { roleCode: "CLUB_DELEGATE", module: "clubs", action: "CREATE", contextOnly: true, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), CLUB_DELEGATE: CRU*; leyenda * p. 40 y RF22.5" },
  { roleCode: "CLUB_DELEGATE", module: "clubs", action: "READ", contextOnly: true, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), CLUB_DELEGATE: CRU*; leyenda * p. 40 y RF22.5" },
  { roleCode: "CLUB_DELEGATE", module: "clubs", action: "UPDATE", contextOnly: true, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), CLUB_DELEGATE: CRU*; leyenda * p. 40 y RF22.5" },
  { roleCode: "DATA_ENTRY", module: "clubs", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Clubes y equipos (RF01, RF21), DATA_ENTRY: R" },
  // Jugadores (RF02).
  { roleCode: "SUPERADMIN", module: "players", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "players", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "players", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "players", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), SUPERADMIN: CRUA" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "players", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), EXECUTIVE_PRESIDENT: R" },
  { roleCode: "SECRETARY", module: "players", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), SECRETARY: RUA" },
  { roleCode: "SECRETARY", module: "players", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), SECRETARY: RUA" },
  { roleCode: "SECRETARY", module: "players", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), SECRETARY: RUA" },
  { roleCode: "TREASURER", module: "players", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), TREASURER: R" },
  { roleCode: "DISCIPLINARY_BOARD", module: "players", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), DISCIPLINARY_BOARD: R" },
  { roleCode: "REFEREE_MANAGER", module: "players", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), REFEREE_MANAGER: R" },
  { roleCode: "SCHEDULER", module: "players", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), SCHEDULER: R" },
  { roleCode: "CLUB_DELEGATE", module: "players", action: "CREATE", contextOnly: true, ersReference: "RF22, PDF p. 41, Jugadores (RF02), CLUB_DELEGATE: CRU*; leyenda * p. 40 y RF22.5" },
  { roleCode: "CLUB_DELEGATE", module: "players", action: "READ", contextOnly: true, ersReference: "RF22, PDF p. 41, Jugadores (RF02), CLUB_DELEGATE: CRU*; leyenda * p. 40 y RF22.5" },
  { roleCode: "CLUB_DELEGATE", module: "players", action: "UPDATE", contextOnly: true, ersReference: "RF22, PDF p. 41, Jugadores (RF02), CLUB_DELEGATE: CRU*; leyenda * p. 40 y RF22.5" },
  { roleCode: "DATA_ENTRY", module: "players", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Jugadores (RF02), DATA_ENTRY: R" },
  { roleCode: "PLAYER", module: "players", action: "READ", contextOnly: true, ersReference: "RF22, PDF p. 41, Jugadores (RF02), PLAYER: R*; leyenda * p. 40 y RF22.5" },
  // Canchas (RF04).
  { roleCode: "SUPERADMIN", module: "venues", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Canchas (RF04), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "venues", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Canchas (RF04), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "venues", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Canchas (RF04), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "venues", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Canchas (RF04), SUPERADMIN: CRUA" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "venues", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Canchas (RF04), EXECUTIVE_PRESIDENT: A" },
  { roleCode: "SECRETARY", module: "venues", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Canchas (RF04), SECRETARY: R" },
  { roleCode: "SCHEDULER", module: "venues", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Canchas (RF04), SCHEDULER: CRU" },
  { roleCode: "SCHEDULER", module: "venues", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Canchas (RF04), SCHEDULER: CRU" },
  { roleCode: "SCHEDULER", module: "venues", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Canchas (RF04), SCHEDULER: CRU" },
  { roleCode: "CLUB_DELEGATE", module: "venues", action: "CREATE", contextOnly: true, ersReference: "RF22, PDF p. 41, Canchas (RF04), CLUB_DELEGATE: C* R; leyenda * p. 40 y RF22.5" },
  { roleCode: "CLUB_DELEGATE", module: "venues", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Canchas (RF04), CLUB_DELEGATE: C* R" },
  { roleCode: "REFEREE", module: "venues", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Canchas (RF04), REFEREE: R" },
  { roleCode: "DATA_ENTRY", module: "venues", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Canchas (RF04), DATA_ENTRY: R" },
  // Programación y partidos (RF05, RF09).
  { roleCode: "SUPERADMIN", module: "scheduling", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), SUPERADMIN: RA" },
  { roleCode: "SUPERADMIN", module: "scheduling", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), SUPERADMIN: RA" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "scheduling", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), EXECUTIVE_PRESIDENT: RA" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "scheduling", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), EXECUTIVE_PRESIDENT: RA" },
  { roleCode: "SECRETARY", module: "scheduling", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), SECRETARY: R" },
  { roleCode: "DISCIPLINARY_BOARD", module: "scheduling", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), DISCIPLINARY_BOARD: R" },
  { roleCode: "REFEREE_MANAGER", module: "scheduling", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), REFEREE_MANAGER: R" },
  { roleCode: "SCHEDULER", module: "scheduling", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), SCHEDULER: CRU" },
  { roleCode: "SCHEDULER", module: "scheduling", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), SCHEDULER: CRU" },
  { roleCode: "SCHEDULER", module: "scheduling", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), SCHEDULER: CRU" },
  { roleCode: "CLUB_DELEGATE", module: "scheduling", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), CLUB_DELEGATE: R" },
  { roleCode: "REFEREE", module: "scheduling", action: "READ", contextOnly: true, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), REFEREE: R*; leyenda * p. 40 y RF22.5" },
  { roleCode: "DATA_ENTRY", module: "scheduling", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Programación y partidos (RF05, RF09), DATA_ENTRY: R" },
  // Cédula (RF03).
  { roleCode: "SUPERADMIN", module: "match-reports", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Cédula (RF03), SUPERADMIN: R" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "match-reports", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Cédula (RF03), EXECUTIVE_PRESIDENT: R" },
  { roleCode: "SECRETARY", module: "match-reports", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Cédula (RF03), SECRETARY: R" },
  { roleCode: "DISCIPLINARY_BOARD", module: "match-reports", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Cédula (RF03), DISCIPLINARY_BOARD: R" },
  { roleCode: "REFEREE_MANAGER", module: "match-reports", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Cédula (RF03), REFEREE_MANAGER: R" },
  { roleCode: "SCHEDULER", module: "match-reports", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Cédula (RF03), SCHEDULER: R" },
  { roleCode: "CLUB_DELEGATE", module: "match-reports", action: "READ", contextOnly: true, ersReference: "RF22, PDF p. 41, Cédula (RF03), CLUB_DELEGATE: R*; leyenda * p. 40 y RF22.5" },
  { roleCode: "REFEREE", module: "match-reports", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Cédula (RF03), REFEREE: C U*" },
  { roleCode: "REFEREE", module: "match-reports", action: "UPDATE", contextOnly: true, ersReference: "RF22, PDF p. 41, Cédula (RF03), REFEREE: C U*; leyenda * p. 40 y RF22.5" },
  { roleCode: "DATA_ENTRY", module: "match-reports", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Cédula (RF03), DATA_ENTRY: CU" },
  { roleCode: "DATA_ENTRY", module: "match-reports", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Cédula (RF03), DATA_ENTRY: CU" },
  // Disciplina, recursos, bajas (RF06, RF14, RF10).
  { roleCode: "SUPERADMIN", module: "discipline", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), SUPERADMIN: R" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "discipline", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), EXECUTIVE_PRESIDENT: RA (bajas)" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "discipline", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), EXECUTIVE_PRESIDENT: RA (bajas)" },
  { roleCode: "SECRETARY", module: "discipline", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), SECRETARY: R" },
  { roleCode: "DISCIPLINARY_BOARD", module: "discipline", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), DISCIPLINARY_BOARD: CRUA" },
  { roleCode: "DISCIPLINARY_BOARD", module: "discipline", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), DISCIPLINARY_BOARD: CRUA" },
  { roleCode: "DISCIPLINARY_BOARD", module: "discipline", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), DISCIPLINARY_BOARD: CRUA" },
  { roleCode: "DISCIPLINARY_BOARD", module: "discipline", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), DISCIPLINARY_BOARD: CRUA" },
  { roleCode: "REFEREE_MANAGER", module: "discipline", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), REFEREE_MANAGER: R" },
  { roleCode: "SCHEDULER", module: "discipline", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), SCHEDULER: R" },
  { roleCode: "CLUB_DELEGATE", module: "discipline", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), CLUB_DELEGATE: C R*" },
  { roleCode: "CLUB_DELEGATE", module: "discipline", action: "READ", contextOnly: true, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), CLUB_DELEGATE: C R*; leyenda * p. 40 y RF22.5" },
  { roleCode: "PLAYER", module: "discipline", action: "READ", contextOnly: true, ersReference: "RF22, PDF p. 41, Disciplina, recursos, bajas (RF06, RF14, RF10), PLAYER: R*; leyenda * p. 40 y RF22.5" },
  // Cobranza (RF12).
  { roleCode: "SUPERADMIN", module: "billing", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Cobranza (RF12), SUPERADMIN: R" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "billing", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Cobranza (RF12), EXECUTIVE_PRESIDENT: R" },
  { roleCode: "SECRETARY", module: "billing", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Cobranza (RF12), SECRETARY: R" },
  { roleCode: "TREASURER", module: "billing", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Cobranza (RF12), TREASURER: CRU" },
  { roleCode: "TREASURER", module: "billing", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Cobranza (RF12), TREASURER: CRU" },
  { roleCode: "TREASURER", module: "billing", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Cobranza (RF12), TREASURER: CRU" },
  { roleCode: "CLUB_DELEGATE", module: "billing", action: "READ", contextOnly: true, ersReference: "RF22, PDF p. 41, Cobranza (RF12), CLUB_DELEGATE: R*; leyenda * p. 40 y RF22.5" },
  // Arbitraje (RF11).
  { roleCode: "SUPERADMIN", module: "refereeing", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Arbitraje (RF11), SUPERADMIN: R" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "refereeing", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Arbitraje (RF11), EXECUTIVE_PRESIDENT: R" },
  { roleCode: "SECRETARY", module: "refereeing", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Arbitraje (RF11), SECRETARY: R" },
  { roleCode: "REFEREE_MANAGER", module: "refereeing", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Arbitraje (RF11), REFEREE_MANAGER: CRUA" },
  { roleCode: "REFEREE_MANAGER", module: "refereeing", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Arbitraje (RF11), REFEREE_MANAGER: CRUA" },
  { roleCode: "REFEREE_MANAGER", module: "refereeing", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Arbitraje (RF11), REFEREE_MANAGER: CRUA" },
  { roleCode: "REFEREE_MANAGER", module: "refereeing", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Arbitraje (RF11), REFEREE_MANAGER: CRUA" },
  { roleCode: "SCHEDULER", module: "refereeing", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Arbitraje (RF11), SCHEDULER: RU [PV]" },
  { roleCode: "SCHEDULER", module: "refereeing", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Arbitraje (RF11), SCHEDULER: RU [PV]" },
  { roleCode: "REFEREE", module: "refereeing", action: "READ", contextOnly: true, ersReference: "RF22, PDF p. 41, Arbitraje (RF11), REFEREE: R*; leyenda * p. 40 y RF22.5" },
  // Publicar en portal (RF16).
  { roleCode: "SUPERADMIN", module: "portal", action: "PUBLISH", contextOnly: false, ersReference: "RF22, PDF p. 41, Publicar en portal (RF16), SUPERADMIN: P" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "portal", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Publicar en portal (RF16), EXECUTIVE_PRESIDENT: AP" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "portal", action: "PUBLISH", contextOnly: false, ersReference: "RF22, PDF p. 41, Publicar en portal (RF16), EXECUTIVE_PRESIDENT: AP" },
  { roleCode: "SECRETARY", module: "portal", action: "PUBLISH", contextOnly: false, ersReference: "RF22, PDF p. 41, Publicar en portal (RF16), SECRETARY: P (revisa)" },
  { roleCode: "DISCIPLINARY_BOARD", module: "portal", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Publicar en portal (RF16), DISCIPLINARY_BOARD: C (castigados)" },
  { roleCode: "SCHEDULER", module: "portal", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Publicar en portal (RF16), SCHEDULER: C (propone)" },
  // Usuarios y roles (RF22).
  { roleCode: "SUPERADMIN", module: "users", action: "CREATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Usuarios y roles (RF22), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "users", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 41, Usuarios y roles (RF22), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "users", action: "UPDATE", contextOnly: false, ersReference: "RF22, PDF p. 41, Usuarios y roles (RF22), SUPERADMIN: CRUA" },
  { roleCode: "SUPERADMIN", module: "users", action: "APPROVE", contextOnly: false, ersReference: "RF22, PDF p. 41, Usuarios y roles (RF22), SUPERADMIN: CRUA" },
  // Auditoría (RF19).
  { roleCode: "SUPERADMIN", module: "audit", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 42, Auditoría (RF19), SUPERADMIN: R" },
  { roleCode: "EXECUTIVE_PRESIDENT", module: "audit", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 42, Auditoría (RF19), EXECUTIVE_PRESIDENT: R" },
  { roleCode: "SECRETARY", module: "audit", action: "READ", contextOnly: false, ersReference: "RF22, PDF p. 42, Auditoría (RF19), SECRETARY: R" },
] as const satisfies readonly InitialPermissionGrant[];

