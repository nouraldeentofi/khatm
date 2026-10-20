#!/usr/bin/env bash
# Points the official ZATCA SDK at this checkout. Download the Java SDK from the
# Fatoora developer portal (https://sandbox.zatca.gov.sa → SDK), extract it to
# tools/zatca-sdk (so tools/zatca-sdk/Apps exists), then run this once.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="$ROOT/tools/zatca-sdk"
[ -d "$SDK/Apps" ] || { echo "Extract the SDK to $SDK first"; exit 1; }
SCHEMATRONS="$(ls -d "$SDK"/Data/Rules/[Ss]chematrons)"
cat > "$SDK/Configuration/config.json" <<JSON
{"xsdPath":"$SDK/Data/Schemas/xsds/UBL2.1/xsd/maindoc/UBL-Invoice-2.1.xsd",
 "enSchematron":"$SCHEMATRONS/CEN-EN16931-UBL.xsl",
 "zatcaSchematron":"$(ls "$SCHEMATRONS"/*ZATCA*.xsl)",
 "certPath":"$SDK/Data/Certificates/cert.pem",
 "privateKeyPath":"$SDK/Data/Certificates/ec-secp256k1-priv-key.pem",
 "pihPath":"$SDK/Data/PIH/pih.txt",
 "inputPath":"$SDK/Data/Input",
 "usagePathFile":"$SDK/Configuration/usage.txt"}
JSON
echo "SDK configured. Java 11 is required (secp256k1 was removed in Java 16+)."
"$ROOT/scripts/zatca-sdk.sh" -validate -invoice "$SDK/Data/Samples/Simplified/Invoice/Simplified_Invoice.xml" | grep "GLOBAL VALIDATION"
