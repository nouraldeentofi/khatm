import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize } from "node:path";

/**
 * The only way the app touches files. Local disk today; S3-compatible storage inside the
 * Kingdom later — same calls, different adapter.
 */
export interface StorageAdapter {
  put(key: string, data: Buffer | string): Promise<string>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
}

export class LocalFsStorage implements StorageAdapter {
  constructor(private readonly root: string) {}

  async put(key: string, data: Buffer | string): Promise<string> {
    const path = this.resolve(key);
    await mkdir(dirname(path), { recursive: true });
    // Write-then-rename so a crash never leaves a half-written invoice behind.
    const tmp = `${path}.${process.pid}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
    return key;
  }

  get(key: string): Promise<Buffer> {
    return readFile(this.resolve(key));
  }

  async exists(key: string): Promise<boolean> {
    return stat(this.resolve(key)).then(
      () => true,
      () => false,
    );
  }

  private resolve(key: string): string {
    const clean = normalize(key);
    if (clean.startsWith("..") || clean.startsWith("/")) throw new Error(`Invalid storage key: ${key}`);
    return join(this.root, clean);
  }
}
