import { PDFDocument } from "pdf-lib";

const MAX_BYTES = 10 * 1024 * 1024;

/** Conserva la carta y añade la firma confirmada en una página identificada. */
export async function attachDelegateSignature(letter: File, signature: File): Promise<File> {
  if (!letter.size || letter.size > MAX_BYTES || signature.type !== "image/png" || !signature.size) {
    throw new Error("INVALID_DOCUMENT");
  }
  const bytes = await letter.arrayBuffer();
  let document: PDFDocument;
  if (letter.type === "application/pdf") {
    document = await PDFDocument.load(bytes, { updateMetadata: false });
  } else if (letter.type === "image/png" || letter.type === "image/jpeg") {
    document = await PDFDocument.create({ updateMetadata: false });
    const image = letter.type === "image/png" ? await document.embedPng(bytes) : await document.embedJpg(bytes);
    const page = document.addPage([595, 842]);
    const scale = Math.min(515 / image.width, 762 / image.height);
    page.drawImage(image, { x: (595 - image.width * scale) / 2, y: (842 - image.height * scale) / 2,
      width: image.width * scale, height: image.height * scale });
  } else {
    throw new Error("INVALID_DOCUMENT");
  }
  if (document.getPageCount() < 1 || document.getPageCount() >= 50) throw new Error("INVALID_DOCUMENT");
  const image = await document.embedPng(await signature.arrayBuffer());
  const page = document.addPage([595, 842]);
  page.drawText("Firma del delegado", { x: 50, y: 770, size: 16 });
  const scale = Math.min(400 / image.width, 160 / image.height);
  page.drawImage(image, { x: 50, y: 580, width: image.width * scale, height: image.height * scale });
  const signed = await document.save();
  if (signed.byteLength > MAX_BYTES) throw new Error("INVALID_DOCUMENT");
  return new File([new Uint8Array(signed)], "carta-firmada.pdf", { type: "application/pdf" });
}
