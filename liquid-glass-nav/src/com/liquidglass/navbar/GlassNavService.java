package com.liquidglass.navbar;

import android.accessibilityservice.AccessibilityService;
import android.app.Dialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.util.DisplayMetrics;
import android.view.Gravity;
import android.view.Window;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityWindowInfo;

import java.lang.reflect.Method;
import java.util.List;

/**
 * Accessibility service that floats the Liquid Glass bubble above every app and maps
 * its buttons to system global actions (Back, Home, Recents).
 */
public class GlassNavService extends AccessibilityService
        implements SharedPreferences.OnSharedPreferenceChangeListener, GlassPillView.Listener {

    private static final int BLUR_RADIUS_DP = 22;

    private SharedPreferences prefs;
    private Dialog dialog;
    private GlassPillView pill;
    private boolean imeVisible;

    @Override
    protected void onServiceConnected() {
        prefs = Prefs.get(this);
        prefs.registerOnSharedPreferenceChangeListener(this);
        createOverlay();
    }

    private void createOverlay() {
        dialog = new Dialog(this, android.R.style.Theme_Translucent_NoTitleBar);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        pill = new GlassPillView(dialog.getContext());
        pill.setListener(this);
        dialog.setContentView(pill);
        dialog.setCancelable(false);

        Window w = dialog.getWindow();
        w.setType(WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY);
        w.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND);
        w.addFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                | WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
                | WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);
        w.setGravity(Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        w.setWindowAnimations(android.R.style.Animation_InputMethod);
        applySettings();
        dialog.show();
    }

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private boolean isDark() {
        int night = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        return night == Configuration.UI_MODE_NIGHT_YES;
    }

    /** Window-level blur (Android 12+) blurs whatever app is behind the bubble. */
    private boolean applyBlur(Window w, int radiusPx) {
        if (Build.VERSION.SDK_INT < 31) return false;
        try {
            WindowManager wm = (WindowManager) getSystemService(WINDOW_SERVICE);
            Method enabled = WindowManager.class.getMethod("isCrossWindowBlurEnabled");
            boolean on = (Boolean) enabled.invoke(wm);
            Method set = Window.class.getMethod("setBackgroundBlurRadius", int.class);
            set.invoke(w, on ? radiusPx : 0);
            return on;
        } catch (Exception e) {
            return false;
        }
    }

    static int tintColor(boolean dark, int tint, boolean blurred) {
        int alpha = blurred ? 24 + tint * 160 / 100 : 170 + tint * 80 / 100;
        int rgb = dark ? 0x1C1C1E : 0xF2F2F7;
        return (Math.min(255, alpha) << 24) | rgb;
    }

    private void applySettings() {
        if (dialog == null) return;
        Window w = dialog.getWindow();
        DisplayMetrics dm = getResources().getDisplayMetrics();
        int widthPct = prefs.getInt(Prefs.WIDTH_PCT, Prefs.DEF_WIDTH_PCT);
        int heightPx = dp(prefs.getInt(Prefs.HEIGHT_DP, Prefs.DEF_HEIGHT_DP));
        int offsetPx = dp(prefs.getInt(Prefs.OFFSET_DP, Prefs.DEF_OFFSET_DP));
        int tint = prefs.getInt(Prefs.TINT, Prefs.DEF_TINT);
        int shortSide = Math.min(dm.widthPixels, dm.heightPixels);
        int widthPx = Math.min(dm.widthPixels, shortSide * widthPct / 100);

        WindowManager.LayoutParams lp = w.getAttributes();
        lp.width = widthPx;
        lp.height = heightPx;
        lp.y = offsetPx;
        w.setAttributes(lp);

        boolean blurred = applyBlur(w, dp(BLUR_RADIUS_DP));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(heightPx / 2f);
        bg.setColor(tintColor(isDark(), tint, blurred));
        w.setBackgroundDrawable(bg);

        pill.setHaptics(prefs.getBoolean(Prefs.HAPTICS, true));
        pill.updateTheme();
    }

    @Override
    public void onSharedPreferenceChanged(SharedPreferences sp, String key) {
        applySettings();
        if (Prefs.HIDE_ON_IME.equals(key)) updateVisibility();
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applySettings();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event.getEventType() != AccessibilityEvent.TYPE_WINDOWS_CHANGED) return;
        boolean ime = false;
        List<AccessibilityWindowInfo> windows = getWindows();
        for (AccessibilityWindowInfo info : windows) {
            if (info.getType() == AccessibilityWindowInfo.TYPE_INPUT_METHOD) {
                ime = true;
                break;
            }
        }
        if (ime != imeVisible) {
            imeVisible = ime;
            updateVisibility();
        }
    }

    private void updateVisibility() {
        if (dialog == null) return;
        boolean hide = imeVisible && prefs.getBoolean(Prefs.HIDE_ON_IME, true);
        if (hide && dialog.isShowing()) {
            dialog.hide();
        } else if (!hide && !dialog.isShowing()) {
            dialog.show();
            applySettings();
        }
    }

    @Override
    public void onButton(int index, boolean longPress) {
        switch (index) {
            case GlassPillView.BACK:
                performGlobalAction(longPress ? GLOBAL_ACTION_NOTIFICATIONS : GLOBAL_ACTION_BACK);
                break;
            case GlassPillView.HOME:
                if (longPress) {
                    launchAssistant();
                } else {
                    performGlobalAction(GLOBAL_ACTION_HOME);
                }
                break;
            case GlassPillView.RECENTS:
                performGlobalAction(longPress ? GLOBAL_ACTION_QUICK_SETTINGS : GLOBAL_ACTION_RECENTS);
                break;
            default:
                break;
        }
    }

    private void launchAssistant() {
        try {
            Intent i = new Intent(Intent.ACTION_VOICE_COMMAND);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            performGlobalAction(GLOBAL_ACTION_HOME);
        }
    }

    @Override
    public void onInterrupt() {
    }

    @Override
    public void onDestroy() {
        if (prefs != null) prefs.unregisterOnSharedPreferenceChangeListener(this);
        if (dialog != null) {
            dialog.dismiss();
            dialog = null;
        }
        super.onDestroy();
    }
}
