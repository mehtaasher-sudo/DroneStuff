package com.liquidglass.navbar;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
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

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/** Setup + settings screen with live previews. */
public class MainActivity extends Activity {

    private SharedPreferences prefs;
    private TextView status;
    private Button enable;
    private GlassPillView navPreview;
    private FrameLayout.LayoutParams navPreviewLp;
    private LinearLayout navSettings;
    private LinearLayout appsList;

    private int dp(float v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }

    private boolean dark() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
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

        root.addView(menuPreview(), new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(200)));

        LinearLayout.LayoutParams blp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        blp.topMargin = dp(16);
        enable = new Button(this);
        enable.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
            }
        });
        root.addView(enable, blp);

        TextView steps = new TextView(this);
        steps.setTextSize(13);
        steps.setAlpha(0.8f);
        steps.setPadding(0, dp(8), 0, dp(4));
        steps.setText("Setup:\n"
                + "1. Tap the button above, open \"Liquid Glass Nav\" and turn it on. Android warns that the "
                + "service can see the screen: it needs that to read each app's menu buttons and copy their icons.\n"
                + "2. If the switch is greyed out (Android 13+, sideloaded app): open App info below, tap the "
                + "⋮ menu → \"Allow restricted settings\", then repeat step 1.\n\n"
                + "How it works: when an app shows a bottom menu bar (Gmail, Play Store, browsers, ...), the bar is "
                + "replaced by a floating glass bubble with the same icons. Tap or slide across it — the glass "
                + "droplet follows your finger and the app's real button is pressed. Apps with a protected screen "
                + "(banking, etc.) are left untouched.\n\n"
                + (Build.VERSION.SDK_INT >= 34 ? ""
                : Build.VERSION.SDK_INT >= 30
                        ? "Note: on Android 11–13 the original bar flashes briefly while icons are copied; "
                        + "Android 14+ copies them invisibly.\n"
                        : "Glass menu bars need Android 11 or newer; on this phone only the floating navigation "
                        + "buttons are available.\n"));
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

        header(root, "App menu bars");
        addSwitch(root, "Liquid Glass app menu bars", Prefs.MENU_ENABLED, true, null);
        addSwitch(root, "Haptic feedback", Prefs.HAPTICS, true, null);
        TextView appsHint = new TextView(this);
        appsHint.setTextSize(13);
        appsHint.setAlpha(0.7f);
        appsHint.setText("Apps where the glass bar has been used. Switch an app off to keep its original bar.");
        appsHint.setPadding(0, dp(8), 0, 0);
        root.addView(appsHint);
        appsList = new LinearLayout(this);
        appsList.setOrientation(LinearLayout.VERTICAL);
        root.addView(appsList);

        header(root, "Floating navigation buttons");
        navSettings = new LinearLayout(this);
        navSettings.setOrientation(LinearLayout.VERTICAL);
        addSwitch(root, "Glass Back / Home / Recents bubble", Prefs.NAV_ENABLED, false, new Runnable() {
            @Override
            public void run() {
                navSettings.setVisibility(prefs.getBoolean(Prefs.NAV_ENABLED, false) ? View.VISIBLE : View.GONE);
            }
        });
        root.addView(navSettings);
        navSettings.addView(navPreview(), new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(120)));
        TextView navHint = new TextView(this);
        navHint.setTextSize(13);
        navHint.setAlpha(0.7f);
        navHint.setPadding(0, dp(8), 0, 0);
        navHint.setText("Use with Settings → System → Navigation mode → Gesture navigation. "
                + "Long-press Back = notifications, Home = assistant, Recents = quick settings.");
        navSettings.addView(navHint);
        addSlider(navSettings, "Width", Prefs.WIDTH_PCT, Prefs.DEF_WIDTH_PCT, 40, 100, "%");
        addSlider(navSettings, "Height", Prefs.HEIGHT_DP, Prefs.DEF_HEIGHT_DP, 44, 76, " dp");
        addSlider(navSettings, "Distance from bottom", Prefs.OFFSET_DP, Prefs.DEF_OFFSET_DP, 0, 48, " dp");
        addSlider(navSettings, "Glass tint", Prefs.TINT, Prefs.DEF_TINT, 0, 100, "%");
        addSwitch(navSettings, "Hide while keyboard is open", Prefs.HIDE_ON_IME, true, null);
        navSettings.setVisibility(prefs.getBoolean(Prefs.NAV_ENABLED, false) ? View.VISIBLE : View.GONE);

        setContentView(scroll);
        refreshNavPreview();
    }

    private void header(LinearLayout root, String text) {
        TextView t = new TextView(this);
        t.setText(text);
        t.setTextSize(20);
        t.setTypeface(Typeface.DEFAULT_BOLD);
        t.setPadding(0, dp(28), 0, dp(4));
        root.addView(t);
    }

    /** A mock app screen with a glass menu bubble using drawn icons. */
    private View menuPreview() {
        boolean dark = dark();
        int content = dark ? 0xFF1F1F1F : 0xFFFFFFFF;
        int bar = dark ? 0xFF333333 : 0xFFF0F4F9;
        int ink = dark ? 0xFFE3E3E3 : 0xFF444746;
        int accent = dark ? 0xFFA8C7FA : 0xFF0B57D0;

        FrameLayout stage = new FrameLayout(this);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(content);
        bg.setCornerRadius(dp(24));
        stage.setBackground(bg);
        stage.setClipToOutline(true);

        LinearLayout rows = new LinearLayout(this);
        rows.setOrientation(LinearLayout.VERTICAL);
        rows.setPadding(dp(18), dp(18), dp(18), 0);
        int[] colors = {0xFF8B5CF6, 0xFF0EA5E9, 0xFFF59E0B};
        for (int c : colors) {
            View row = new View(this);
            GradientDrawable d = new GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                    new int[] {c, dark ? 0xFF2A2A2A : 0xFFF1F3F4});
            d.setCornerRadius(dp(14));
            row.setBackground(d);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(34));
            lp.bottomMargin = dp(10);
            rows.addView(row, lp);
        }
        stage.addView(rows);

        MenuGlassView glass = new MenuGlassView(this);
        MenuGlassView.Model m = new MenuGlassView.Model();
        m.count = 4;
        m.icons = new Bitmap[] {glyph(0, accent), glyph(1, ink), glyph(2, ink), glyph(3, ink)};
        m.selected = 0;
        m.backdrop = content;
        m.barColor = bar;
        m.bubbleCenterY = dp(46);
        glass.setModel(m);
        stage.addView(glass, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(88), Gravity.BOTTOM));
        return stage;
    }

    private Bitmap glyph(int kind, int color) {
        int s = dp(26);
        Bitmap b = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(b);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG);
        p.setColor(color);
        p.setStyle(Paint.Style.STROKE);
        p.setStrokeWidth(dp(2.2f));
        p.setStrokeCap(Paint.Cap.ROUND);
        p.setStrokeJoin(Paint.Join.ROUND);
        float u = s / 24f;
        Path path = new Path();
        switch (kind) {
            case 0: // home
                path.moveTo(4 * u, 11 * u);
                path.lineTo(12 * u, 4 * u);
                path.lineTo(20 * u, 11 * u);
                path.lineTo(20 * u, 20 * u);
                path.lineTo(4 * u, 20 * u);
                path.close();
                c.drawPath(path, p);
                break;
            case 1: // search
                c.drawCircle(10.5f * u, 10.5f * u, 6 * u, p);
                c.drawLine(15 * u, 15 * u, 20 * u, 20 * u, p);
                break;
            case 2: // mail
                RectF r = new RectF(3 * u, 6 * u, 21 * u, 18 * u);
                c.drawRoundRect(r, 2 * u, 2 * u, p);
                path.moveTo(4 * u, 7 * u);
                path.lineTo(12 * u, 13 * u);
                path.lineTo(20 * u, 7 * u);
                c.drawPath(path, p);
                break;
            default: // person
                c.drawCircle(12 * u, 8.5f * u, 4 * u, p);
                path.moveTo(4.5f * u, 20 * u);
                path.cubicTo(5 * u, 14 * u, 19 * u, 14 * u, 19.5f * u, 20 * u);
                c.drawPath(path, p);
                break;
        }
        return b;
    }

    private View navPreview() {
        FrameLayout stage = new FrameLayout(this);
        GradientDrawable wallpaper = new GradientDrawable(GradientDrawable.Orientation.TL_BR,
                new int[] {0xFF0EA5E9, 0xFF8B5CF6, 0xFFF43F5E, 0xFFF59E0B});
        wallpaper.setCornerRadius(dp(24));
        stage.setBackground(wallpaper);
        navPreview = new GlassPillView(this);
        navPreviewLp = new FrameLayout.LayoutParams(0, 0, Gravity.BOTTOM | Gravity.CENTER_HORIZONTAL);
        stage.addView(navPreview, navPreviewLp);
        return stage;
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
                refreshNavPreview();
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

    private void addSwitch(LinearLayout root, String label, final String key, boolean def, final Runnable after) {
        Switch sw = new Switch(this);
        sw.setText(label);
        sw.setTextSize(15);
        sw.setPadding(0, dp(14), 0, dp(4));
        sw.setChecked(prefs.getBoolean(key, def));
        sw.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton b, boolean checked) {
                prefs.edit().putBoolean(key, checked).apply();
                refreshNavPreview();
                if (after != null) after.run();
            }
        });
        root.addView(sw);
    }

    private void refreshNavPreview() {
        int stageW = getResources().getDisplayMetrics().widthPixels - dp(40);
        int shortSide = Math.min(getResources().getDisplayMetrics().widthPixels,
                getResources().getDisplayMetrics().heightPixels);
        navPreviewLp.width = Math.min(stageW, shortSide * prefs.getInt(Prefs.WIDTH_PCT, Prefs.DEF_WIDTH_PCT) / 100);
        navPreviewLp.height = dp(prefs.getInt(Prefs.HEIGHT_DP, Prefs.DEF_HEIGHT_DP));
        navPreviewLp.bottomMargin = dp(prefs.getInt(Prefs.OFFSET_DP, Prefs.DEF_OFFSET_DP));
        navPreview.setLayoutParams(navPreviewLp);
        // No real blur in the preview, so show it a bit more tinted than the live bubble.
        int c = GlassNavService.tintColor(dark(), prefs.getInt(Prefs.TINT, Prefs.DEF_TINT), true);
        int a = Math.min(255, Color.alpha(c) + 40);
        navPreview.setDrawOwnTint(true, (a << 24) | (c & 0xFFFFFF));
        navPreview.setHaptics(prefs.getBoolean(Prefs.HAPTICS, true));
        navPreview.updateTheme();
    }

    private void refreshApps() {
        appsList.removeAllViews();
        List<String> seen = new ArrayList<>(prefs.getStringSet(Prefs.SEEN, Collections.<String>emptySet()));
        Collections.sort(seen);
        Set<String> excluded = Prefs.excluded(prefs);
        PackageManager pm = getPackageManager();
        if (seen.isEmpty()) {
            TextView none = new TextView(this);
            none.setText("None yet — open an app with a bottom menu bar.");
            none.setTextSize(14);
            none.setPadding(0, dp(8), 0, 0);
            appsList.addView(none);
        }
        for (final String pkg : seen) {
            String name = pkg;
            try {
                name = pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
            } catch (PackageManager.NameNotFoundException ignored) {
                // not visible to this app; show the package name
            }
            Switch sw = new Switch(this);
            sw.setText(name);
            sw.setTextSize(15);
            sw.setPadding(0, dp(10), 0, dp(2));
            sw.setChecked(!excluded.contains(pkg));
            sw.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
                @Override
                public void onCheckedChanged(CompoundButton b, boolean checked) {
                    Prefs.setExcluded(prefs, pkg, !checked);
                }
            });
            appsList.addView(sw);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        boolean on = isServiceEnabled();
        status.setText(on ? "✅ Running — app menu bars are turned into Liquid Glass."
                : "⚪ Not enabled yet. Turn it on in Accessibility settings.");
        enable.setText(on ? "Open Accessibility settings" : "Enable Liquid Glass Nav");
        refreshApps();
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
