#!/usr/bin/env bash
# Runs the pure-Java logic tests on the JVM (no device needed).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=build/test-classes
rm -rf "$OUT" && mkdir -p "$OUT"
javac -nowarn -d "$OUT" src/com/liquidglass/navbar/BarDetector.java src/com/liquidglass/navbar/IconMath.java \
  tests/com/liquidglass/navbar/LogicTest.java
java -cp "$OUT" com.liquidglass.navbar.LogicTest tests/fixtures "${1:-}"
