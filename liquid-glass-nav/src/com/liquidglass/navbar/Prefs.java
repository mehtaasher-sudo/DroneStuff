package com.liquidglass.navbar;

import android.content.Context;
import android.content.SharedPreferences;

/** Shared settings between the settings screen and the accessibility service. */
final class Prefs {
    static final String FILE = "glass_nav";
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

    private Prefs() {}

    static SharedPreferences get(Context c) {
        return c.getSharedPreferences(FILE, Context.MODE_PRIVATE);
    }
}
