import { csrForApi, type Environment, type GeneratedCsr } from "./csr.ts";

export const FATOORA_BASE_URL: Record<Environment, string> = {
  sandbox: "https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal",
  simulation: "https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation",
  production: "https://gw-fatoora.zatca.gov.sa/e-invoicing/core",
};

/** The developer portal (sandbox) accepts this fixed OTP. */
export const SANDBOX_OTP = "123345";

/** Credentials ZATCA returns for a compliance or production CSID. */
export interface Csid {
  requestId: string;
  /** base64(base64(DER certificate)) — usable directly as the signing certificate. */
  binarySecurityToken: string;
  secret: string;
  dispositionMessage?: string;
}

export interface ValidationMessage {
  type: string;
  code: string;
  category: string;
  message: string;
  status: string;
}

export type SubmissionOutcome =
  | "accepted"
  | "accepted_with_warnings"
  | "rejected"
  /** 303: ZATCA has switched clearance off; report the invoice instead. */
  | "clearance_disabled"
  /** 401/403: the CSID is wrong, revoked or expired. */
  | "unauthorized"
  /** 429, 5xx, timeouts, network errors: safe to retry with the same XML. */
  | "retryable";

export interface SubmissionResult {
  outcome: SubmissionOutcome;
  httpStatus: number;
  warnings: ValidationMessage[];
  errors: ValidationMessage[];
  /** The XML ZATCA stamped on clearance — this, not ours, is the legal copy. */
  clearedInvoiceXml?: string;
  clearanceStatus?: string;
  reportingStatus?: string;
  /** Raw response body for the submissions log. */
  body: unknown;
}

export interface SignedSubmission {
  xml: string;
  hash: string;
  uuid: string;
}

export class FatooraError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "FatooraError";
  }
}

export interface ClientOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Language of ZATCA's validation messages. */
  language?: "ar" | "en";
  baseUrl?: string;
}

export class FatooraClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(
    readonly environment: Environment,
    private readonly options: ClientOptions = {},
  ) {
    this.baseUrl = options.baseUrl ?? FATOORA_BASE_URL[environment];
    this.fetchImpl = options.fetch ?? fetch;
  }

  /** Step 1: CSR + OTP from the Fatoora portal → compliance CSID. */
  async requestComplianceCsid(csr: GeneratedCsr, otp: string): Promise<Csid> {
    const res = await this.call("POST", "/compliance", { csr: csrForApi(csr) }, { OTP: otp });
    return this.csid(res, "compliance CSID");
  }

  /** Step 2: each document type enabled in the CSR must pass here before a production CSID is issued. */
  checkCompliance(auth: Csid, invoice: SignedSubmission): Promise<SubmissionResult> {
    return this.submit("/compliance/invoices", auth, invoice);
  }

  /** Step 3: compliance request id → production CSID. */
  async requestProductionCsid(complianceAuth: Csid): Promise<Csid> {
    const res = await this.call(
      "POST",
      "/production/csids",
      { compliance_request_id: complianceAuth.requestId },
      {},
      complianceAuth,
    );
    return this.csid(res, "production CSID");
  }

  /** Renewal before expiry: new CSR + new OTP, authenticated with the current production CSID. */
  async renewProductionCsid(productionAuth: Csid, csr: GeneratedCsr, otp: string): Promise<Csid> {
    const res = await this.call("PATCH", "/production/csids", { csr: csrForApi(csr) }, { OTP: otp }, productionAuth);
    return this.csid(res, "renewed production CSID");
  }

  /** Standard (B2B) invoices: must be cleared before they reach the buyer. */
  clearInvoice(auth: Csid, invoice: SignedSubmission): Promise<SubmissionResult> {
    return this.submit("/invoices/clearance/single", auth, invoice, { "Clearance-Status": "1" });
  }

  /** Simplified (B2C) invoices: report within 24 hours of issuing. */
  reportInvoice(auth: Csid, invoice: SignedSubmission): Promise<SubmissionResult> {
    return this.submit("/invoices/reporting/single", auth, invoice, { "Clearance-Status": "0" });
  }

  private async submit(
    path: string,
    auth: Csid,
    invoice: SignedSubmission,
    headers: Record<string, string> = {},
  ): Promise<SubmissionResult> {
    const payload = {
      invoiceHash: invoice.hash,
      uuid: invoice.uuid,
      invoice: Buffer.from(invoice.xml, "utf8").toString("base64"),
    };
    let res: { status: number; body: unknown };
    try {
      res = await this.call("POST", path, payload, headers, auth);
    } catch (err) {
      if (err instanceof FatooraError) throw err;
      return { outcome: "retryable", httpStatus: 0, warnings: [], errors: [], body: { error: String(err) } };
    }
    return toSubmissionResult(res.status, res.body);
  }

  private csid(res: { status: number; body: unknown }, what: string): Csid {
    const b = res.body as Record<string, unknown> | null;
    if (res.status !== 200 || !b?.binarySecurityToken || !b.secret) {
      throw new FatooraError(`ZATCA refused the ${what} (HTTP ${res.status})`, res.status, res.body);
    }
    return {
      requestId: String(b.requestID),
      binarySecurityToken: String(b.binarySecurityToken),
      secret: String(b.secret),
      dispositionMessage: b.dispositionMessage ? String(b.dispositionMessage) : undefined,
    };
  }

  private async call(
    method: "POST" | "PATCH",
    path: string,
    body: unknown,
    headers: Record<string, string>,
    auth?: Csid,
  ): Promise<{ status: number; body: unknown }> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": this.options.language ?? "en",
        "Accept-Version": "V2",
        ...(auth
          ? { Authorization: `Basic ${Buffer.from(`${auth.binarySecurityToken}:${auth.secret}`).toString("base64")}` }
          : {}),
        ...headers,
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // ZATCA occasionally answers with plain text (e.g. gateway errors); keep it raw.
    }
    return { status: res.status, body: parsed };
  }
}

export function toSubmissionResult(httpStatus: number, body: unknown): SubmissionResult {
  const b = (body ?? {}) as Record<string, unknown>;
  const v = (b.validationResults ?? {}) as Record<string, unknown>;
  const list = (x: unknown) => (Array.isArray(x) ? (x as ValidationMessage[]) : []);
  const warnings = list(v.warningMessages);
  const errors = list(v.errorMessages);

  let outcome: SubmissionOutcome;
  if (httpStatus === 200) outcome = warnings.length ? "accepted_with_warnings" : "accepted";
  else if (httpStatus === 202) outcome = "accepted_with_warnings";
  else if (httpStatus === 303) outcome = "clearance_disabled";
  else if (httpStatus === 400) outcome = "rejected";
  else if (httpStatus === 401 || httpStatus === 403) outcome = "unauthorized";
  else outcome = "retryable";

  return {
    outcome,
    httpStatus,
    warnings,
    errors,
    clearedInvoiceXml:
      typeof b.clearedInvoice === "string" ? Buffer.from(b.clearedInvoice, "base64").toString("utf8") : undefined,
    clearanceStatus: typeof b.clearanceStatus === "string" ? b.clearanceStatus : undefined,
    reportingStatus: typeof b.reportingStatus === "string" ? b.reportingStatus : undefined,
    body,
  };
}
