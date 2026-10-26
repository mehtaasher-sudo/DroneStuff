#!/usr/bin/env bash
# Builds LiquidGlassNav.apk without Gradle or the Google SDK downloader.
# Needs the Debian/Ubuntu Android tool packages:
#   apt-get install aapt dalvik-exchange zipalign apksigner android-sdk-platform-23
# Java is compiled against Robolectric's android-all (API 34 framework classes, Maven Central);
# resources against the packaged android-23 platform. The service config XML, which needs
# API 30+ attributes, is encoded by tools/service_xml.py.
set -euo pipefail
cd "$(dirname "$0")"

ANDROID_JAR=${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}
ANDROID_ALL_VERSION=14-robolectric-10818077
CACHE=${CACHE:-$HOME/.cache/liquid-glass-nav}
ANDROID_ALL=$CACHE/android-all-$ANDROID_ALL_VERSION.jar
KEYSTORE=${KEYSTORE:-signing/debug.keystore}
OUT=build

mkdir -p "$CACHE"
if [ ! -f "$ANDROID_ALL" ]; then
  curl -sSfL -o "$ANDROID_ALL.part" \
    "https://repo1.maven.org/maven2/org/robolectric/android-all/$ANDROID_ALL_VERSION/android-all-$ANDROID_ALL_VERSION.jar"
  mv "$ANDROID_ALL.part" "$ANDROID_ALL"
fi

rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" dist

if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android \
    -alias liquidglass -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Liquid Glass Nav, O=Personal, C=US"
fi

aapt package -f -m -J "$OUT/gen" -M AndroidManifest.xml -S res -I "$ANDROID_JAR" -F "$OUT/app.unsigned.apk"
DESC_ID=$(aapt dump resources "$OUT/app.unsigned.apk" | sed -n 's/.*resource \(0x[0-9a-f]*\) com.liquidglass.navbar:string\/service_description.*/\1/p' | head -1)
python3 tools/service_xml.py "$OUT/app.unsigned.apk" res/xml/glass_nav_service.xml "$DESC_ID"

javac -source 8 -target 8 -nowarn -Xlint:-options -encoding UTF-8 \
  -bootclasspath "$ANDROID_ALL:$ANDROID_JAR" -d "$OUT/classes" \
  $(find src "$OUT/gen" -name '*.java')
dalvik-exchange --dex --min-sdk-version=26 --output="$OUT/classes.dex" "$OUT/classes"
(cd "$OUT" && aapt add app.unsigned.apk classes.dex >/dev/null)
zipalign -f 4 "$OUT/app.unsigned.apk" "$OUT/app.aligned.apk"
apksigner sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias liquidglass --v4-signing-enabled false --out dist/LiquidGlassNav.apk "$OUT/app.aligned.apk"
apksigner verify dist/LiquidGlassNav.apk
echo "Built dist/LiquidGlassNav.apk"
