import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { auditLog, customers, devices, invoiceLines, invoices, organizations, type Db } from "@khatm/db";
import {
  FIRST_PIH,
  buildInvoiceXml,
  fmt,
  formatRiyadhTime,
  signInvoice,
  toPlain,
  type Audience,
  type DocumentKind,
  type InvoiceInput,
} from "@khatm/zatca";
import type { SecretBox } from "./secrets.ts";
import type { StorageAdapter } from "./storage.ts";

export interface CoreContext {
  db: Db;
  storage: StorageAdapter;
  secrets: SecretBox;
  now?: () => Date;
}

export interface IssueRequest {
  orgId: string;
  deviceId: string;
  userId?: string;
  kind: DocumentKind;
  audience: Audience;
  customerId?: string;
  /** Walk-in buyer for a simplified invoice without a customer record. */
  buyer?: InvoiceInput["buyer"];
  /** Credit/debit notes: the invoice being corrected. */
  originalInvoiceId?: string;
  noteReason?: string;
  supplyDate?: string;
  supplyEndDate?: string;
  note?: string;
  paymentMeans?: InvoiceInput["paymentMeans"];
  lines: InvoiceInput["lines"];
  allowances?: InvoiceInput["allowances"];
}

export interface IssuedInvoice {
  id: string;
  number: string;
  uuid: string;
  icv: number;
  hash: string;
}

export class IssueError extends Error {
  constructor(
    message: string,
    readonly code: "device_not_active" | "not_found" | "invalid",
  ) {
    super(message);
    this.name = "IssueError";
  }
}

/**
 * Issues one document on one EGS unit. The device row is locked for the whole
 * transaction, so ICV and PIH are taken, signed and advanced atomically: concurrent
 * requests on the same device queue up, and a failure anywhere rolls back everything,
 * leaving no gap. Submission to ZATCA happens afterwards, outside the lock.
 */
export async function issueInvoice(ctx: CoreContext, req: IssueRequest): Promise<IssuedInvoice> {
  const { db } = ctx;

  const [customer, original] = await Promise.all([
    req.customerId
      ? db.query.customers.findFirst({ where: and(eq(customers.id, req.customerId), eq(customers.orgId, req.orgId)) })
      : undefined,
    req.originalInvoiceId
      ? db.query.invoices.findFirst({ where: and(eq(invoices.id, req.originalInvoiceId), eq(invoices.orgId, req.orgId)) })
      : undefined,
  ]);
  if (req.customerId && !customer) throw new IssueError("Customer not found", "not_found");
  if (req.originalInvoiceId && !original) throw new IssueError("Original invoice not found", "not_found");

  const buyer = customer ? customerToBuyer(customer) : req.buyer;
  const draft = (base: Pick<InvoiceInput, "number" | "uuid" | "issueDate" | "issueTime" | "icv" | "pih" | "seller">): InvoiceInput => ({
    ...base,
    kind: req.kind,
    audience: req.audience,
    buyer,
    billingReference: original?.number,
    noteReason: req.noteReason,
    supplyDate: req.supplyDate,
    supplyEndDate: req.supplyEndDate,
    note: req.note,
    paymentMeans: req.paymentMeans,
    lines: req.lines,
    allowances: req.allowances,
  });

  // Validate before taking any lock, so bad input never holds up the device queue.
  const preview = await db.query.organizations.findFirst({ where: eq(organizations.id, req.orgId) });
  if (!preview) throw new IssueError("Organization not found", "not_found");
  try {
    buildInvoiceXml(draft({ number: "PREVIEW", uuid: randomUUID(), issueDate: "2026-01-01", issueTime: "00:00:00", icv: 1, pih: FIRST_PIH, seller: orgToSeller(preview) }));
  } catch (err) {
    throw new IssueError(err instanceof Error ? err.message : String(err), "invalid");
  }

  return db.transaction(async (tx) => {
    const [device] = await tx
      .select()
      .from(devices)
      .where(and(eq(devices.id, req.deviceId), eq(devices.orgId, req.orgId)))
      .for("update");
    if (!device) throw new IssueError("Device not found", "not_found");
    if (device.status !== "active" || !device.privateKeyEnc || !device.csidToken) {
      throw new IssueError("Device is not onboarded with ZATCA", "device_not_active");
    }

    const [org] = await tx
      .update(organizations)
      .set({ lastInvoiceSeq: sql`${organizations.lastInvoiceSeq} + 1` })
      .where(eq(organizations.id, req.orgId))
      .returning();
    const number = `${org!.invoicePrefix}${String(org!.lastInvoiceSeq).padStart(6, "0")}`;

    const now = formatRiyadhTime(ctx.now?.() ?? new Date());
    const uuid = randomUUID();
    const icv = device.lastIcv + 1;
    const { xml, invoice, totals } = buildInvoiceXml(
      draft({ number, uuid, issueDate: now.slice(0, 10), issueTime: now.slice(11, 19), icv, pih: device.lastHash, seller: orgToSeller(org!) }),
    );
    const signed = signInvoice(xml, {
      certificate: device.csidToken,
      privateKey: ctx.secrets.decrypt(device.privateKeyEnc),
    });

    const xmlKey = await ctx.storage.put(`org/${req.orgId}/invoices/${invoice.issueDate.slice(0, 7)}/${uuid}.xml`, signed.xml);

    const [row] = await tx
      .insert(invoices)
      .values({
        orgId: req.orgId,
        deviceId: device.id,
        customerId: customer?.id,
        kind: req.kind,
        audience: req.audience,
        number,
        uuid,
        icv,
        pih: device.lastHash,
        hash: signed.hash,
        qr: signed.qr,
        issueDate: invoice.issueDate,
        issueTime: invoice.issueTime,
        supplyDate: invoice.supplyDate ?? (req.audience === "standard" ? invoice.issueDate : null),
        currency: invoice.currency,
        buyerName: buyer?.name,
        lineExtension: fmt(totals.lineExtension),
        allowanceTotal: fmt(totals.allowanceTotal),
        taxExclusive: fmt(totals.taxExclusive),
        vatTotal: fmt(totals.vatTotal),
        taxInclusive: fmt(totals.taxInclusive),
        payable: fmt(totals.payable),
        originalInvoiceId: original?.id,
        billingReference: original?.number,
        noteReason: req.noteReason,
        xmlKey,
        createdBy: req.userId,
      })
      .returning({ id: invoices.id });

    await tx.insert(invoiceLines).values(
      totals.lines.map((l, i) => ({
        invoiceId: row!.id,
        position: i + 1,
        name: invoice.lines[i]!.name,
        quantity: toPlain(l.quantity),
        unitCode: invoice.lines[i]!.unitCode,
        unitPrice: toPlain(l.unitPrice),
        discount: fmt(l.discount),
        taxCategory: l.tax.category,
        taxPercent: fmt(l.tax.percent),
        exemptionCode: l.tax.exemptionCode,
        net: fmt(l.net),
        vat: fmt(l.vat),
        total: fmt(l.total),
      })),
    );

    await tx.update(devices).set({ lastIcv: icv, lastHash: signed.hash }).where(eq(devices.id, device.id));

    await tx.insert(auditLog).values({
      orgId: req.orgId,
      userId: req.userId,
      action: "invoice.issued",
      entity: "invoice",
      entityId: row!.id,
      after: { number, icv, hash: signed.hash, kind: req.kind, audience: req.audience, payable: fmt(totals.payable) },
    });

    return { id: row!.id, number, uuid, icv, hash: signed.hash };
  });
}

type OrgRow = typeof organizations.$inferSelect;
type CustomerRow = typeof customers.$inferSelect;

function orgToSeller(o: OrgRow) {
  return {
    name: o.legalName,
    vatNumber: o.vatNumber,
    idScheme: o.idScheme as "CRN",
    idValue: o.idValue,
    address: {
      street: o.street,
      additionalStreet: o.additionalStreet ?? undefined,
      buildingNumber: o.buildingNumber,
      additionalNumber: o.additionalNumber ?? undefined,
      district: o.district,
      city: o.city,
      postalCode: o.postalCode,
      region: o.region ?? undefined,
    },
  };
}

function customerToBuyer(c: CustomerRow): NonNullable<InvoiceInput["buyer"]> {
  const hasAddress = c.street && c.buildingNumber && c.district && c.city && c.postalCode;
  return {
    name: c.name,
    vatNumber: c.vatNumber ?? undefined,
    idScheme: (c.idScheme ?? undefined) as "CRN" | undefined,
    idValue: c.idValue ?? undefined,
    address: hasAddress
      ? {
          street: c.street!,
          additionalStreet: c.additionalStreet ?? undefined,
          buildingNumber: c.buildingNumber!,
          additionalNumber: c.additionalNumber ?? undefined,
          district: c.district!,
          city: c.city!,
          postalCode: c.postalCode!,
          country: c.country,
        }
      : undefined,
  };
}
