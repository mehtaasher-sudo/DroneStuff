# Liquid Glass Nav (Android)

A floating, Apple-style **Liquid Glass** navigation bubble (Back · Home · Recents) that sits above every app on Android.

**Download:** [`dist/LiquidGlassNav.apk`](dist/LiquidGlassNav.apk) — Android 8.0+ (frosted blur on Android 12+).

## Install
1. Open the APK on your phone and allow "Install unknown apps" for your browser / file manager.
2. Open **Liquid Glass Nav** → **Enable Liquid Glass Nav** → turn on the service.
3. Android 13+: if the switch is greyed out, App info → ⋮ → **Allow restricted settings**, then enable again.
4. Settings → System → Navigation mode → **Gesture navigation**, so the bubble replaces the 3-button bar.

## How it works
- An `AccessibilityService` shows a `TYPE_ACCESSIBILITY_OVERLAY` window and maps taps to `performGlobalAction` (Back / Home / Recents).
- The window uses `Window#setBackgroundBlurRadius` (Android 12+) for real blur of the app behind it; the view adds the specular highlight, refractive rim and a liquid droplet lens that follows your finger.
- Long-press: Back → notifications, Home → assistant, Recents → quick settings.
- Hides automatically while the keyboard is open (toggle in settings). Width, height, bottom distance and tint are adjustable.
- No network permission; nothing is collected.

## Scope
This replaces the **system** navigation bar for all apps. Tab bars drawn *inside* individual apps (e.g. Instagram's bottom tabs) are part of those apps' own UI and cannot be restyled by a normal app — that requires root + an LSPosed module.

## Build
```bash
sudo apt-get install aapt dalvik-exchange zipalign apksigner android-sdk-platform-23
./build.sh   # → dist/LiquidGlassNav.apk
```
`signing/debug.keystore` (password `android`) is a personal self-signed key kept in the repo so rebuilt APKs install as updates over the previous one.
