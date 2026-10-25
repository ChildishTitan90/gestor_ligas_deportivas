import assert from "node:assert/strict";
import test from "node:test";
import {
  affiliationErrorMessage,
  affiliationResultSchema,
} from "./affiliation-feedback";

const validResult = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  referenceNumber: "AFL-prueba-sintetica",
  status: "PENDING",
  replayed: false,
};

test("acepta una solicitud registrada y un reintento recuperado", () => {
  assert.equal(
    affiliationResultSchema.safeParse(validResult).success,
    true,
  );

  assert.equal(
    affiliationResultSchema.safeParse({
      ...validResult,
      status: "APPROVED",
      replayed: true,
    }).success,
    true,
  );
});

test("rechaza respuestas incompletas o con tipos incorrectos", () => {
  for (const changes of [
    { id: "invalido" },
    { referenceNumber: " " },
    { status: "" },
    { replayed: "false" },
    { id: undefined },
  ]) {
    assert.equal(
      affiliationResultSchema.safeParse({
        ...validResult,
        ...changes,
      }).success,
      false,
    );
  }
});

test("muestra un mensaje útil para una firma inválida", () => {
  assert.equal(
    affiliationErrorMessage({ code: "INVALID_SIGNATURE" }),
    "Una firma no es válida o no está disponible. Revisa las tres firmas.",
  );
});

test("errores desconocidos no exponen detalles del servidor", () => {
  const fallback = affiliationErrorMessage(null);

  for (const body of [
    undefined,
    "Error SQL interno",
    { code: "ERROR_INTERNO", details: "Información privada" },
    { code: "constructor" },
    { code: "__proto__" },
  ]) {
    assert.equal(affiliationErrorMessage(body), fallback);
  }
});