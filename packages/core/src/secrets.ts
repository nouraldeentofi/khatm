import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for device private keys and CSID secrets. The 32-byte master key lives only
 * in the server's environment (later: a KMS), never in the database or its backups.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(masterKeyBase64: string) {
    this.key = Buffer.from(masterKeyBase64, "base64");
    if (this.key.length !== 32) throw new Error("Master key must be 32 bytes (base64)");
  }

  static generateKey(): string {
    return randomBytes(32).toString("base64");
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
  }

  decrypt(sealed: string): string {
    if (!sealed.startsWith("v1:")) throw new Error("Unknown secret format");
    const raw = Buffer.from(sealed.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  }
}
