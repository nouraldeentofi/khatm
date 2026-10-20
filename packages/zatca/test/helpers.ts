import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export const FIXTURES = join(import.meta.dirname, "fixtures");

export function sdkSamples(): Array<{ name: string; xml: string }> {
  const dir = join(FIXTURES, "sdk-samples");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".xml"))
    .sort()
    .map((name) => ({ name, xml: readFileSync(join(dir, name), "utf8") }));
}

/** The SDK's public test certificate and its key (bare base64, no PEM armour). */
export function sdkTestCredentials(): { certificate: string; privateKey: string } {
  const cert = readFileSync(join(FIXTURES, "sdk-cert", "cert.pem"), "utf8").trim();
  const key = readFileSync(join(FIXTURES, "sdk-cert", "ec-secp256k1-priv-key.pem"), "utf8").trim();
  return {
    certificate: cert,
    privateKey: `-----BEGIN EC PRIVATE KEY-----\n${key.match(/.{1,64}/g)!.join("\n")}\n-----END EC PRIVATE KEY-----\n`,
  };
}

export function tagValue(xml: string, tag: string, attrFilter = ""): string {
  const re = new RegExp(`<${tag}${attrFilter}[^>]*>([^<]*)</${tag}>`);
  const m = xml.match(re);
  if (!m) throw new Error(`${tag} not found`);
  return m[1]!;
}

export function qrOf(xml: string): string {
  const m = xml.match(/<cbc:ID>QR<\/cbc:ID>[\s\S]*?<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]+)</);
  if (!m) throw new Error("QR not found");
  return m[1]!;
}

export function invoiceDigestValue(xml: string): string {
  const m = xml.match(/<ds:Reference Id="invoiceSignedData"[\s\S]*?<ds:DigestValue>([^<]+)<\/ds:DigestValue>/);
  if (!m) throw new Error("invoiceSignedData digest not found");
  return m[1]!;
}
