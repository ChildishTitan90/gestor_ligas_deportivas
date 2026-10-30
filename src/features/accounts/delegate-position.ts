import type { DelegateAssignmentOptions } from "./types";

export function delegatePositionLabel(position: string | null): string {
  return position === "PRIMARY" ? "Titular" : position === "DEPUTY" ? "Subdelegado" : "Cargo no identificado";
}

/** Rows already scoped/filtered by PostgreSQL; never supplies authorization. */
export function delegateAvailability(positions: readonly (string | null)[]): DelegateAssignmentOptions["positions"] {
  return (["PRIMARY", "DEPUTY"] as const).map(value => {
    const reason = positions.includes(null) ? "LEGACY" : positions.includes(value) ? "OCCUPIED" : null;
    return { value, label: delegatePositionLabel(value), available: reason === null, reason };
  });
}

export function accountRoleLabel(role: { roleCode: string; roleName: string; delegatePosition: string | null }): string {
  return role.roleCode === "CLUB_DELEGATE" ? `${role.roleName} · ${delegatePositionLabel(role.delegatePosition)}` : role.roleName;
}
