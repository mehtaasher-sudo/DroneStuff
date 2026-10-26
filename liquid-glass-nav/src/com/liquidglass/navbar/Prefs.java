package com.liquidglass.navbar;

import android.content.Context;
import android.content.SharedPreferences;

import java.util.HashSet;
import java.util.Set;

/** Shared settings between the settings screen and the accessibility service. */
final class Prefs {
    static final String FILE = "glass_nav";
    static final String MENU_ENABLED = "menu_enabled";
    static final String NAV_ENABLED = "nav_enabled";
    static final String EXCLUDED = "excluded_pkgs";
    static final String SEEN = "seen_pkgs";
    static final String WIDTH_PCT = "width_pct";
    static final String HEIGHT_DP = "height_dp";
    static final String OFFSET_DP = "offset_dp";
    static final String TINT = "tint";
    static final String HIDE_ON_IME = "hide_on_ime";
    static final String HAPTICS = "haptics";

    static final int DEF_WIDTH_PCT = 62;
    static final int DEF_HEIGHT_DP = 58;
    static final int DEF_OFFSET_DP = 10;
    static final int DEF_TINT = 30;

    private static final int MAX_SEEN = 60;

    private Prefs() {}

    static SharedPreferences get(Context c) {
        return c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }

    static Set<String> excluded(SharedPreferences p) {
        return p.getStringSet(EXCLUDED, new HashSet<String>());
    }

    static void setExcluded(SharedPreferences p, String pkg, boolean exclude) {
        Set<String> s = new HashSet<>(excluded(p));
        if (exclude) s.add(pkg);
        else s.remove(pkg);
        p.edit().putStringSet(EXCLUDED, s).apply();
    }

    /** Apps whose menu bar has been turned into glass, listed in settings for per-app opt-out. */
    static void recordSeen(SharedPreferences p, String pkg) {
        Set<String> seen = p.getStringSet(SEEN, new HashSet<String>());
        if (pkg == null || seen.contains(pkg) || seen.size() >= MAX_SEEN) return;
        Set<String> s = new HashSet<>(seen);
        s.add(pkg);
        p.edit().putStringSet(SEEN, s).apply();
    }
}
