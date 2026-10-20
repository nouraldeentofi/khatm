CREATE TYPE "public"."audience" AS ENUM('standard', 'simplified');--> statement-breakpoint
CREATE TYPE "public"."device_status" AS ENUM('onboarding', 'active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('invoice', 'credit_note', 'debit_note');--> statement-breakpoint
CREATE TYPE "public"."zatca_environment" AS ENUM('sandbox', 'simulation', 'production');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('pending', 'accepted', 'accepted_with_warnings', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'accountant', 'cashier');--> statement-breakpoint
CREATE TYPE "public"."tax_category" AS ENUM('S', 'Z', 'E', 'O');--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" uuid,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"vat_number" text,
	"id_scheme" text,
	"id_value" text,
	"street" text,
	"additional_street" text,
	"building_number" text,
	"additional_number" text,
	"district" text,
	"city" text,
	"postal_code" text,
	"country" text DEFAULT 'SA' NOT NULL,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"branch" text NOT NULL,
	"environment" "zatca_environment" NOT NULL,
	"status" "device_status" DEFAULT 'onboarding' NOT NULL,
	"common_name" text NOT NULL,
	"serial_number" text NOT NULL,
	"invoice_types" text DEFAULT '1100' NOT NULL,
	"private_key_enc" text,
	"compliance_request_id" text,
	"csid_token" text,
	"csid_secret_enc" text,
	"certificate_expires_at" timestamp with time zone,
	"last_icv" bigint DEFAULT 0 NOT NULL,
	"last_hash" text DEFAULT 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==' NOT NULL,
	"onboarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"name" text NOT NULL,
	"quantity" numeric(18, 6) NOT NULL,
	"unit_code" text NOT NULL,
	"unit_price" numeric(18, 6) NOT NULL,
	"discount" numeric(18, 2) NOT NULL,
	"tax_category" "tax_category" NOT NULL,
	"tax_percent" numeric(5, 2) NOT NULL,
	"exemption_code" text,
	"net" numeric(18, 2) NOT NULL,
	"vat" numeric(18, 2) NOT NULL,
	"total" numeric(18, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"customer_id" uuid,
	"kind" "document_kind" NOT NULL,
	"audience" "audience" NOT NULL,
	"number" text NOT NULL,
	"uuid" uuid NOT NULL,
	"icv" bigint NOT NULL,
	"pih" text NOT NULL,
	"hash" text NOT NULL,
	"qr" text NOT NULL,
	"issue_date" date NOT NULL,
	"issue_time" time NOT NULL,
	"supply_date" date,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"buyer_name" text,
	"line_extension" numeric(18, 2) NOT NULL,
	"allowance_total" numeric(18, 2) NOT NULL,
	"tax_exclusive" numeric(18, 2) NOT NULL,
	"vat_total" numeric(18, 2) NOT NULL,
	"tax_inclusive" numeric(18, 2) NOT NULL,
	"payable" numeric(18, 2) NOT NULL,
	"original_invoice_id" uuid,
	"billing_reference" text,
	"note_reason" text,
	"xml_key" text NOT NULL,
	"status" "invoice_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"cleared_xml_key" text,
	"zatca_response" jsonb,
	"submitted_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_uuid_unique" UNIQUE("uuid"),
	CONSTRAINT "invoices_device_icv_uq" UNIQUE("device_id","icv"),
	CONSTRAINT "invoices_org_number_uq" UNIQUE("org_id","number")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"role" "role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_org_id_pk" PRIMARY KEY("user_id","org_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"legal_name" text NOT NULL,
	"trade_name" text,
	"vat_number" text NOT NULL,
	"id_scheme" text DEFAULT 'CRN' NOT NULL,
	"id_value" text NOT NULL,
	"street" text NOT NULL,
	"additional_street" text,
	"building_number" text NOT NULL,
	"additional_number" text,
	"district" text NOT NULL,
	"city" text NOT NULL,
	"postal_code" text NOT NULL,
	"region" text,
	"phone" text,
	"email" text,
	"logo_key" text,
	"invoice_prefix" text DEFAULT 'INV-' NOT NULL,
	"last_invoice_seq" bigint DEFAULT 0 NOT NULL,
	"plan" text DEFAULT 'trial' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"unit_price" numeric(18, 6) NOT NULL,
	"unit_code" text DEFAULT 'PCE' NOT NULL,
	"tax_category" "tax_category" DEFAULT 'S' NOT NULL,
	"tax_percent" numeric(5, 2) DEFAULT '15.00' NOT NULL,
	"exemption_code" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"http_status" integer NOT NULL,
	"outcome" text NOT NULL,
	"response" jsonb,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"totp_secret_enc" text,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_org_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "customers_org_name_idx" ON "customers" USING btree ("org_id","name");--> statement-breakpoint
CREATE INDEX "invoices_org_customer_idx" ON "invoices" USING btree ("org_id","customer_id","issue_date");--> statement-breakpoint
CREATE INDEX "invoices_status_idx" ON "invoices" USING btree ("status","created_at");