// Onboards one EGS unit against ZATCA and, outside production, clears and reports a test invoice.
//
//   pnpm --filter @khatm/zatca onboard --env sandbox
//   pnpm --filter @khatm/zatca onboard --env simulation --otp 123456 --profile ./my-company.json
//
// Writes the private key and CSIDs to <repo>/.zatca/<env>/<commonName>/ (git-ignored, mode 600).
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  FIRST_PIH,
  FatooraClient,
  SANDBOX_OTP,
  buildInvoiceXml,
  formatRiyadhTime,
  onboardEgs,
  signInvoice,
  type Environment,
  type InvoiceInput,
} from "../src/index.ts";

const { values } = parseArgs({
  options: {
    env: { type: "string", default: "sandbox" },
    otp: { type: "string" },
    profile: { type: "string" },
    "no-smoke": { type: "boolean", default: false },
  },
});

const env = values.env as Environment;
if (!["sandbox", "simulation", "production"].includes(env)) throw new Error(`Unknown --env ${env}`);
const otp = values.otp ?? (env === "sandbox" ? SANDBOX_OTP : undefined);
if (!otp) throw new Error("--otp is required outside the sandbox (Fatoora portal → Onboard new solution unit)");

// The sandbox accepts any taxpayer data; this is the SDK's example taxpayer.
const profile = values.profile
  ? JSON.parse(readFileSync(resolve(values.profile), "utf8"))
  : {
      seller: {
        name: "Maximum Speed Tech Supply LTD",
        vatNumber: "399999999900003",
        idScheme: "CRN",
        idValue: "1010010000",
        address: { street: "Prince Sultan", buildingNumber: "2322", district: "Al-Murabba", city: "Riyadh", postalCode: "23333" },
      },
      csr: {
        commonName: `EGS-${randomUUID().slice(0, 8)}`,
        serialNumber: `1-Khatm|2-0.1|3-${randomUUID()}`,
        vatNumber: "399999999900003",
        organizationUnit: "Riyadh Branch",
        organizationName: "Maximum Speed Tech Supply LTD",
        invoiceTypes: "1100",
        location: "RRRD2929",
        industry: "Supply activities",
      },
    };

const client = new FatooraClient(env);
console.log(`Onboarding ${profile.csr.commonName} on ${env}…`);
const result = await onboardEgs(client, { csr: profile.csr, seller: profile.seller, otp }, (s) => {
  if (s.step === "compliance_check") console.log(`  compliance ${s.audience} ${s.kind}: ${s.outcome}`);
  else console.log(`  ${s.step}`);
});

const dir = join(import.meta.dirname, "..", "..", "..", ".zatca", env, profile.csr.commonName);
mkdirSync(dir, { recursive: true });
const save = (name: string, data: string) => {
  writeFileSync(join(dir, name), data);
  chmodSync(join(dir, name), 0o600);
};
save("private-key.pem", result.privateKeyPem);
save("compliance-csid.json", JSON.stringify(result.compliance, null, 2));
save("production-csid.json", JSON.stringify(result.production, null, 2));
save("compliance-checks.json", JSON.stringify(result.checks, null, 2));
console.log(`Production CSID issued. Saved to ${dir}`);

if (env !== "production" && !values["no-smoke"]) {
  const creds = { certificate: result.production.binarySecurityToken, privateKey: result.privateKeyPem };
  let pih = FIRST_PIH;
  for (const [icv, audience] of [[1, "standard"], [2, "simplified"]] as const) {
    const now = formatRiyadhTime(new Date());
    const input: InvoiceInput = {
      kind: "invoice",
      audience,
      number: `SMOKE-${icv}`,
      uuid: randomUUID(),
      issueDate: now.slice(0, 10),
      issueTime: now.slice(11, 19),
      icv,
      pih,
      seller: profile.seller,
      buyer:
        audience === "standard"
          ? {
              name: "Fatoora Samples LTD",
              vatNumber: "399999999800003",
              address: { street: "Salah Al-Din", buildingNumber: "1111", district: "Al-Murooj", city: "Riyadh", postalCode: "12222" },
            }
          : undefined,
      paymentMeans: "cash",
      lines: [{ name: "Smoke test item", quantity: 1, unitPrice: "10.00" }],
    };
    const signed = signInvoice(buildInvoiceXml(input).xml, creds);
    const submission = { xml: signed.xml, hash: signed.hash, uuid: input.uuid };
    const res = audience === "standard" ? await client.clearInvoice(result.production, submission) : await client.reportInvoice(result.production, submission);
    console.log(`  ${audience === "standard" ? "clearance" : "reporting"}: ${res.outcome} (HTTP ${res.httpStatus}) ${res.clearanceStatus ?? res.reportingStatus ?? ""}`);
    for (const m of [...res.errors, ...res.warnings]) console.log(`    ${m.type} ${m.code}: ${m.message}`);
    pih = signed.hash;
  }
}
