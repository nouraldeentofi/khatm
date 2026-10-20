import { randomUUID } from "node:crypto";
import type { Csid, FatooraClient, SubmissionResult } from "./client.ts";
import type { DocumentKind, Audience } from "./codes.ts";
import { createCsr, generateEgsKey, type CsrInput } from "./csr.ts";
import { FIRST_PIH } from "./hash.ts";
import type { InvoiceInput, SellerInput } from "./model.ts";
import { formatRiyadhTime, signInvoice } from "./sign.ts";
import { buildInvoiceXml } from "./xml.ts";

export interface OnboardingInput {
  csr: Omit<CsrInput, "environment">;
  seller: SellerInput;
  otp: string;
}

export interface ComplianceCheck {
  kind: DocumentKind;
  audience: Audience;
  icv: number;
  result: SubmissionResult;
}

export interface OnboardingResult {
  privateKeyPem: string;
  compliance: Csid;
  production: Csid;
  checks: ComplianceCheck[];
  /** Chain state after the compliance documents (test documents; the device's production chain starts at ICV 1). */
  lastIcv: number;
  lastHash: string;
}

export type OnboardingStep =
  | { step: "csr" }
  | { step: "compliance_csid" }
  | { step: "compliance_check"; kind: DocumentKind; audience: Audience; outcome: string }
  | { step: "production_csid" };

/** Buyer used for the standard-invoice compliance samples. */
const COMPLIANCE_BUYER = {
  name: "شركة نماذج فاتورة المحدودة | Fatoora Samples LTD",
  vatNumber: "399999999800003",
  address: { street: "صلاح الدين", buildingNumber: "1111", district: "المروج", city: "الرياض", postalCode: "12222", country: "SA" },
};

/**
 * Takes one EGS unit from OTP to production CSID. Each document type enabled in the CSR
 * (invoice, credit note, debit note × standard/simplified) must pass the compliance checks.
 */
export async function onboardEgs(
  client: FatooraClient,
  input: OnboardingInput,
  onStep: (s: OnboardingStep) => void = () => {},
): Promise<OnboardingResult> {
  if (input.csr.vatNumber !== input.seller.vatNumber) {
    throw new Error("The CSR VAT number must match the seller's VAT number");
  }

  onStep({ step: "csr" });
  const { privateKeyPem } = generateEgsKey();
  const csr = createCsr({ ...input.csr, environment: client.environment }, privateKeyPem);

  onStep({ step: "compliance_csid" });
  const compliance = await client.requestComplianceCsid(csr, input.otp);

  const audiences: Audience[] = [];
  if (input.csr.invoiceTypes[0] === "1") audiences.push("standard");
  if (input.csr.invoiceTypes[1] === "1") audiences.push("simplified");

  const checks: ComplianceCheck[] = [];
  let icv = 0;
  let pih = FIRST_PIH;
  for (const audience of audiences) {
    for (const kind of ["invoice", "credit_note", "debit_note"] as const) {
      icv += 1;
      const now = formatRiyadhTime(new Date());
      const doc: InvoiceInput = {
        kind,
        audience,
        number: `CMP-${icv}`,
        uuid: randomUUID(),
        issueDate: now.slice(0, 10),
        issueTime: now.slice(11, 19),
        icv,
        pih,
        seller: input.seller,
        buyer: audience === "standard" ? COMPLIANCE_BUYER : undefined,
        paymentMeans: "cash",
        ...(kind === "invoice" ? {} : { billingReference: "CMP-1", noteReason: "Compliance check | فحص الامتثال" }),
        lines: [{ name: "Compliance item | صنف فحص", quantity: 1, unitPrice: "100.00" }],
      };
      const { xml } = buildInvoiceXml(doc);
      const signed = signInvoice(xml, { certificate: compliance.binarySecurityToken, privateKey: privateKeyPem });
      const result = await client.checkCompliance(compliance, { xml: signed.xml, hash: signed.hash, uuid: doc.uuid });
      checks.push({ kind, audience, icv, result });
      onStep({ step: "compliance_check", kind, audience, outcome: result.outcome });
      if (result.outcome !== "accepted" && result.outcome !== "accepted_with_warnings") {
        const reasons = result.errors.map((e) => `${e.code}: ${e.message}`).join("; ");
        throw new OnboardingError(`Compliance check failed for ${audience} ${kind}: ${reasons || result.outcome}`, checks);
      }
      pih = signed.hash;
    }
  }

  onStep({ step: "production_csid" });
  const production = await client.requestProductionCsid(compliance);

  return { privateKeyPem, compliance, production, checks, lastIcv: icv, lastHash: pih };
}

export class OnboardingError extends Error {
  constructor(
    message: string,
    readonly checks: ComplianceCheck[],
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}
