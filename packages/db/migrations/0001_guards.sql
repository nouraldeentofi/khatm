-- Rules ZATCA forbids an e-invoicing solution from breaking, enforced below the app.

-- Issued invoices: no DELETE; only submission columns may change.
CREATE OR REPLACE FUNCTION forbid_invoice_rewrite() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Issued invoices cannot be deleted; issue a credit note instead';
  END IF;
  IF (NEW.org_id, NEW.device_id, NEW.customer_id, NEW.kind, NEW.audience, NEW.number, NEW.uuid, NEW.icv,
      NEW.pih, NEW.hash, NEW.qr, NEW.issue_date, NEW.issue_time, NEW.supply_date, NEW.currency,
      NEW.buyer_name, NEW.line_extension, NEW.allowance_total, NEW.tax_exclusive, NEW.vat_total,
      NEW.tax_inclusive, NEW.payable, NEW.original_invoice_id, NEW.billing_reference, NEW.note_reason,
      NEW.xml_key, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM
     (OLD.org_id, OLD.device_id, OLD.customer_id, OLD.kind, OLD.audience, OLD.number, OLD.uuid, OLD.icv,
      OLD.pih, OLD.hash, OLD.qr, OLD.issue_date, OLD.issue_time, OLD.supply_date, OLD.currency,
      OLD.buyer_name, OLD.line_extension, OLD.allowance_total, OLD.tax_exclusive, OLD.vat_total,
      OLD.tax_inclusive, OLD.payable, OLD.original_invoice_id, OLD.billing_reference, OLD.note_reason,
      OLD.xml_key, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Issued invoice % is immutable', OLD.number;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoices_immutable BEFORE UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION forbid_invoice_rewrite();
--> statement-breakpoint

-- Invoice lines and the audit log are append-only.
CREATE OR REPLACE FUNCTION forbid_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER invoice_lines_append_only BEFORE UPDATE OR DELETE ON invoice_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_change();
--> statement-breakpoint

-- The ICV counter only ever moves forward by one, and the chain head moves with it.
CREATE OR REPLACE FUNCTION guard_device_counter() RETURNS trigger AS $$
BEGIN
  IF NEW.last_icv < OLD.last_icv THEN
    RAISE EXCEPTION 'ICV counter of device % cannot go backwards (% -> %)', OLD.id, OLD.last_icv, NEW.last_icv;
  END IF;
  IF NEW.last_icv > OLD.last_icv + 1 THEN
    RAISE EXCEPTION 'ICV counter of device % cannot skip (% -> %)', OLD.id, OLD.last_icv, NEW.last_icv;
  END IF;
  IF (NEW.last_icv = OLD.last_icv) <> (NEW.last_hash = OLD.last_hash) THEN
    RAISE EXCEPTION 'ICV and PIH of device % must advance together', OLD.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER devices_counter_guard BEFORE UPDATE ON devices
  FOR EACH ROW EXECUTE FUNCTION guard_device_counter();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION forbid_device_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Devices are never deleted; revoke them instead';
END $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER devices_no_delete BEFORE DELETE ON devices
  FOR EACH ROW EXECUTE FUNCTION forbid_device_delete();
