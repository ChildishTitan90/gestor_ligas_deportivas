"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

type Props = { url: string; label: string; expiresAt: number };

export function SignatureReviewPreview(props: Props) {
  // Una URL nueva no hereda el estado de la imagen anterior.
  return <PreviewContent key={`${props.url}:${props.expiresAt}`} {...props} />;
}

function PreviewContent({ url, label, expiresAt }: Props) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [expired, setExpired] = useState(() => Date.now() >= expiresAt);

  useEffect(() => {
    const timeout = setTimeout(() => setExpired(true), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [expiresAt]);

  if (expired) {
    return <p role="status">El acceso temporal venció. Vuelve a consultar la firma.</p>;
  }

  return (
    <div className="space-y-2" aria-label={`Vista previa: ${label}`}>
      <p className="font-medium">Vista previa de {label}</p>
      {status === "loading" && <p role="status">Cargando vista previa…</p>}
      {status === "error" ? (
        <p role="status" className="text-muted">
          No se pudo mostrar la vista previa. Puedes usar Descargar firma.
          Si el archivo es PDF, ábrelo desde el enlace de descarga.
        </p>
      ) : (
        <Image
          src={url}
          alt={`Firma registrada de ${label}`}
          width={600}
          height={200}
          unoptimized
          loading="eager"
          referrerPolicy="no-referrer"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("error")}
          className={`max-h-72 w-full rounded-xl border border-border bg-white object-contain ${status === "loading" ? "opacity-0" : ""}`}
        />
      )}
    </div>
  );
}
