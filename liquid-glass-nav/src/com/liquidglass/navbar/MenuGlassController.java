package com.liquidglass.navbar;

import android.accessibilityservice.AccessibilityService;
import android.accessibilityservice.GestureDescription;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.ColorSpace;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.HardwareBuffer;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Display;
import android.view.Gravity;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.view.accessibility.AccessibilityWindowInfo;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.Executor;

/**
 * Turns the bottom menu bar of whatever app is open into a floating Liquid Glass bubble.
 * Finds the bar through the accessibility node tree, copies its icons from a screenshot of
 * the app window, covers the bar with {@link MenuGlassView} and forwards taps to the real
 * buttons. Requires Android 11+ (accessibility screenshots).
 */
final class MenuGlassController implements MenuGlassView.Listener {

    private static final long MAX_SCAN_WAIT_MS = 400;
    private static final long SHOT_INTERVAL_MS = 350;
    private static final long REFRESH_MS = 5000;

    private final AccessibilityService svc;
    private final SharedPreferences prefs;
    private final WindowManager wm;
    private final float density;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Handler worker;
    private final Executor workerExec;
    private final String homePackage;
    private final Set<String> securePackages = new HashSet<>();

    private MenuGlassView view;
    private WindowManager.LayoutParams lp;
    private boolean attached;
    private boolean enabled;

    private BarDetector.Bar bar;
    private String barPackage;
    private int barWindowId;
    private final Rect winBounds = new Rect();
    private String shownSignature;
    private String pendingSignature;
    private volatile int overlayTopPx;
    private int misses;
    private boolean imeVisible;

    private long lastScan;
    private long lastShot;
    private boolean shooting;
    private boolean forceShot;

    private final Runnable scanTask = new Runnable() {
        @Override
        public void run() {
            scan();
        }
    };

    private final Runnable shotTask = new Runnable() {
        @Override
        public void run() {
            requestShot();
        }
    };

    private final Runnable refreshTask = new Runnable() {
        @Override
        public void run() {
            if (attached) {
                forceShot = true;
                scheduleScan(0);
            }
            main.postDelayed(this, REFRESH_MS);
        }
    };

    MenuGlassController(AccessibilityService svc, SharedPreferences prefs) {
        this.svc = svc;
        this.prefs = prefs;
        this.wm = (WindowManager) svc.getSystemService(AccessibilityService.WINDOW_SERVICE);
        this.density = svc.getResources().getDisplayMetrics().density;
        HandlerThread t = new HandlerThread("glass-icons");
        t.start();
        worker = new Handler(t.getLooper());
        workerExec = new Executor() {
            @Override
            public void execute(Runnable r) {
                worker.post(r);
            }
        };
        homePackage = resolveHome();
    }

    private String resolveHome() {
        try {
            android.content.Intent i = new android.content.Intent(android.content.Intent.ACTION_MAIN);
            i.addCategory(android.content.Intent.CATEGORY_HOME);
            android.content.pm.ResolveInfo ri = svc.getPackageManager().resolveActivity(i, 0);
            return ri != null && ri.activityInfo != null ? ri.activityInfo.packageName : "";
        } catch (RuntimeException e) {
            return "";
        }
    }

    private int dp(float v) {
        return Math.round(v * density);
    }

    void setEnabled(boolean on) {
        if (on == enabled) return;
        enabled = on;
        if (on) {
            main.postDelayed(refreshTask, REFRESH_MS);
            scheduleScan(0);
        } else {
            main.removeCallbacks(refreshTask);
            main.removeCallbacks(scanTask);
            hide();
        }
    }

    void destroy() {
        setEnabled(false);
        worker.getLooper().quitSafely();
    }

    /** Settings changed (e.g. an app was excluded): re-evaluate the current screen now. */
    void refresh() {
        if (!enabled) return;
        hide();
        scheduleScan(0);
    }

    void onConfigChanged() {
        hide();
        scheduleScan(150);
    }

    void onEvent(AccessibilityEvent e) {
        if (!enabled) return;
        CharSequence pkg = e.getPackageName();
        if (pkg != null && svc.getPackageName().contentEquals(pkg)) return;
        scheduleScan(e.getEventType() == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ? 60 : 140);
    }

    private void scheduleScan(long delay) {
        long now = SystemClock.uptimeMillis();
        long wait = Math.max(0, lastScan + MAX_SCAN_WAIT_MS - now);
        main.removeCallbacks(scanTask);
        main.postDelayed(scanTask, Math.min(delay, wait));
    }

    private boolean excluded(String pkg) {
        if (pkg == null) return true;
        if (pkg.equals(svc.getPackageName()) || pkg.equals(homePackage) || pkg.equals("com.android.systemui")) {
            return true;
        }
        if (securePackages.contains(pkg)) return true;
        return Prefs.excluded(prefs).contains(pkg);
    }

    private void scan() {
        lastScan = SystemClock.uptimeMillis();
        if (!enabled) return;
        AccessibilityWindowInfo app = null;
        imeVisible = false;
        List<AccessibilityWindowInfo> windows = svc.getWindows();
        for (AccessibilityWindowInfo w : windows) {
            if (w.getType() == AccessibilityWindowInfo.TYPE_INPUT_METHOD) imeVisible = true;
        }
        for (AccessibilityWindowInfo w : windows) {
            if (w.getType() != AccessibilityWindowInfo.TYPE_APPLICATION || w.isInPictureInPictureMode()) continue;
            if (app == null || ((w.isActive() || w.isFocused()) && !(app.isActive() || app.isFocused()))) app = w;
        }
        AccessibilityNodeInfo root = app == null ? null : app.getRoot();
        String pkg = root == null || root.getPackageName() == null ? null : root.getPackageName().toString();
        if (root == null || imeVisible || excluded(pkg)) {
            hide();
            return;
        }
        Rect wb = new Rect();
        app.getBoundsInScreen(wb);
        List<BarDetector.Item> items = new ArrayList<>();
        collect(root, items, BarDetector.bandTop(wb.bottom, density), 0);
        BarDetector.Bar found = BarDetector.detect(items, wb.left, wb.right, wb.bottom, density);
        if (found != null && coveredBySystemUi(windows, wb.bottom)) found = null;
        if (found == null) {
            if (attached && misses++ == 0) {
                scheduleScan(220); // ride out transitions before removing the bubble
            } else {
                hide();
            }
            return;
        }
        misses = 0;
        String sig = pkg + "#" + wb.toShortString() + "#" + found.signature();
        bar = found;
        barPackage = pkg;
        barWindowId = app.getId();
        winBounds.set(wb);
        if (!sig.equals(shownSignature) || forceShot) {
            forceShot = false;
            pendingSignature = sig;
            requestShot();
        }
    }

    /** Notification shade, lock screen etc. are drawn below accessibility overlays: step aside. */
    private boolean coveredBySystemUi(List<AccessibilityWindowInfo> windows, int winBottom) {
        int bandTop = BarDetector.bandTop(winBottom, density);
        Rect r = new Rect();
        for (AccessibilityWindowInfo w : windows) {
            if (w.getType() != AccessibilityWindowInfo.TYPE_SYSTEM) continue;
            w.getBoundsInScreen(r);
            // The navigation bar itself is a short system window at the bottom; ignore it.
            if (r.bottom > bandTop && r.height() > dp(120)) return true;
        }
        return false;
    }

    private void collect(AccessibilityNodeInfo node, List<BarDetector.Item> out, int bandTop, int depth) {
        if (node == null || depth > 45 || out.size() > 300) return;
        Rect r = new Rect();
        node.getBoundsInScreen(r);
        if (r.bottom < bandTop || !node.isVisibleToUser()) return;
        if (node.isClickable() && r.top >= bandTop) {
            BarDetector.Item it = new BarDetector.Item(r.left, r.top, r.right, r.bottom, label(node, 0),
                    selected(node, 0));
            it.ref = node;
            out.add(it);
        }
        for (int i = 0; i < node.getChildCount(); i++) collect(node.getChild(i), out, bandTop, depth + 1);
    }

    private static String label(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 3) return "";
        CharSequence s = n.getContentDescription();
        if (s == null || s.length() == 0) s = n.getText();
        if (s != null && s.length() > 0) return s.toString();
        for (int i = 0; i < n.getChildCount(); i++) {
            String c = label(n.getChild(i), depth + 1);
            if (!c.isEmpty()) return c;
        }
        return "";
    }

    private static boolean selected(AccessibilityNodeInfo n, int depth) {
        if (n == null || depth > 3) return false;
        if (n.isSelected() || n.isChecked()) return true;
        for (int i = 0; i < n.getChildCount(); i++) if (selected(n.getChild(i), depth + 1)) return true;
        return false;
    }

    // ---- screenshot + icon extraction ----

    private void requestShot() {
        if (Build.VERSION.SDK_INT < 30 || bar == null) return;
        if (shooting) {
            main.removeCallbacks(shotTask);
            main.postDelayed(shotTask, SHOT_INTERVAL_MS);
            return;
        }
        long wait = lastShot + SHOT_INTERVAL_MS - SystemClock.uptimeMillis();
        if (wait > 0) {
            main.removeCallbacks(shotTask);
            main.postDelayed(shotTask, wait);
            return;
        }
        shooting = true;
        lastShot = SystemClock.uptimeMillis();
        final BarDetector.Bar b = bar;
        final Rect wb = new Rect(winBounds);
        final String sig = pendingSignature;
        final String pkg = barPackage;

        if (Build.VERSION.SDK_INT >= 34) {
            // Captures only the app window, so the bubble on top never ends up in the copy.
            svc.takeScreenshotOfWindow(barWindowId, workerExec, callback(b, wb, sig, pkg, true));
        } else {
            // Android 11-13 can only capture the whole display: make the bubble invisible for a frame.
            if (attached) view.setAlpha(0f);
            main.postDelayed(new Runnable() {
                @Override
                public void run() {
                    svc.takeScreenshot(Display.DEFAULT_DISPLAY, workerExec, callback(b, wb, sig, pkg, false));
                }
            }, attached ? 48 : 0);
        }
    }

    private AccessibilityService.TakeScreenshotCallback callback(final BarDetector.Bar b, final Rect wb,
            final String sig, final String pkg, final boolean windowOnly) {
        return new AccessibilityService.TakeScreenshotCallback() {
            @Override
            public void onSuccess(AccessibilityService.ScreenshotResult result) {
                HardwareBuffer hb = result.getHardwareBuffer();
                ColorSpace cs = result.getColorSpace();
                Bitmap hw = Bitmap.wrapHardwareBuffer(hb, cs);
                Bitmap shot = hw == null ? null : hw.copy(Bitmap.Config.ARGB_8888, false);
                if (hw != null) hw.recycle();
                hb.close();
                MenuGlassView.Model built = null;
                try {
                    if (shot != null) built = buildModel(shot, b, wb, windowOnly);
                } catch (RuntimeException e) {
                    built = null; // never let a bad frame take the service down
                }
                final MenuGlassView.Model m = built;
                if (shot != null) shot.recycle();
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        shooting = false;
                        if (view != null) view.setAlpha(1f);
                        if (m != null && enabled && sig != null && sig.equals(pendingSignature)) show(m, b, wb, sig, pkg);
                    }
                });
            }

            @Override
            public void onFailure(final int errorCode) {
                main.post(new Runnable() {
                    @Override
                    public void run() {
                        shooting = false;
                        if (view != null) view.setAlpha(1f);
                        if (errorCode == AccessibilityService.ERROR_TAKE_SCREENSHOT_SECURE_WINDOW) {
                            securePackages.add(pkg); // e.g. banking apps: leave them untouched
                            hide();
                        } else {
                            main.removeCallbacks(shotTask);
                            main.postDelayed(shotTask, SHOT_INTERVAL_MS + 50);
                        }
                    }
                });
            }
        };
    }

    /** Runs on the worker thread. Coordinates: item bounds are screen pixels. */
    private MenuGlassView.Model buildModel(Bitmap shot, BarDetector.Bar b, Rect wb, boolean windowOnly) {
        int offX = windowOnly ? wb.left : 0;
        int offY = windowOnly ? wb.top : 0;
        float scale = windowOnly && wb.width() > 0 ? shot.getWidth() / (float) wb.width() : 1f;
        int sw = shot.getWidth();
        int sh = shot.getHeight();

        int barCy = Math.round(((b.top + b.bottom) / 2f - offY) * scale);
        int barTopPx = Math.round((b.top - offY) * scale);
        int left = clamp((wb.left - offX) * scale, sw);
        int right = clamp((wb.right - offX) * scale, sw);

        // Bar colour: dominant colour across the bar row.
        int[] row = pixels(shot, left, clamp(barCy - dp(2) * scale, sh), right, clamp(barCy + dp(2) * scale, sh));
        int barColor = IconMath.dominant(row, 1, null)[0];

        // Find where the bar background really starts (it usually extends above the buttons).
        int limit = Math.max(0, barTopPx - Math.round(40 * density * scale));
        int[] cols = {left + Math.round(3 * density * scale), right - 1 - Math.round(3 * density * scale)};
        int best = barTopPx;
        for (int x : cols) {
            if (x < 0 || x >= sw) continue;
            int y = Math.min(sh - 1, barCy);
            while (y > limit && IconMath.dist(shot.getPixel(x, y - 1), barColor) < 10) y--;
            best = Math.min(best, y);
        }
        int edge = Math.min(barTopPx, best);

        int[] above = pixels(shot, left, clamp(edge - 14 * density * scale, sh), right,
                clamp(edge - 3 * density * scale, sh));
        int backdrop = above.length == 0 ? barColor : IconMath.dominant(above, 1, null)[0];

        MenuGlassView.Model m = new MenuGlassView.Model();
        m.count = b.items.size();
        m.icons = new Bitmap[m.count];
        m.barColor = barColor;
        m.backdrop = backdrop;
        m.selected = b.selectedIndex();
        for (int i = 0; i < m.count; i++) {
            BarDetector.Item it = b.items.get(i);
            int l = clamp((it.l - offX) * scale, sw), t = clamp((it.t - offY) * scale, sh);
            int r = clamp((it.r - offX) * scale, sw), btm = clamp((it.b - offY) * scale, sh);
            int w = r - l, h = btm - t;
            if (w < 2 || h < 2) continue;
            int[] px = new int[w * h];
            shot.getPixels(px, 0, w, l, t, w, h);
            double[] cov = new double[2];
            int[] dom = IconMath.dominant(px, 2, cov);
            int bg = IconMath.dist(dom[0], barColor) < 24 ? barColor : dom[0];
            int other = IconMath.dist(dom[0], bg) < 24 ? dom[1] : dom[0];
            double otherCov = IconMath.dist(dom[0], bg) < 24 ? cov[1] : cov[0];
            // A large flat second colour is the app's own selection pill: key it out too.
            int bg2 = otherCov >= 0.08 && IconMath.dist(other, bg) > 20 ? other : bg;
            int[] keyed = IconMath.keyOut(px, bg, bg2);
            int[] tb = IconMath.trim(keyed, w, h);
            if (tb == null) continue;
            int tw = tb[2] - tb[0], th = tb[3] - tb[1];
            int[] crop = new int[tw * th];
            for (int y = 0; y < th; y++) System.arraycopy(keyed, (tb[1] + y) * w + tb[0], crop, y * tw, tw);
            Bitmap icon = Bitmap.createBitmap(crop, tw, th, Bitmap.Config.ARGB_8888);
            if (scale != 1f) {
                icon = Bitmap.createScaledBitmap(icon, Math.max(1, Math.round(tw / scale)),
                        Math.max(1, Math.round(th / scale)), true);
            }
            m.icons[i] = icon;
        }

        // A heavily blurred copy of the content just above the bar, refracted into the glass.
        int lensTop = clamp(edge - 72 * density * scale, sh);
        int lensBottom = clamp(edge - 2 * density * scale, sh);
        if (lensBottom - lensTop > 8 && right - left > 8) {
            Bitmap lens = Bitmap.createBitmap(shot, left, lensTop, right - left, lensBottom - lensTop);
            while (lens.getWidth() > 48 && lens.getHeight() > 6) {
                Bitmap half = Bitmap.createScaledBitmap(lens, lens.getWidth() / 2, Math.max(1, lens.getHeight() / 2), true);
                if (lens != half) lens.recycle();
                lens = half;
            }
            m.lens = lens;
        }

        overlayTopPx = Math.round(edge / scale) + offY - dp(10);
        return m;
    }

    private static int clamp(float v, int max) {
        return Math.max(0, Math.min(max, Math.round(v)));
    }

    private static int[] pixels(Bitmap bmp, int l, int t, int r, int b) {
        l = Math.max(0, l);
        t = Math.max(0, t);
        r = Math.min(bmp.getWidth(), r);
        b = Math.min(bmp.getHeight(), b);
        if (r <= l || b <= t) return new int[0];
        int[] px = new int[(r - l) * (b - t)];
        bmp.getPixels(px, 0, r - l, l, t, r - l, b - t);
        return px;
    }

    // ---- overlay window ----

    private void show(MenuGlassView.Model m, BarDetector.Bar b, Rect wb, String sig, String pkg) {
        int top = Math.min(overlayTopPx, b.top - dp(4));
        int height = wb.bottom - top;
        if (height <= 0) return;
        m.bubbleCenterY = Math.round((b.top + b.bottom) / 2f) - top;

        if (view == null) {
            view = new MenuGlassView(svc);
            view.setListener(this);
        }
        view.setHaptics(prefs.getBoolean(Prefs.HAPTICS, true));
        if (lp == null) {
            lp = new WindowManager.LayoutParams(
                    WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                            | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                            | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                            | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
                            | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                    PixelFormat.TRANSLUCENT);
            lp.gravity = Gravity.TOP | Gravity.LEFT;
            lp.setFitInsetsTypes(0);
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS;
            lp.setTitle("LiquidGlassMenu");
        }
        boolean moved = lp.x != wb.left || lp.y != top || lp.width != wb.width() || lp.height != height;
        lp.x = wb.left;
        lp.y = top;
        lp.width = wb.width();
        lp.height = height;
        if (!attached) {
            try {
                wm.addView(view, lp);
                attached = true;
                view.setAlpha(0f);
                view.animate().alpha(1f).setDuration(140).start();
            } catch (RuntimeException e) {
                return;
            }
        } else if (moved) {
            wm.updateViewLayout(view, lp);
        }
        view.setModel(m);
        shownSignature = sig;
        Prefs.recordSeen(prefs, pkg);
    }

    private void hide() {
        main.removeCallbacks(shotTask);
        shownSignature = null;
        misses = 0;
        if (attached && view != null) {
            try {
                wm.removeViewImmediate(view);
            } catch (RuntimeException ignored) {
                // already gone
            }
        }
        attached = false;
    }

    // ---- input forwarding ----

    @Override
    public void onItem(int index, boolean longPress) {
        BarDetector.Bar b = bar;
        if (b == null || index >= b.items.size()) return;
        BarDetector.Item it = b.items.get(index);
        AccessibilityNodeInfo node = (AccessibilityNodeInfo) it.ref;
        boolean ok = false;
        if (node != null && node.refresh()) {
            ok = node.performAction(longPress ? AccessibilityNodeInfo.ACTION_LONG_CLICK
                    : AccessibilityNodeInfo.ACTION_CLICK);
        }
        if (!ok) tapThrough(Math.round(it.cx()), Math.round(it.cy()), longPress);
        scheduleScan(250);
        main.postDelayed(new Runnable() {
            @Override
            public void run() {
                scheduleScan(0);
            }
        }, 700);
    }

    /** Fallback: let one injected tap fall through the bubble onto the real button. */
    private void tapThrough(final int x, final int y, final boolean longPress) {
        if (!attached) return;
        lp.flags |= WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        wm.updateViewLayout(view, lp);
        main.postDelayed(new Runnable() {
            @Override
            public void run() {
                Path p = new Path();
                p.moveTo(x, y);
                GestureDescription g = new GestureDescription.Builder()
                        .addStroke(new GestureDescription.StrokeDescription(p, 0, longPress ? 650 : 40))
                        .build();
                boolean sent = svc.dispatchGesture(g, new AccessibilityService.GestureResultCallback() {
                    @Override
                    public void onCompleted(GestureDescription d) {
                        restoreTouch();
                    }

                    @Override
                    public void onCancelled(GestureDescription d) {
                        restoreTouch();
                    }
                }, main);
                if (!sent) restoreTouch();
            }
        }, 32);
    }

    private void restoreTouch() {
        if (lp == null) return;
        lp.flags &= ~WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
        if (attached) wm.updateViewLayout(view, lp);
    }
}
