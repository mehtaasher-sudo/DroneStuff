# Liquid Glass Nav (Android)

Turns the **bottom menu bars inside your apps** (Gmail's Mail/Chat, Play Store's Games/Apps/Search/Books/You, browser toolbars, …) into a floating, Apple-style **Liquid Glass** bubble. No root needed.

**Download:** [`dist/LiquidGlassNav.apk`](dist/LiquidGlassNav.apk). Glass menu bars need Android 11+ and are seamless on Android 14+.

## Install
1. Open the APK on your phone and allow "Install unknown apps" for your browser or file manager.
2. Open **Liquid Glass Nav**, tap **Enable Liquid Glass Nav** and turn on the service.
3. Android 13+: if the switch is greyed out, go to App info → ⋮ → **Allow restricted settings**, then enable it again.

## How it works
- An `AccessibilityService` reads the open app's node tree and finds its bottom menu bar (`BarDetector`): a single row of 2–7 similar, evenly spaced buttons at the bottom of the window. Dialog buttons, single buttons and bars pushed up by the keyboard are ignored.
- The service takes a screenshot of the app window (`takeScreenshotOfWindow` on Android 14+, a display screenshot on 11–13). It copies each button's icon and label, keying out the bar colour and the app's own selection pill (`IconMath`).
- `MenuGlassView` covers the original bar with the app's content colour and draws a floating glass bubble. The bubble has a soft shadow, the content above it blurred into the glass, a specular highlight, a refractive rim and a liquid droplet that marks the selected tab and follows your finger.
- Taps run `ACTION_CLICK` on the app's real button. If that fails, the overlay briefly lets one injected tap fall through to the button.
- The launcher, System UI, apps with protected screens (`FLAG_SECURE`, e.g. banking) and apps you switch off in settings are left untouched. The bubble hides while the keyboard, notification shade or lock screen is showing.
- Optional: a floating glass Back / Home / Recents bubble (off by default).
- The app has no network permission, and nothing is stored except your settings.

## Build & test
```bash
sudo apt-get install aapt dalvik-exchange zipalign apksigner android-sdk-platform-23
./build.sh        # → dist/LiquidGlassNav.apk (downloads android-all from Maven Central once)
tests/run.sh      # JVM tests for bar detection + icon extraction on real screenshots
```
`signing/debug.keystore` (password `android`) is a personal self-signed key. It is kept in the repo so rebuilt APKs install as updates over the previous one.
