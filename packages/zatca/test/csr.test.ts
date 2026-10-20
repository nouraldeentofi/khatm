import { createPrivateKey } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCsr, csrForApi, generateEgsKey, type CsrInput, type Environment } from "../src/csr.ts";
import { readChildren, readTlv } from "../src/der.ts";
import { FIXTURES } from "./helpers.ts";

// Data/Input/csr-config-example-EN.properties from the SDK.
const SDK_EXAMPLE: Omit<CsrInput, "environment"> = {
  commonName: "TST-886431145-399999999900003",
  serialNumber: "1-TST|2-TST|3-ed22f1d8-e6a2-1118-9b58-d9a8f11e445f",
  vatNumber: "399999999900003",
  organizationUnit: "Riyadh Branch",
  organizationName: "Maximum Speed Tech Supply LTD",
  invoiceTypes: "1100",
  location: "RRRD2929",
  industry: "Supply activities",
};

const pemBody = (pem: string) => Buffer.from(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
// The SDK labels its key "EC PRIVATE KEY" but writes PKCS#8.
const sdkKey = (env: Environment) =>
  createPrivateKey({ key: pemBody(readFileSync(join(FIXTURES, "sdk-csr", `${env}.key.pem`), "utf8")), format: "der", type: "pkcs8" });
const requestInfo = (der: Buffer) => readChildren(readTlv(der).value)[0]!.raw;

describe("createCsr", () => {
  for (const environment of ["sandbox", "simulation", "production"] as const) {
    it(`produces the same CertificationRequestInfo as the SDK (${environment})`, () => {
      const sdkCsr = pemBody(readFileSync(join(FIXTURES, "sdk-csr", `${environment}.csr`), "utf8"));
      const ours = createCsr({ ...SDK_EXAMPLE, environment }, sdkKey(environment));
      expect(requestInfo(ours.der).toString("hex")).toBe(requestInfo(sdkCsr).toString("hex"));
    });
  }

  it("is self-signed correctly (openssl req -verify) with a fresh key and Arabic names", () => {
    const { privateKeyPem } = generateEgsKey();
    const csr = createCsr(
      { ...SDK_EXAMPLE, environment: "sandbox", organizationName: "شركة توريد التكنولوجيا", organizationUnit: "فرع الرياض" },
      privateKeyPem,
    );
    const out = execFileSync("openssl", ["req", "-verify", "-noout", "-text"], { input: csr.pem, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    expect(out).toContain("TSTZATCA-Code-Signing");
    expect(out).toContain("UID=399999999900003");
  });

  it("encodes the API payload as base64 of the PEM text", () => {
    const csr = createCsr({ ...SDK_EXAMPLE, environment: "sandbox" }, generateEgsKey().privateKeyPem);
    expect(Buffer.from(csrForApi(csr), "base64").toString()).toBe(csr.pem);
  });

  it("rejects malformed serial numbers", () => {
    expect(() => createCsr({ ...SDK_EXAMPLE, environment: "sandbox", serialNumber: "abc" }, generateEgsKey().privateKeyPem)).toThrow(/serial/);
  });
});
