import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProposalStatus } from "./proposal-status";
import { PendingReasons } from "./pending-reasons";

test("la propuesta explica sus estados y cómo atender pendientes", () => {
  const draft = renderToStaticMarkup(<ProposalStatus status="DRAFT" pendingCount={2} canEdit />);
  assert.match(draft, /2 encuentros pendientes/);
  assert.match(draft, /Ver detalles/);
  assert.match(draft, /enviar la propuesta a revisión/);
  const review = renderToStaticMarkup(<ProposalStatus status="IN_REVIEW" pendingCount={1} canEdit={false} />);
  assert.match(review, /espera la decisión/);
  assert.match(review, /persona encargada/);
  const approved = renderToStaticMarkup(<ProposalStatus status="APPROVED" pendingCount={0} canEdit={false} />);
  assert.match(approved, /aprobó esta programación para operar/);
  assert.match(approved, /paso separado/);
  const changed = renderToStaticMarkup(<PendingReasons factors={["TEAM_CHANGED"]} />);
  assert.match(changed, /Cambiaron los equipos/);
  assert.doesNotMatch(changed, /al generar/);
  assert.match(changed, /antes de guardar el ajuste/);
});
