"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import SignatureCanvas from "react-signature-canvas";

type StrokeData = ReturnType<SignatureCanvas["toData"]>;

type Preview = {
  file: File;
  src: string;
};

type DirectSignatureFieldProps = {
  label: string;
  disabled?: boolean;
  stored?: boolean;
  submitted?: boolean;
  onChange: (file: File | null) => void;
};

const EXPORT_WIDTH = 600;
const EXPORT_HEIGHT = 200;

function scaleStrokes(data: StrokeData, factor: number): StrokeData {
  return data.map((group) =>
    group.map((point) => {
      const copy = Object.assign(
        Object.create(Object.getPrototypeOf(point)) as typeof point,
        point,
      );

      copy.x = point.x * factor;
      copy.y = point.y * factor;

      return copy;
    }),
  );
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error("No se pudo preparar la captura."));
      }
    }, "image/png");
  });
}

const secondaryButton =
  "rounded-lg border px-4 py-2 font-medium " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export function DirectSignatureField({
  label,
  disabled = false,
  stored = false,
  submitted = false,
  onChange,
}: DirectSignatureFieldProps) {
  const id = useId();
  const padRef = useRef<SignatureCanvas | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const sizeRef = useRef({ width: 0, ratio: 0 });
  const resizeRef = useRef<(() => void) | null>(null);
  const revisionRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(false);

  const [hasInk, setHasInk] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [message, setMessage] = useState("");

  const locked = disabled || preparing || preview !== null;

  useEffect(() => {
    mountedRef.current = true;

    const container = containerRef.current;
    const pad = padRef.current;

    if (!container || !pad) {
      return () => {
        mountedRef.current = false;
      };
    }

    function resize() {
      if (drawingRef.current) return;

      const currentPad = padRef.current;
      const currentContainer = containerRef.current;

      if (!currentPad || !currentContainer) return;

      const width = currentContainer.getBoundingClientRect().width;
      if (width <= 0) return;

      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const previous = sizeRef.current;

      if (
        Math.abs(previous.width - width) < 0.1 &&
        previous.ratio === ratio
      ) {
        return;
      }

      const strokes = currentPad.toData();
      const factor = previous.width > 0 ? width / previous.width : 1;
      const canvas = currentPad.getCanvas();
      const height = width / 3;

      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));

      const context = canvas.getContext("2d");
      if (!context) return;

      context.setTransform(
        canvas.width / width,
        0,
        0,
        canvas.height / height,
        0,
        0,
      );

      const signaturePad = currentPad.getSignaturePad();
      signaturePad.minWidth = 0.7 * (width / EXPORT_WIDTH);
      signaturePad.maxWidth = 2.5 * (width / EXPORT_WIDTH);

      currentPad.clear();

      if (strokes.length > 0) {
        currentPad.fromData(scaleStrokes(strokes, factor));
      }

      sizeRef.current = { width, ratio };
    }

    resizeRef.current = resize;

    const observer = new ResizeObserver(resize);
    observer.observe(container);

    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);

    let densityQuery: MediaQueryList | null = null;

    function watchDensity() {
      densityQuery?.removeEventListener("change", handleDensityChange);
      densityQuery = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`,
      );
      densityQuery.addEventListener("change", handleDensityChange);
    }

    function handleDensityChange() {
      resize();
      watchDensity();
    }

    resize();
    watchDensity();

    return () => {
      mountedRef.current = false;
      resizeRef.current = null;
      observer.disconnect();
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      densityQuery?.removeEventListener("change", handleDensityChange);
    };
  }, []);

  useEffect(() => {
  const pad = padRef.current;
  if (!pad) return;

  const signaturePad = pad.getSignaturePad();

  if (locked) {
    pad.off();
  } else {
    pad.on();
  }

  return () => {
    signaturePad.off();
  };
}, [locked]);

  function handleBegin() {
  drawingRef.current = true;
  revisionRef.current += 1;
  setMessage("");
  onChange(null);
}

  function handleEnd() {
    drawingRef.current = false;
    setHasInk(!(padRef.current?.isEmpty() ?? true));
    resizeRef.current?.();
  }

  function clearSignature() {
    if (disabled || busyRef.current) return;

    revisionRef.current += 1;
    padRef.current?.clear();
    setPreview(null);
    setConfirmed(false);
    setHasInk(false);
    setMessage("Captura borrada. Puedes volver a firmar.");
    onChange(null);
  }

  function editSignature() {
    if (disabled || busyRef.current) return;

    revisionRef.current += 1;
    setPreview(null);
    setConfirmed(false);
    setMessage("Puedes corregir la firma y volver a confirmarla.");
    onChange(null);
  }

  async function preparePreview() {
    const pad = padRef.current;

    if (disabled || busyRef.current || drawingRef.current) return;

    if (!pad || pad.isEmpty()) {
      setMessage("Dibuja tu firma antes de continuar.");
      pad?.getCanvas().focus();
      return;
    }

    busyRef.current = true;
    setPreparing(true);
    setMessage("");

    const revision = revisionRef.current;
    pad.off();

    try {
      const output = document.createElement("canvas");
      output.width = EXPORT_WIDTH;
      output.height = EXPORT_HEIGHT;

      const context = output.getContext("2d");
      if (!context) throw new Error("No se pudo preparar la captura.");

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, output.width, output.height);
      context.drawImage(
        pad.getCanvas(),
        0,
        0,
        output.width,
        output.height,
      );

      const blob = await canvasToBlob(output);

      if (!mountedRef.current || revisionRef.current !== revision) return;

      setPreview({
        file: new File([blob], "firma.png", { type: "image/png" }),
        src: output.toDataURL("image/png"),
      });
      setConfirmed(false);
      setMessage("Revisa la vista previa antes de confirmar.");
    } catch {
      if (mountedRef.current) {
        setMessage(
          "No se pudo preparar la vista previa. Tu firma sigue aquí; reintenta.",
        );
      }
    } finally {
      busyRef.current = false;
      if (mountedRef.current) setPreparing(false);
    }
  }

  function confirmSignature() {
    if (!preview || disabled || confirmed || busyRef.current) return;

    onChange(preview.file);
    setConfirmed(true);
    setMessage(
      "Captura confirmada en este formulario. Todavía no se ha enviado.",
    );
  }

  return (
    <fieldset className="min-w-0 space-y-3 rounded-xl border p-4">
      <legend className="px-2 font-semibold">{label}</legend>

      <p id={`${id}-instructions`} className="text-sm">
        Firma con ratón, pantalla táctil o lápiz. Después revisa la vista
        previa y confirma. La captura se conserva mientras permanezcas
        en esta página; no es un borrador guardado.
      </p>

      <p id={`${id}-assistance`} className="text-sm">
        Si no puedes dibujar la firma, solicita asistencia al responsable
        del trámite. No escribas un nombre como sustituto.
      </p>

      <div
        ref={containerRef}
        className="overflow-hidden rounded-lg border bg-white"
      >
        <SignatureCanvas
          ref={padRef}
          clearOnResize={false}
          penColor="#111111"
          backgroundColor="#ffffff"
          minWidth={0.7}
          maxWidth={2.5}
          onBegin={handleBegin}
          onEnd={handleEnd}
          canvasProps={{
            width: EXPORT_WIDTH,
            height: EXPORT_HEIGHT,
            tabIndex: 0,
            "aria-label": `Área para dibujar: ${label}`,
            "aria-describedby":
              `${id}-instructions ${id}-assistance ${id}-status`,
            "aria-disabled": locked,
            className:
              "block w-full focus-visible:outline-2 " +
              "focus-visible:outline-offset-[-3px]",
            style: {
              aspectRatio: "3 / 1",
              height: "auto",
              touchAction: "none",
              pointerEvents: locked ? "none" : "auto",
            },
          }}
        />
      </div>

      {preview && (
        <div className="space-y-2">
          <p className="text-sm font-medium">
            {confirmed ? "Captura confirmada" : "Vista previa"}
          </p>
          <Image
            src={preview.src}
            alt={`Vista previa de ${label}`}
            width={EXPORT_WIDTH}
            height={EXPORT_HEIGHT}
            unoptimized
            className="h-auto w-full rounded-lg border bg-white"
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={secondaryButton}
          disabled={disabled || preparing || (!hasInk && !preview)}
          onClick={clearSignature}
        >
          Limpiar
        </button>

        {!preview ? (
          <button
            type="button"
            className={`primary-action ${secondaryButton}`}
            disabled={disabled || preparing}
            onClick={() => void preparePreview()}
          >
            {preparing ? "Preparando…" : "Ver vista previa"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className={secondaryButton}
              disabled={disabled || preparing}
              onClick={editSignature}
            >
              Corregir firma
            </button>

            <button
              type="button"
              className={`primary-action ${secondaryButton}`}
              disabled={disabled || preparing || confirmed}
              onClick={confirmSignature}
            >
              {confirmed ? "Captura confirmada" : "Confirmar captura"}
            </button>
          </>
        )}
      </div>

      <p
  id={`${id}-status`}
  role="status"
  className="min-h-5 text-sm"
>
  {submitted
    ? "Firma incluida en la solicitud enviada."
    : stored
      ? "Firma cargada y validada. Lista para enviar con la solicitud."
      : confirmed
        ? "Captura confirmada. Consulta debajo el resultado de la carga."
        : message}
</p>
    </fieldset>
  );
}