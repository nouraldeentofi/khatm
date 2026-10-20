import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SCRIPT = join(ROOT, "scripts", "zatca-sdk.sh");
const JAVA = process.env.ZATCA_JAVA ?? "/usr/lib/jvm/java-11-openjdk-amd64/bin/java";

/** The official SDK is only available where tools/zatca-sdk and Java 11 are installed. */
export const sdkAvailable = existsSync(join(ROOT, "tools", "zatca-sdk", "Apps")) && existsSync(JAVA);

export interface SdkResult {
  passed: boolean;
  /** Error lines ("CODE : X, MESSAGE : Y"). */
  errors: string[];
  warnings: string[];
  output: string;
}

/**
 * The SDK checks the invoice's PIH against a file (Data/PIH/pih.txt, the first-invoice
 * value). Pass `pih` to validate a document further down a chain.
 */
export async function sdkValidate(xml: string, name = "invoice.xml", opts: { pih?: string } = {}): Promise<SdkResult> {
  const dir = mkdtempSync(join(tmpdir(), "zatca-sdk-"));
  const file = join(dir, name);
  writeFileSync(file, xml);
  const env = { ...process.env };
  if (opts.pih) {
    const config = JSON.parse(readFileSync(join(ROOT, "tools", "zatca-sdk", "Configuration", "config.json"), "utf8"));
    writeFileSync(join(dir, "pih.txt"), opts.pih);
    writeFileSync(join(dir, "config.json"), JSON.stringify({ ...config, pihPath: join(dir, "pih.txt") }));
    env.SDK_CONFIG = join(dir, "config.json");
  }
  const { stdout, stderr } = await promisify(execFile)(SCRIPT, ["-validate", "-invoice", file], {
    cwd: dir,
    env,
    maxBuffer: 10 * 1024 * 1024,
  }).catch((e: { stdout?: string; stderr?: string }) => ({ stdout: e.stdout ?? "", stderr: e.stderr ?? "" }));
  const output = `${stdout}\n${stderr}`;
  const lines = output.split("\n");
  return {
    passed: /GLOBAL VALIDATION RESULT = PASSED/.test(output),
    errors: lines.filter((l) => l.includes("[ERROR]") && l.includes("CODE :")).map(clean),
    warnings: lines.filter((l) => l.includes("[WARN]") && l.includes("CODE :")).map(clean),
    output,
  };
}

function clean(line: string): string {
  return line.replace(/^.*? - CODE :/, "CODE :").trim();
}
