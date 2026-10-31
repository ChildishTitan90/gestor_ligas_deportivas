/** Validación local: nunca acredita una consulta a RENAPO ni titularidad. */
export function normalizeCurp(value: string): string {
  return value.trim().toUpperCase();
}

export function normalizeIdentityName(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "")
    .toUpperCase().replace(/[^\p{L}\p{N}]/gu, "");
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const curpPattern = /^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM](?:AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z0-9]\d$/;
const checkAlphabet = "0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ";

export function hasValidCurpStructure(curp: string): boolean {
  if (!curpPattern.test(curp)) return false;
  let sum = 0;
  for (let index = 0; index < 17; index++) sum += checkAlphabet.indexOf(curp[index]) * (18 - index);
  return (10 - sum % 10) % 10 === Number(curp[17]);
}

export function curpMatchesBirthDate(curp: string, birthDate: string): boolean {
  if (!isCalendarDate(birthDate)) return false;
  // No adivinar el siglo a partir de YY ni imponer un límite de edad deportiva.
  const year = Number(birthDate.slice(0, 4));
  return curp.slice(4, 10) === birthDate.slice(2).replaceAll("-", "") &&
    (year < 2000 ? /^\d$/.test(curp[16] ?? "") : /^[A-Z]$/.test(curp[16] ?? ""));
}

export type IdentityForMatching = {
  firstName: string;
  paternalSurname: string;
  maternalSurname?: string | null;
  birthDate: string;
};

export function sameIdentity(left: IdentityForMatching, right: IdentityForMatching): boolean {
  return left.birthDate === right.birthDate &&
    normalizeIdentityName(left.firstName) === normalizeIdentityName(right.firstName) &&
    normalizeIdentityName(left.paternalSurname) === normalizeIdentityName(right.paternalSurname) &&
    normalizeIdentityName(left.maternalSurname ?? "") === normalizeIdentityName(right.maternalSurname ?? "");
}

function withinOneEdit(left: string, right: string): boolean {
  if (left === right) return true;
  if (Math.abs(left.length - right.length) > 1) return false;
  let a = 0, b = 0, edits = 0;
  while (a < left.length && b < right.length) {
    if (left[a] === right[b]) { a++; b++; continue; }
    if (++edits > 1) return false;
    if (left.length >= right.length) a++;
    if (right.length >= left.length) b++;
  }
  return edits + Number(a < left.length || b < right.length) <= 1;
}

/** Señal conservadora de revisión; jamás una decisión de fusión. */
export function isPossibleIdentityMatch(left: IdentityForMatching, right: IdentityForMatching): boolean {
  const days = Math.abs(Date.parse(left.birthDate) - Date.parse(right.birthDate)) / 86_400_000;
  if (!Number.isFinite(days) || days > 1) return false;
  const pairs = [[left.firstName, right.firstName], [left.paternalSurname, right.paternalSurname]];
  if (left.maternalSurname && right.maternalSurname) pairs.push([left.maternalSurname, right.maternalSurname]);
  return pairs.every(([a, b]) => days === 0
    ? withinOneEdit(normalizeIdentityName(a), normalizeIdentityName(b))
    : normalizeIdentityName(a) === normalizeIdentityName(b));
}

export function adjacentBirthDates(value: string): string[] {
  const date = Date.parse(`${value}T00:00:00.000Z`);
  return [-1, 0, 1].map(offset => new Date(date + offset * 86_400_000).toISOString().slice(0, 10));
}
