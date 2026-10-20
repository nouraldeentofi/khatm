import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

const FIRST_PIH = "NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 18, scale: 2, mode: "string" });
const qty = (name: string) => numeric(name, { precision: 18, scale: 6, mode: "string" });

export const roleEnum = pgEnum("role", ["owner", "accountant", "cashier"]);
export const environmentEnum = pgEnum("zatca_environment", ["sandbox", "simulation", "production"]);
export const deviceStatusEnum = pgEnum("device_status", ["onboarding", "active", "revoked"]);
export const documentKindEnum = pgEnum("document_kind", ["invoice", "credit_note", "debit_note"]);
export const audienceEnum = pgEnum("audience", ["standard", "simplified"]);
export const taxCategoryEnum = pgEnum("tax_category", ["S", "Z", "E", "O"]);
export const invoiceStatusEnum = pgEnum("invoice_status", [
  "pending", // issued and chained, waiting for ZATCA
  "accepted",
  "accepted_with_warnings",
  "rejected", // keeps its ICV and hash; corrected by a new document
  "failed", // gave up retrying — needs attention
]);

/** The taxpayer. Fields marked (CSR) are baked into device certificates. */
export const organizations = pgTable("organizations", {
  id: id(),
  legalName: text("legal_name").notNull(), // (CSR)
  tradeName: text("trade_name"),
  vatNumber: text("vat_number").notNull(), // (CSR)
  idScheme: text("id_scheme").notNull().default("CRN"),
  idValue: text("id_value").notNull(),
  street: text("street").notNull(),
  additionalStreet: text("additional_street"),
  buildingNumber: text("building_number").notNull(),
  additionalNumber: text("additional_number"),
  district: text("district").notNull(),
  city: text("city").notNull(),
  postalCode: text("postal_code").notNull(),
  region: text("region"),
  phone: text("phone"),
  email: text("email"),
  logoKey: text("logo_key"),
  invoicePrefix: text("invoice_prefix").notNull().default("INV-"),
  /** Gapless sequence behind the human-facing invoice number. */
  lastInvoiceSeq: bigint("last_invoice_seq", { mode: "number" }).notNull().default(0),
  plan: text("plan").notNull().default("trial"),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecretEnc: text("totp_secret_enc"),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** One user can belong to several organizations (accounting offices). */
export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
);

/** EGS unit: the unit of ZATCA certification and of ICV/PIH sequencing. */
export const devices = pgTable("devices", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  branch: text("branch").notNull(),
  environment: environmentEnum("environment").notNull(),
  status: deviceStatusEnum("status").notNull().default("onboarding"),
  commonName: text("common_name").notNull(),
  serialNumber: text("serial_number").notNull(),
  invoiceTypes: text("invoice_types").notNull().default("1100"),
  /** AES-256-GCM under the master key; decrypted only at signing time. */
  privateKeyEnc: text("private_key_enc"),
  complianceRequestId: text("compliance_request_id"),
  csidToken: text("csid_token"), // production binarySecurityToken (public certificate)
  csidSecretEnc: text("csid_secret_enc"),
  certificateExpiresAt: timestamp("certificate_expires_at", { withTimezone: true }),
  lastIcv: bigint("last_icv", { mode: "number" }).notNull().default(0),
  lastHash: text("last_hash").notNull().default(FIRST_PIH),
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const customers = pgTable(
  "customers",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    vatNumber: text("vat_number"),
    idScheme: text("id_scheme"),
    idValue: text("id_value"),
    street: text("street"),
    additionalStreet: text("additional_street"),
    buildingNumber: text("building_number"),
    additionalNumber: text("additional_number"),
    district: text("district"),
    city: text("city"),
    postalCode: text("postal_code"),
    country: text("country").notNull().default("SA"),
    email: text("email"),
    phone: text("phone"),
    createdAt: createdAt(),
  },
  (t) => [index("customers_org_name_idx").on(t.orgId, t.name)],
);

export const products = pgTable("products", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  unitPrice: qty("unit_price").notNull(),
  unitCode: text("unit_code").notNull().default("PCE"),
  taxCategory: taxCategoryEnum("tax_category").notNull().default("S"),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2, mode: "string" }).notNull().default("15.00"),
  exemptionCode: text("exemption_code"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * Issued documents only — drafts live elsewhere. Rows are immutable apart from the
 * submission columns (enforced by trigger; the app role has no DELETE).
 */
export const invoices = pgTable(
  "invoices",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    deviceId: uuid("device_id").notNull().references(() => devices.id),
    customerId: uuid("customer_id").references(() => customers.id),
    kind: documentKindEnum("kind").notNull(),
    audience: audienceEnum("audience").notNull(),
    number: text("number").notNull(),
    uuid: uuid("uuid").notNull().unique(),
    icv: bigint("icv", { mode: "number" }).notNull(),
    pih: text("pih").notNull(),
    hash: text("hash").notNull(),
    qr: text("qr").notNull(),
    issueDate: date("issue_date").notNull(),
    issueTime: time("issue_time").notNull(),
    supplyDate: date("supply_date"),
    currency: text("currency").notNull().default("SAR"),
    buyerName: text("buyer_name"),
    lineExtension: money("line_extension").notNull(),
    allowanceTotal: money("allowance_total").notNull(),
    taxExclusive: money("tax_exclusive").notNull(),
    vatTotal: money("vat_total").notNull(),
    taxInclusive: money("tax_inclusive").notNull(),
    payable: money("payable").notNull(),
    originalInvoiceId: uuid("original_invoice_id"),
    billingReference: text("billing_reference"),
    noteReason: text("note_reason"),
    xmlKey: text("xml_key").notNull(),
    // Submission state — the only columns that change after insert.
    status: invoiceStatusEnum("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    clearedXmlKey: text("cleared_xml_key"),
    zatcaResponse: jsonb("zatca_response"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("invoices_device_icv_uq").on(t.deviceId, t.icv),
    unique("invoices_org_number_uq").on(t.orgId, t.number),
    index("invoices_org_customer_idx").on(t.orgId, t.customerId, t.issueDate),
    index("invoices_status_idx").on(t.status, t.createdAt),
  ],
);

export const invoiceLines = pgTable("invoice_lines", {
  id: id(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  position: integer("position").notNull(),
  name: text("name").notNull(),
  quantity: qty("quantity").notNull(),
  unitCode: text("unit_code").notNull(),
  unitPrice: qty("unit_price").notNull(),
  discount: money("discount").notNull(),
  taxCategory: taxCategoryEnum("tax_category").notNull(),
  taxPercent: numeric("tax_percent", { precision: 5, scale: 2, mode: "string" }).notNull(),
  exemptionCode: text("exemption_code"),
  net: money("net").notNull(),
  vat: money("vat").notNull(),
  total: money("total").notNull(),
});

/** Every call to ZATCA, request and response, for disputes and audits. */
export const submissions = pgTable("submissions", {
  id: id(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id),
  endpoint: text("endpoint").notNull(),
  httpStatus: integer("http_status").notNull(),
  outcome: text("outcome").notNull(),
  response: jsonb("response"),
  durationMs: integer("duration_ms"),
  createdAt: createdAt(),
});

/** Append-only (trigger + grants). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id"),
    userId: uuid("user_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    ip: inet("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_idx").on(t.orgId, t.createdAt)],
);
