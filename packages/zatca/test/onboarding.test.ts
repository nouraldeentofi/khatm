import { describe, expect, it } from "vitest";
import { FatooraClient, SANDBOX_OTP, toSubmissionResult } from "../src/client.ts";
import { invoiceHash } from "../src/hash.ts";
import { onboardEgs, OnboardingError } from "../src/onboarding.ts";
import { SELLER } from "./fixtures/invoices.ts";
import { sdkTestCredentials } from "./helpers.ts";

const CSR = {
  commonName: "EGS-test",
  serialNumber: "1-Fatoora|2-1.0|3-6f4d20e0-6b6b-4f2e-9d8f-111111111111",
  vatNumber: SELLER.vatNumber,
  organizationUnit: "Riyadh Branch",
  organizationName: "Maximum Speed Tech Supply LTD",
  invoiceTypes: "1100" as const,
  location: "RRRD2929",
  industry: "Supply activities",
};

type Call = { method: string; path: string; headers: Record<string, string>; body: Record<string, string> };

/** In-process stand-in for the Fatoora gateway that checks what a real one checks first. */
function fakeZatca(opts: { rejectAt?: number } = {}) {
  const calls: Call[] = [];
  const token = Buffer.from(sdkTestCredentials().certificate).toString("base64");
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname.replace("/e-invoicing/developer-portal", "");
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const body = JSON.parse(String(init?.body));
    calls.push({ method: init?.method ?? "GET", path, headers, body });
    const json = (status: number, payload: unknown) => new Response(JSON.stringify(payload), { status });

    if (path === "/compliance") {
      if (headers.OTP !== SANDBOX_OTP) return json(400, { errors: ["Invalid OTP"] });
      return json(200, { requestID: 1234567890, binarySecurityToken: token, secret: "s3cret", dispositionMessage: "ISSUED" });
    }
    if (path === "/compliance/invoices") {
      const xml = Buffer.from(body.invoice!, "base64").toString("utf8");
      const n = calls.filter((c) => c.path === "/compliance/invoices").length;
      if (invoiceHash(xml) !== body.invoiceHash || n === opts.rejectAt) {
        return json(400, { validationResults: { status: "ERROR", errorMessages: [{ type: "ERROR", code: "invalid-invoice-hash", category: "HASH", message: "bad hash", status: "ERROR" }] } });
      }
      return json(200, { validationResults: { status: "PASS", warningMessages: [], errorMessages: [] } });
    }
    if (path === "/production/csids") return json(200, { requestID: 99, binarySecurityToken: token, secret: "prod-secret" });
    return json(404, {});
  }) as typeof fetch;
  return { calls, client: new FatooraClient("sandbox", { fetch: fetchImpl }) };
}

describe("onboardEgs", () => {
  it("walks CSR → compliance CSID → 6 checks → production CSID with an unbroken chain", async () => {
    const { calls, client } = fakeZatca();
    const steps: string[] = [];
    const result = await onboardEgs(client, { csr: CSR, seller: SELLER, otp: SANDBOX_OTP }, (s) => steps.push(s.step));

    expect(calls.map((c) => c.path)).toEqual([
      "/compliance",
      ...Array(6).fill("/compliance/invoices"),
      "/production/csids",
    ]);
    expect(result.checks.map((c) => `${c.audience}:${c.kind}:${c.result.outcome}`)).toEqual([
      "standard:invoice:accepted",
      "standard:credit_note:accepted",
      "standard:debit_note:accepted",
      "simplified:invoice:accepted",
      "simplified:credit_note:accepted",
      "simplified:debit_note:accepted",
    ]);
    expect(result.production.secret).toBe("prod-secret");
    expect(steps.at(-1)).toBe("production_csid");

    // Headers and auth
    const first = calls[0]!;
    expect(first.headers["Accept-Version"]).toBe("V2");
    expect(Buffer.from(first.body.csr!, "base64").toString()).toContain("BEGIN CERTIFICATE REQUEST");
    const check = calls[1]!;
    const [user, pass] = Buffer.from(check.headers.Authorization!.replace("Basic ", ""), "base64").toString().split(":");
    expect(pass).toBe("s3cret");
    expect(user).toBe(Buffer.from(sdkTestCredentials().certificate).toString("base64"));
    expect(calls.at(-1)!.body).toEqual({ compliance_request_id: "1234567890" });

    // Each compliance document carries the previous one's hash as PIH.
    const docs = calls.filter((c) => c.path === "/compliance/invoices");
    for (let i = 1; i < docs.length; i++) {
      const xml = Buffer.from(docs[i]!.body.invoice!, "base64").toString();
      expect(xml).toContain(`mimeCode="text/plain">${docs[i - 1]!.body.invoiceHash}</cbc:EmbeddedDocumentBinaryObject>`);
      expect(xml).toContain(`<cbc:UUID>${i + 1}</cbc:UUID>`);
    }
  });

  it("stops and reports the failing document when ZATCA rejects a compliance check", async () => {
    const { calls, client } = fakeZatca({ rejectAt: 2 });
    const err = await onboardEgs(client, { csr: CSR, seller: SELLER, otp: SANDBOX_OTP }).catch((e) => e);
    expect(err).toBeInstanceOf(OnboardingError);
    expect(err.message).toContain("standard credit_note");
    expect(calls.some((c) => c.path === "/production/csids")).toBe(false);
  });

  it("only checks simplified documents when the CSR enables simplified only", async () => {
    const { calls, client } = fakeZatca();
    await onboardEgs(client, { csr: { ...CSR, invoiceTypes: "0100" }, seller: SELLER, otp: SANDBOX_OTP });
    expect(calls.filter((c) => c.path === "/compliance/invoices")).toHaveLength(3);
  });
});

describe("toSubmissionResult", () => {
  it("maps HTTP statuses to outcomes", () => {
    expect(toSubmissionResult(200, {}).outcome).toBe("accepted");
    expect(toSubmissionResult(202, {}).outcome).toBe("accepted_with_warnings");
    expect(toSubmissionResult(303, {}).outcome).toBe("clearance_disabled");
    expect(toSubmissionResult(400, {}).outcome).toBe("rejected");
    expect(toSubmissionResult(401, {}).outcome).toBe("unauthorized");
    expect(toSubmissionResult(503, {}).outcome).toBe("retryable");
  });

  it("decodes the cleared invoice", () => {
    const r = toSubmissionResult(200, { clearanceStatus: "CLEARED", clearedInvoice: Buffer.from("<Invoice/>").toString("base64") });
    expect(r.clearedInvoiceXml).toBe("<Invoice/>");
    expect(r.clearanceStatus).toBe("CLEARED");
  });
});
