import assert from "node:assert/strict";
import test from "node:test";
import { affiliationFormSchema, affiliationOfficeCodes } from "./schemas";

function validCapture() {
  const person = () => ({ firstName: " Persona ficticia ", paternalSurname: " Prueba ", maternalSurname: "" });
  return {
    clubName: " Club de prueba ", uniformColors: " Azul y blanco ",
    categoryIds: ["categoria-de-prueba"],
    officers: { PRESIDENT: person(), SECRETARY: person(), TREASURER: person() },
  };
}

test("acepta la captura completa, normaliza espacios y admite apellido materno vacío", () => {
  const parsed = affiliationFormSchema.parse(validCapture());
  assert.equal(parsed.clubName, "Club de prueba");
  assert.equal(parsed.uniformColors, "Azul y blanco");
  assert.equal(parsed.officers.PRESIDENT.firstName, "Persona ficticia");
});

for (const field of ["clubName", "uniformColors"] as const) {
  test(`rechaza ${field} vacío o compuesto por espacios`, () => {
    for (const value of ["", " \t\n "]) {
      const data = validCapture();
      data[field] = value;
      const result = affiliationFormSchema.safeParse(data);
      assert.equal(result.success, false);
      if (!result.success) assert.ok(result.error.issues.some((issue) => issue.path.join(".") === field));
    }
  });
}

test("exige categorías y rechaza identificadores vacíos o repetidos tras normalización", () => {
  for (const categoryIds of [[], [" "], ["a", "a"], [" a ", "a"]]) {
    assert.equal(affiliationFormSchema.safeParse({ ...validCapture(), categoryIds }).success, false);
  }
});

for (const office of affiliationOfficeCodes) {
  test(`exige nombre y apellido paterno completos de ${office}`, () => {
    for (const field of ["firstName", "paternalSurname"] as const) {
      const data = validCapture();
      data.officers[office][field] = "  ";
      const result = affiliationFormSchema.safeParse(data);
      assert.equal(result.success, false);
      if (!result.success) assert.ok(result.error.issues.some((issue) => issue.path.join(".") === `officers.${office}.${field}`));
    }
  });
  test(`rechaza la ausencia del cargo ${office}`, () => {
    const data = validCapture();
    const officers = { ...data.officers, [office]: undefined };
    assert.equal(affiliationFormSchema.safeParse({ ...data, officers }).success, false);
  });
}

test("rechaza campos de servidor que no pertenecen a la captura", () => {
  assert.equal(affiliationFormSchema.safeParse({ ...validCapture(), status: "APPROVED", reference_number: "inventado" }).success, false);
});
