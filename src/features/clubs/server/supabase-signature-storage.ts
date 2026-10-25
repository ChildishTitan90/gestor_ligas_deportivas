import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  PrivateSignatureStorage,
  SignatureMimeType,
} from "./signature-storage";
import { SIGNATURE_MAX_BYTES } from "./signature-validation";

const mimeTypes: readonly SignatureMimeType[] = [
  "image/png",
  "image/jpeg",
  "application/pdf",
];

export class SignatureStorageError extends Error {
  readonly code = "SERVICE_UNAVAILABLE";
  readonly status = 503;

  constructor() {
    super("SERVICE_UNAVAILABLE");
  }
}

function checkKey(key: string): void {
  const parts = key.split("/");

  const valid =
    parts.length === 7 &&
    parts[0] === "affiliation-signatures" &&
    parts[1] === "v1" &&
    ["PRESIDENT", "SECRETARY", "TREASURER"].includes(parts[5]) &&
    [parts[2], parts[3], parts[4], parts[6]].every(
      (value) => z.uuid().safeParse(value).success,
    );

  if (!valid) {
    throw new SignatureStorageError();
  }
}

// Solo lo invocan servicios que ya comprobaron identidad y permisos.
// No importar desde componentes cliente.
export function createSupabaseSignatureStorage() {
  const rawUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_STORAGE_SERVER_KEY;
  const bucketName = process.env.SUPABASE_SIGNATURES_BUCKET;

  if (
    !rawUrl ||
    !key ||
    /\s/.test(key) ||
    !bucketName ||
    !/^[a-z0-9][a-z0-9._-]*$/.test(bucketName)
  ) {
    throw new SignatureStorageError();
  }

  // Mantener el tipo string dentro de las funciones internas.
  const validatedBucketName: string = bucketName;

  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new SignatureStorageError();
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new SignatureStorageError();
  }

  const serverFetch: typeof fetch = (input, options) => {
    const timeout = AbortSignal.timeout(20_000);

    const signal = options?.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;

    return fetch(input, {
      ...options,
      signal,
      cache: "no-store",
    });
  };

  const client = createClient(url.origin, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: serverFetch,
    },
  });

  const bucket = client.storage.from(validatedBucketName);

  async function checkPrivateBucket(): Promise<void> {
    const { data, error } = await client.storage.getBucket(
      validatedBucketName,
    );

    if (
      error ||
      !data ||
      data.public !== false ||
      typeof data.file_size_limit !== "number" ||
      data.file_size_limit <= 0 ||
      data.file_size_limit > SIGNATURE_MAX_BYTES
    ) {
      throw new SignatureStorageError();
    }
  }

  const storage: PrivateSignatureStorage = {
    async put(objectKey, object) {
      checkKey(objectKey);

      if (
        object.bytes.byteLength === 0 ||
        object.bytes.byteLength > SIGNATURE_MAX_BYTES ||
        !mimeTypes.includes(object.mimeType)
      ) {
        throw new SignatureStorageError();
      }

      await checkPrivateBucket();

      const { error } = await bucket.upload(
        objectKey,
        object.bytes,
        {
          contentType: object.mimeType,
          upsert: false,
          cacheControl: "0",
        },
      );

      if (error) {
        throw new SignatureStorageError();
      }
    },

    async read(objectKey) {
      checkKey(objectKey);
      await checkPrivateBucket();

      const { data, error } = await bucket.download(objectKey);

      if (
        error ||
        !data ||
        data.size === 0 ||
        data.size > SIGNATURE_MAX_BYTES
      ) {
        throw new SignatureStorageError();
      }

      const declaredType = data.type
        .split(";")[0]
        .trim()
        .toLowerCase();

      const mimeType = mimeTypes.find(
        (type) => type === declaredType,
      );

      if (!mimeType) {
        throw new SignatureStorageError();
      }

      return {
        bytes: new Uint8Array(await data.arrayBuffer()),
        mimeType,
      };
    },

    async remove(objectKey) {
      checkKey(objectKey);
      await checkPrivateBucket();

      const { error } = await bucket.remove([objectKey]);

      if (error) {
        throw new SignatureStorageError();
      }
    },
  };

  return {
    storage,

    async createUploadUrl(objectKey: string) {
      checkKey(objectKey);
      await checkPrivateBucket();

      const { data, error } = await bucket.createSignedUploadUrl(
        objectKey,
        { upsert: false },
      );

      if (error || !data?.signedUrl) {
        throw new SignatureStorageError();
      }

      return {
        signedUrl: data.signedUrl,
      };
    },

    async createDownloadUrl(objectKey: string) {
      checkKey(objectKey);
      await checkPrivateBucket();

      const { data, error } = await bucket.createSignedUrl(
        objectKey,
        60,
        { download: true },
      );

      if (error || !data?.signedUrl) {
        throw new SignatureStorageError();
      }

      return {
        signedUrl: data.signedUrl,
        expiresInSeconds: 60,
      };
    },
  };
}