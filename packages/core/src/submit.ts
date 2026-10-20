import { eq, sql } from "drizzle-orm";
import { auditLog, devices, invoices, submissions } from "@fatoora/db";
import type { FatooraClient, SubmissionResult } from "@fatoora/zatca";
import type { CoreContext } from "./issue.ts";

export const MAX_ATTEMPTS = 8;

export type SubmitOutcome = "accepted" | "accepted_with_warnings" | "rejected" | "retry" | "failed" | "skipped";

/**
 * Sends one pending invoice to ZATCA: clearance for standard, reporting for simplified.
 * Safe to call repeatedly (the queue retries it): only `pending` invoices are sent, and
 * the XML sent is always the stored, already-chained document.
 */
export async function submitInvoice(
  ctx: CoreContext & { client: FatooraClient },
  invoiceId: string,
): Promise<SubmitOutcome> {
  const { db } = ctx;
  const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId) });
  if (!inv || inv.status !== "pending") return "skipped";
  const device = await db.query.devices.findFirst({ where: eq(devices.id, inv.deviceId) });
  if (!device?.csidToken || !device.csidSecretEnc) throw new Error(`Device ${inv.deviceId} has no production CSID`);

  const auth = { requestId: "", binarySecurityToken: device.csidToken, secret: ctx.secrets.decrypt(device.csidSecretEnc) };
  const payload = { xml: (await ctx.storage.get(inv.xmlKey)).toString("utf8"), hash: inv.hash, uuid: inv.uuid };

  const started = Date.now();
  let endpoint = inv.audience === "standard" ? "clearance" : "reporting";
  let result: SubmissionResult =
    inv.audience === "standard" ? await ctx.client.clearInvoice(auth, payload) : await ctx.client.reportInvoice(auth, payload);
  if (result.outcome === "clearance_disabled") {
    // ZATCA can switch clearance off; standard invoices are then reported instead.
    endpoint = "reporting";
    result = await ctx.client.reportInvoice(auth, payload);
  }

  await db.insert(submissions).values({
    invoiceId: inv.id,
    endpoint,
    httpStatus: result.httpStatus,
    outcome: result.outcome,
    response: result.body as object,
    durationMs: Date.now() - started,
  });

  const attempts = inv.attempts + 1;
  if (result.outcome === "accepted" || result.outcome === "accepted_with_warnings") {
    const clearedXmlKey = result.clearedInvoiceXml
      ? await ctx.storage.put(inv.xmlKey.replace(/\.xml$/, ".cleared.xml"), result.clearedInvoiceXml)
      : undefined;
    await finish(ctx, inv.id, inv.orgId, result.outcome, attempts, result, clearedXmlKey);
    return result.outcome;
  }
  if (result.outcome === "rejected") {
    await finish(ctx, inv.id, inv.orgId, "rejected", attempts, result);
    return "rejected";
  }
  // retryable / unauthorized / unexpected: keep it pending until the attempts run out.
  if (attempts >= MAX_ATTEMPTS) {
    await finish(ctx, inv.id, inv.orgId, "failed", attempts, result);
    return "failed";
  }
  await db.update(invoices).set({ attempts: sql`${invoices.attempts} + 1` }).where(eq(invoices.id, inv.id));
  return "retry";
}

async function finish(
  ctx: CoreContext,
  id: string,
  orgId: string,
  status: "accepted" | "accepted_with_warnings" | "rejected" | "failed",
  attempts: number,
  result: SubmissionResult,
  clearedXmlKey?: string,
): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    await tx
      .update(invoices)
      .set({ status, attempts, zatcaResponse: result.body as object, submittedAt: new Date(), clearedXmlKey })
      .where(eq(invoices.id, id));
    await tx.insert(auditLog).values({
      orgId,
      action: `invoice.${status}`,
      entity: "invoice",
      entityId: id,
      after: { httpStatus: result.httpStatus, errors: result.errors.map((e) => e.code), warnings: result.warnings.map((w) => w.code) },
    });
  });
}
