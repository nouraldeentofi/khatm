import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asc, eq, sql } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, customers, devices, invoices, organizations, runMigrations, submissions, type Db } from "@khatm/db";
import { FIRST_PIH, invoiceHash, toSubmissionResult, type FatooraClient } from "@khatm/zatca";
import { IssueError, LocalFsStorage, SecretBox, issueInvoice, submitInvoice, type CoreContext } from "../src/index.ts";
import { sdkAvailable, sdkValidate } from "../../zatca/test/sdk.ts";

const ADMIN_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const dbName = `fatoora_test_${randomUUID().slice(0, 8)}`;
const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
const pgUp = await admin`select 1`.then(() => true, () => false);
// With TEST_DATABASE_URL set (CI), an unreachable database fails the run instead of skipping it.
const pgRequired = Boolean(process.env.TEST_DATABASE_URL);

const fixtures = join(import.meta.dirname, "..", "..", "zatca", "test", "fixtures", "sdk-cert");
const certificate = readFileSync(join(fixtures, "cert.pem"), "utf8").trim();
const keyBody = readFileSync(join(fixtures, "ec-secp256k1-priv-key.pem"), "utf8").trim();
const privateKeyPem = `-----BEGIN EC PRIVATE KEY-----\n${keyBody.match(/.{1,64}/g)!.join("\n")}\n-----END EC PRIVATE KEY-----\n`;

describe.runIf(pgUp || pgRequired)("issueInvoice against PostgreSQL", () => {
  let db: Db;
  let ctx: CoreContext;
  let orgId: string;
  let deviceId: string;
  let customerId: string;

  beforeAll(async () => {
    await admin.unsafe(`create database ${dbName}`);
    const url = ADMIN_URL.replace(/\/[^/]*$/, `/${dbName}`);
    await runMigrations(url);
    db = createDb(url, { max: 20 });
    const secrets = new SecretBox(SecretBox.generateKey());
    ctx = { db, secrets, storage: new LocalFsStorage(mkdtempSync(join(tmpdir(), "fatoora-files-"))) };

    const [org] = await db
      .insert(organizations)
      .values({
        legalName: "شركة توريد التكنولوجيا بأقصى سرعة المحدودة | Maximum Speed Tech Supply LTD",
        vatNumber: "399999999900003",
        idValue: "1010010000",
        street: "الامير سلطان",
        buildingNumber: "2322",
        district: "المربع",
        city: "الرياض",
        postalCode: "23333",
      })
      .returning();
    orgId = org!.id;
    const [device] = await db
      .insert(devices)
      .values({
        orgId,
        name: "الفرع الرئيسي",
        branch: "Riyadh Branch",
        environment: "sandbox",
        status: "active",
        commonName: "EGS-test",
        serialNumber: "1-Khatm|2-0.1|3-test",
        privateKeyEnc: secrets.encrypt(privateKeyPem),
        csidToken: Buffer.from(certificate).toString("base64"),
        csidSecretEnc: secrets.encrypt("secret"),
      })
      .returning();
    deviceId = device!.id;
    const [customer] = await db
      .insert(customers)
      .values({
        orgId,
        name: "شركة الخليج للمقاولات",
        vatNumber: "399999999800003",
        street: "صلاح الدين",
        buildingNumber: "1111",
        district: "المروج",
        city: "الرياض",
        postalCode: "12222",
      })
      .returning();
    customerId = customer!.id;
  });

  afterAll(async () => {
    await db?.$client.end();
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  const line = { name: "توريد مضخات", quantity: 2, unitPrice: "350.00" };

  it("issues 100 documents concurrently on one device with a gapless ICV/PIH chain", async () => {
    const results = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        issueInvoice(ctx, {
          orgId,
          deviceId,
          kind: "invoice",
          audience: i % 3 === 0 ? "standard" : "simplified",
          customerId: i % 3 === 0 ? customerId : undefined,
          paymentMeans: "cash",
          lines: [line],
        }),
      ),
    );
    expect(new Set(results.map((r) => r.icv)).size).toBe(100);

    const rows = await db.select().from(invoices).where(eq(invoices.deviceId, deviceId)).orderBy(asc(invoices.icv));
    expect(rows.map((r) => r.icv)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(rows.map((r) => r.number)).toEqual(Array.from({ length: 100 }, (_, i) => `INV-${String(i + 1).padStart(6, "0")}`).sort());
    expect(rows[0]!.pih).toBe(FIRST_PIH);
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.pih).toBe(rows[i - 1]!.hash);

    // The stored XML is exactly what was hashed and chained.
    for (const r of rows) {
      const xml = (await ctx.storage.get(r.xmlKey)).toString("utf8");
      expect(invoiceHash(xml)).toBe(r.hash);
      expect(xml).toContain(`<cbc:UUID>${r.icv}</cbc:UUID>`);
      expect(xml).toContain(`mimeCode="text/plain">${r.pih}</cbc:EmbeddedDocumentBinaryObject>`);
    }

    const device = await db.query.devices.findFirst({ where: eq(devices.id, deviceId) });
    expect(device!.lastIcv).toBe(100);
    expect(device!.lastHash).toBe(rows.at(-1)!.hash);
  }, 60_000);

  it.runIf(sdkAvailable)("produces documents the official SDK accepts", async () => {
    const rows = await db.select().from(invoices).where(eq(invoices.deviceId, deviceId)).orderBy(asc(invoices.icv)).limit(2);
    for (const r of rows) {
      const result = await sdkValidate((await ctx.storage.get(r.xmlKey)).toString("utf8"), `${r.number}.xml`, { pih: r.pih });
      expect(result.errors, r.number).toEqual([]);
      expect(result.passed).toBe(true);
    }
  }, 120_000);

  it("rejects invalid input before consuming an ICV or invoice number", async () => {
    const before = await db.query.devices.findFirst({ where: eq(devices.id, deviceId) });
    const err = await issueInvoice(ctx, { orgId, deviceId, kind: "credit_note", audience: "simplified", lines: [line] }).catch((e) => e);
    expect(err).toBeInstanceOf(IssueError);
    expect(err.code).toBe("invalid");
    const after = await db.query.devices.findFirst({ where: eq(devices.id, deviceId) });
    expect(after!.lastIcv).toBe(before!.lastIcv);
  });

  it("issues a credit note referencing the original invoice", async () => {
    const original = await db.query.invoices.findFirst({ where: eq(invoices.icv, 1) });
    const note = await issueInvoice(ctx, {
      orgId,
      deviceId,
      kind: "credit_note",
      audience: original!.audience,
      customerId: original!.customerId ?? undefined,
      originalInvoiceId: original!.id,
      noteReason: "إرجاع بضاعة",
      lines: [line],
    });
    const xml = (await ctx.storage.get((await db.query.invoices.findFirst({ where: eq(invoices.id, note.id) }))!.xmlKey)).toString();
    expect(xml).toContain(`<cbc:ID>${original!.number}</cbc:ID>`);
    expect(xml).toContain(">381</cbc:InvoiceTypeCode>");
  });

  describe("database guards", () => {
    const fails = (q: Promise<unknown>) => expect(q).rejects.toThrow();

    it("forbids editing or deleting an issued invoice", async () => {
      await fails(db.execute(sql`update invoices set payable = '1.00' where icv = 1`));
      await fails(db.execute(sql`delete from invoices where icv = 1`));
    });

    it("forbids moving the device counter backwards, skipping, or advancing without the hash", async () => {
      await fails(db.execute(sql`update devices set last_icv = 5 where id = ${deviceId}`));
      await fails(db.execute(sql`update devices set last_icv = last_icv + 2 where id = ${deviceId}`));
      await fails(db.execute(sql`update devices set last_icv = last_icv + 1 where id = ${deviceId}`));
    });

    it("keeps the audit log append-only", async () => {
      await fails(db.execute(sql`delete from audit_log`));
    });
  });

  describe("submitInvoice", () => {
    const fakeClient = (status: number, body: unknown) =>
      ({
        clearInvoice: async () => toSubmissionResult(status, body),
        reportInvoice: async () => toSubmissionResult(status, body),
      }) as unknown as FatooraClient;

    it("stores ZATCA's cleared XML on acceptance", async () => {
      const inv = await db.query.invoices.findFirst({ where: eq(invoices.icv, 1) });
      const cleared = "<Invoice>cleared</Invoice>";
      const outcome = await submitInvoice(
        { ...ctx, client: fakeClient(200, { clearanceStatus: "CLEARED", clearedInvoice: Buffer.from(cleared).toString("base64") }) },
        inv!.id,
      );
      expect(outcome).toBe("accepted");
      const after = await db.query.invoices.findFirst({ where: eq(invoices.id, inv!.id) });
      expect(after!.status).toBe("accepted");
      expect((await ctx.storage.get(after!.clearedXmlKey!)).toString()).toBe(cleared);
      expect(await submitInvoice({ ...ctx, client: fakeClient(200, {}) }, inv!.id)).toBe("skipped");
    });

    it("marks rejections and keeps retryable failures pending", async () => {
      const [a, b] = await db.select().from(invoices).where(eq(invoices.status, "pending")).orderBy(asc(invoices.icv)).limit(2);
      const rejected = { validationResults: { errorMessages: [{ type: "ERROR", code: "BR-KSA-37", category: "KSA", message: "x", status: "ERROR" }] } };
      expect(await submitInvoice({ ...ctx, client: fakeClient(400, rejected) }, a!.id)).toBe("rejected");
      expect(await submitInvoice({ ...ctx, client: fakeClient(503, "Service Unavailable") }, b!.id)).toBe("retry");
      const after = await db.query.invoices.findFirst({ where: eq(invoices.id, b!.id) });
      expect(after!.status).toBe("pending");
      expect(after!.attempts).toBe(1);
      const logged = await db.select().from(submissions).where(eq(submissions.invoiceId, b!.id));
      expect(logged).toHaveLength(1);
    });
  });
});
