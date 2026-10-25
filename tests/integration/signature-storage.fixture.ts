import type {
  PrivateSignatureStorage,
  StoredSignatureObject,
} from "../../src/features/clubs/server/signature-storage";

function copy(object: StoredSignatureObject): StoredSignatureObject {
  return {
    bytes: new Uint8Array(object.bytes),
    mimeType: object.mimeType,
  };
}

// Exclusivo de pruebas. Cada instancia mantiene sus propios objetos.
// No importarlo desde src/ ni usarlo como fallback de producción.
export class SignatureStorageFixture implements PrivateSignatureStorage {
  private readonly objects = new Map<string, StoredSignatureObject>();

  private failure: "put" | "read" | "remove" | undefined;

  failNext(operation: "put" | "read" | "remove"): void {
    this.failure = operation;
  }

  private checkFailure(operation: "put" | "read" | "remove"): void {
    if (this.failure === operation) {
      this.failure = undefined;
      throw new Error("SYNTHETIC_STORAGE_FAILURE");
    }
  }

  async put(
    key: string,
    object: StoredSignatureObject,
  ): Promise<void> {
    this.checkFailure("put");

    // Una firma existente no puede sobrescribirse silenciosamente.
    if (this.objects.has(key)) {
      throw new Error("SIGNATURE_OBJECT_EXISTS");
    }

    this.objects.set(key, copy(object));
  }

  async read(key: string): Promise<StoredSignatureObject> {
    this.checkFailure("read");

    const object = this.objects.get(key);

    if (!object) {
      throw new Error("SIGNATURE_OBJECT_NOT_FOUND");
    }

    return copy(object);
  }

  async remove(key: string): Promise<void> {
    this.checkFailure("remove");
    this.objects.delete(key);
  }
}