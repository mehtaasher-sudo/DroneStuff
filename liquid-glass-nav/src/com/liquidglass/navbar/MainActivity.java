package com.liquidglass.navbar;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CompoundButton;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;

/** Setup + settings screen with a live preview of the bubble. */
public class MainActivity extends Activity {

    private SharedPreferences prefs;
    private TextView status;
    private Button enable;
    private GlassPillView preview;
    private FrameLayout.LayoutParams previewLp;
    private FrameLayout stage;

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = Prefs.get(this);

        ScrollView scroll = new ScrollView(this);
        scroll.setFitsSystemWindows(true);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(20);
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root);

        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextSize(28);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(title);

        status = new TextView(this);
        status.setTextSize(15);
        status.setPadding(0, dp(6), 0, dp(14));
        root.addView(status);

        stage = new FrameLayout(this);
        GradientDrawable wallpaper = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[] {0xFF0EA5E9, 0xFF8B5CF6, 0xFFF43F5E, 0xFFF59E0B});
        wallpaper.setCornerRadius(dp(24));
        stage.setBackground(wallpaper);
        preview = new GlassPillView(this);
        previewLp = new FrameLayout.LayoutParams(0, 0, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        stage.addView(preview, previewLp);
        root.addView(stage, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(180)));

        enable = new Button(this);
        enable.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            }
        });
        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        blp.topMargin = dp(16);
        root.addView(enable, blp);

        TextView steps = new TextView(this);
        steps.setTextSize(13);
        steps.setAlpha(0.8f);
        steps.setPadding(0, dp(8), 0, dp(4));
        steps.setText("Setup:\n"
                + "1. Tap the button above, open \"Liquid Glass Nav\" and turn it on.\n"
                + "2. If the switch is greyed out (Android 13+, sideloaded app): open App info below, "
                + "tap the ⋮ menu → \"Allow restricted settings\", then repeat step 1.\n"
                + "3. Settings → System → Navigation mode → Gesture navigation, so the bubble "
                + "replaces the 3-button bar instead of sitting on top of it.\n\n"
                + "Gestures: tap = Back / Home / Recents. Slide your finger across the bubble and the glass "
                + "droplet follows it. Long-press Back = notifications, Home = assistant, "
                + "Recents = quick settings.\n\n"
                + "Real frosted blur needs Android 12+ and is switched off by the system in battery saver; "
                + "the bubble then falls back to a tinted glass look.");
        root.addView(steps);

        Button appInfo = new Button(this);
        appInfo.setText("Open App info (restricted settings)");
        appInfo.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.fromParts("package", getPackageName(), null)));
            }
        });
        root.addView(appInfo, blp);

        addSlider(root, "Width", Prefs.WIDTH_PCT, Prefs.DEF_WIDTH_PCT, 40, 100, "%");
        addSlider(root, "Height", Prefs.HEIGHT_DP, Prefs.DEF_HEIGHT_DP, 44, 76, " dp");
        addSlider(root, "Distance from bottom", Prefs.OFFSET_DP, Prefs.DEF_OFFSET_DP, 0, 48, " dp");
        addSlider(root, "Glass tint", Prefs.TINT, Prefs.DEF_TINT, 0, 100, "%");
        addSwitch(root, "Hide while keyboard is open", Prefs.HIDE_ON_IME);
        addSwitch(root, "Haptic feedback", Prefs.HAPTICS);

        setContentView(scroll);
        refreshPreview();
    }

    private void addSlider(LinearLayout root, final String label, final String key, int def,
            final int min, int max, final String unit) {
        final TextView t = new TextView(this);
        t.setPadding(0, dp(18), 0, dp(2));
        t.setTextSize(15);
        int value = prefs.getInt(key, def);
        t.setText(label + ": " + value + unit);
        root.addView(t);
        SeekBar bar = new SeekBar(this);
        bar.setMax(max - min);
        bar.setProgress(value - min);
        bar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override
            public void onProgressChanged(SeekBar s, int p, boolean fromUser) {
                int v = p + min;
                t.setText(label + ": " + v + unit);
                prefs.edit().putInt(key, v).apply();
                refreshPreview();
            }

            @Override
            public void onStartTrackingTouch(SeekBar s) {
            }

            @Override
            public void onStopTrackingTouch(SeekBar s) {
            }
        });
        root.addView(bar);
    }

    private void addSwitch(LinearLayout root, String label, final String key) {
        Switch sw = new Switch(this);
        sw.setText(label);
        sw.setTextSize(15);
        sw.setPadding(0, dp(14), 0, dp(4));
        sw.setChecked(prefs.getBoolean(key, true));
        sw.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton b, boolean checked) {
                prefs.edit().putBoolean(key, checked).apply();
                refreshPreview();
            }
        });
        root.addView(sw);
    }

    private void refreshPreview() {
        int stageW = getResources().getDisplayMetrics().widthPixels - dp(40);
        int shortSide = Math.min(getResources().getDisplayMetrics().widthPixels,
                getResources().getDisplayMetrics().heightPixels);
        previewLp.width = Math.min(stageW, shortSide * prefs.getInt(Prefs.WIDTH_PCT, Prefs.DEF_WIDTH_PCT) / 100);
        previewLp.height = dp(prefs.getInt(Prefs.HEIGHT_DP, Prefs.DEF_HEIGHT_DP));
        previewLp.bottomMargin = dp(prefs.getInt(Prefs.OFFSET_DP, Prefs.DEF_OFFSET_DP));
        preview.setLayoutParams(previewLp);
        boolean dark = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        // No real blur in the preview, so show it a bit more tinted than the live bubble.
        int c = GlassNavService.tintColor(dark, prefs.getInt(Prefs.TINT, Prefs.DEF_TINT), true);
        int a = Math.min(255, Color.alpha(c) + 40);
        preview.setDrawOwnTint(true, (a << 24) | (c & 0xFFFFFF));
        preview.setHaptics(prefs.getBoolean(Prefs.HAPTICS, true));
        preview.updateTheme();
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean on = isServiceEnabled();
        status.setText(on ? "✅ Running — the glass bubble is active in every app."
                : "⚪ Not enabled yet. Turn it on in Accessibility settings.");
        enable.setText(on ? "Open Accessibility settings" : "Enable Liquid Glass Nav");
    }

    private boolean isServiceEnabled() {
        String enabled = Settings.Secure.getString(getContentResolver(),
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
        if (enabled == null) return false;
        ComponentName me = new ComponentName(this, GlassNavService.class);
        for (String s : enabled.split(":")) {
            ComponentName c = ComponentName.unflattenFromString(s);
            if (me.equals(c)) return true;
        }
        return false;
    }
}
