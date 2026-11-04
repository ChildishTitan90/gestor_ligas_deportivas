import { z } from "zod";

export const guardianSignatureSchema = z.strictObject({
  registrationId: z.uuid(),
  guardianName: z.string().trim().min(3).max(160).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
  relationship: z.enum(["MOTHER", "FATHER", "GUARDIAN"]),
  acknowledgesRecord: z.literal(true),
});
export const guardianRelationships = [
  { value: "MOTHER", label: "Madre" }, { value: "FATHER", label: "Padre" },
  { value: "GUARDIAN", label: "Tutor o tutora" },
];
export const guardianSignatureStatement = "Declaro la relación indicada con el menor y confirmo que esta firma corresponde a su registro en el portal.";

/** Evidence, never an accredited consent. No approved legal/authorization text is assumed. */
export async function buildGuardianSignatureRecord(input: unknown, signature: File) {
  const data = guardianSignatureSchema.parse(input);
  if (signature.type !== "image/png" || !signature.size || signature.size > 1048576) throw new Error("INVALID_SIGNATURE");
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const image = await pdf.embedPng(await signature.arrayBuffer());
  if (image.width !== 600 || image.height !== 200) throw new Error("INVALID_SIGNATURE");
  const page = pdf.addPage([612, 792]);
  let y = 746;
  const line = (text: string, size = 11) => {
    let row = "";
    for (const character of text) {
      if (font.widthOfTextAtSize(row + character, size) > 530) {
        page.drawText(row, { x: 40, y, size, font }); y -= 17; row = "";
      }
      row += character;
    }
    page.drawText(row, { x: 40, y, size, font }); y -= 29;
  };
  line("Registro de firma de padre, madre o tutor", 17);
  line("Evidencia pendiente de acreditacion y revision administrativa.");
  line(`Registro del jugador: ${data.registrationId}`);
  line(`Nombre declarado: ${data.guardianName}`);
  line(`Relacion declarada: ${guardianRelationships.find(option => option.value === data.relationship)!.label}`);
  line(guardianSignatureStatement);
  line("Esta captura no acredita identidad, parentesco ni autorizacion aprobada.");
  line("Version del registro de captura: GUARDIAN_SIGNATURE_V1");
  page.drawImage(image, { x: 40, y: y - 200, width: 530, height: 530 / 3 });
  pdf.setTitle("Firma de tutor pendiente de revision");
  return new File([new Uint8Array(await pdf.save())], "firma-tutor-pendiente.pdf", { type: "application/pdf" });
}
