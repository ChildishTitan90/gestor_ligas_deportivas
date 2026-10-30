import type { ZodIssue } from "zod";

export function accountErrorMessage(code: string): string {
  switch (code) {
    case "DELEGATE_POSITION_REQUIRED": return "Selecciona titular o subdelegado para esta asignación.";
    case "INVALID_DELEGATE_POSITION": return "Revisa el cargo y el perfil de la asignación.";
    case "DELEGATE_POSITION_OCCUPIED": return "El cargo ya está ocupado durante ese periodo.";
    case "DELEGATE_ACCOUNT_OVERLAP": return "La cuenta ya tiene una asignación solapada en ese club.";
    case "DELEGATE_LEGACY_OVERLAP": return "Debe regularizarse una asignación anterior con cargo no identificado.";
    case "DUPLICATE_ACCOUNT": return "No se pudo crear la cuenta porque alguno de sus identificadores ya está registrado. Revisa los datos de acceso.";
    case "PERSON_UNAVAILABLE": return "No se puede utilizar la persona indicada. Revisa la referencia o solicita apoyo al administrador.";
    case "UNAUTHENTICATED": return "Tu sesión terminó. Inicia sesión para continuar.";
    case "PASSWORD_CHANGE_REQUIRED": return "Debes cambiar tu contraseña antes de continuar.";
    case "FORBIDDEN": return "No tienes permiso para realizar esta operación en el ámbito seleccionado.";
    case "INVALID_CONTEXT": return "La liga o el club ya no están disponibles. Vuelve a seleccionar la liga.";
    case "VALIDATION_ERROR": case "INVALID_PAYLOAD": return "Revisa los datos del formulario.";
    case "INVALID_ORIGIN": return "No se pudo verificar el origen de la solicitud. Revisa la dirección de acceso con el administrador.";
    case "PAYLOAD_TOO_LARGE": return "La solicitud supera el tamaño permitido. Revisa los datos.";
    default: return "No se pudo confirmar el alta. Comprueba con el administrador si se registró antes de volver a enviarla.";
  }
}

/** Mensajes de presentación: no modifica esquemas ni la configuración global de Zod. */
export function accountValidationMessage(issue: ZodIssue): string {
  const field = issue.path.map(String).join(".");
  const selection = field === "delegatePosition" || field === "leagueId" || field.startsWith("roles") || field.startsWith("club");
  switch (issue.code) {
    case "invalid_type":
      return selection ? "Selecciona una opción válida." : "Completa este campo con un valor válido.";
    case "too_small":
      if (issue.origin === "array") return "Selecciona al menos un rol.";
      if (issue.minimum === 1) return "Este campo es obligatorio.";
      return `Escribe al menos ${issue.minimum} caracteres.`;
    case "too_big":
      if (issue.origin === "array") return `Selecciona como máximo ${issue.maximum} roles.`;
      return `No superes los ${issue.maximum} caracteres.`;
    case "invalid_format":
      if (field.startsWith("delegatePeriod.")) return "Indica una fecha y hora válidas.";
      if (issue.format === "email") return "Escribe un correo electrónico válido.";
      if (issue.format === "uuid") return selection ? "Selecciona una opción válida." : "Escribe un UUID de persona válido.";
      if (field === "username") return "Usa letras, números, punto, guion o guion bajo.";
      if (field === "temporaryPassword") {
        const patterns: Record<string, string> = {
          "/[A-Z]/": "Incluye al menos una letra mayúscula.",
          "/[a-z]/": "Incluye al menos una letra minúscula.",
          "/[0-9]/": "Incluye al menos un número.",
          "/[^A-Za-z0-9]/": "Incluye al menos un símbolo.",
        };
        return patterns[issue.pattern ?? ""] ?? "Incluye mayúscula, minúscula, número y símbolo en la contraseña temporal.";
      }
      return "Revisa el formato de este campo.";
    case "invalid_value": return selection ? "Selecciona una opción válida." : "Revisa el valor de este campo.";
    case "invalid_union": return "Revisa los datos de la persona o la selección indicada.";
    case "unrecognized_keys": return "Revisa los campos del formulario.";
    case "custom":
      if (field === "delegatePeriod.endsAt") return "El fin debe ser posterior al inicio.";
      if (field === "delegatePeriod") return "La vigencia corresponde únicamente al perfil de delegado.";
      if (field === "delegatePosition") return "Selecciona titular o subdelegado únicamente para el perfil de delegado.";
      if (field === "roles") return "No repitas roles. SUPERADMIN debe asignarse de forma global y exclusiva.";
      if (field === "leagueId") return "Selecciona una liga.";
      if (field === "club") return "Selecciona un club o crea su registro inicial únicamente para el rol de delegado.";
      return "Revisa el valor de este campo.";
    default: return "Revisa el valor de este campo.";
  }
}

export function accountValidationErrors(issues: readonly ZodIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    // Todos los roles comparten un grupo accesible, incluso errores de un elemento.
    const path = issue.path[0] === "roles" ? "roles" : issue.path.map(String).join(".");
    errors[path] ??= accountValidationMessage(issue);
  }
  return errors;
}
