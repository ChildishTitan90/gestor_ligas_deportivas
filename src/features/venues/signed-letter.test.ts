import test from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { attachDelegateSignature } from "./signed-letter.client";

test("la carta conserva sus páginas y agrega la firma en un PDF", async () => {
  const original = await PDFDocument.create();
  original.addPage().drawText("Carta sintetica");
  const letter = new File([new Uint8Array(await original.save())], "carta.pdf", { type: "application/pdf" });
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a6sAAAAASUVORK5CYII=", "base64");
  const signature = new File([png], "firma.png", { type: "image/png" });
  const signed = await attachDelegateSignature(letter, signature);
  assert.equal(signed.type, "application/pdf");
  const document = await PDFDocument.load(await signed.arrayBuffer());
  assert.equal(document.getPageCount(), 2);
  await assert.rejects(attachDelegateSignature(letter, new File([], "firma.png", { type: "image/png" })));
});
