#!/usr/bin/env bash
# Runs the official ZATCA e-invoicing SDK (Java) from tools/zatca-sdk.
# The SDK needs Java 11: secp256k1 was removed from the JDK in Java 16+.
# Usage: scripts/zatca-sdk.sh -validate -invoice path/to/invoice.xml
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="$ROOT/tools/zatca-sdk"
JAVA="${ZATCA_JAVA:-/usr/lib/jvm/java-11-openjdk-amd64/bin/java}"
VERSION="$(sed -E 's/.*"version" *: *"([^"]+)".*/\1/' "$SDK/Apps/global.json" | tr -d '[:space:]')"
export SDK_CONFIG="${SDK_CONFIG:-$SDK/Configuration/config.json}"
exec "$JAVA" -Djdk.module.illegalAccess=deny -Djdk.sunec.disableNative=false -Dfile.encoding=UTF-8 \
  -jar "$SDK/Apps/zatca-einvoicing-sdk-$VERSION.jar" --globalVersion "$VERSION" "$@"
