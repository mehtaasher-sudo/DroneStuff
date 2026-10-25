#!/usr/bin/env bash
# Builds LiquidGlassNav.apk without Gradle using the Debian/Ubuntu Android tool packages:
#   apt-get install aapt dalvik-exchange zipalign apksigner android-sdk-platform-23
# APIs newer than 23 (window blur) are called via reflection, so compiling against android-23 is enough.
set -euo pipefail
cd "$(dirname "$0")"

ANDROID_JAR=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
KEYSTORE=${KEYSTORE:-signing/debug.keystore}
OUT=build

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" dist

if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android \
    -alias liquidglass -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Liquid Glass Nav, O=Personal, C=US"
fi

aapt package -f -m -J "$OUT/gen" -M AndroidManifest.xml -S res -I "$ANDROID_JAR" -F "$OUT/app.unsigned.apk"
javac -source 8 -target 8 -nowarn -Xlint:-options -bootclasspath "$ANDROID_JAR" -d "$OUT/classes" \
  $(find src "$OUT/gen" -name '*.java')
dalvik-exchange --dex --min-sdk-version=26 --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && aapt add app.unsigned.apk classes.dex >/dev/null)
zipalign -f 4 "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk"
apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias liquidglass --v4-signing-enabled false --out dist/LiquidGlassNav.apk "$OUT/app.aligned.apk"
apksigner verify --print-certs dist/LiquidGlassNav.apk | head -1
echo "Built dist/LiquidGlassNav.apk"
