package com.liquidglass.navbar;

import java.util.HashMap;
import java.util.Map;

/**
 * Pixel math for lifting an app's menu icons off its bar background: finds the flat
 * background colours (bar + selection pill), turns everything else into an alpha mask and
 * removes the background bleed from anti-aliased edges. Pure Java (ARGB int arrays).
 */
final class IconMath {

    private IconMath() {}

    private static int bucket(int c) {
        return ((c >> 20) & 0xF) << 8 | ((c >> 12) & 0xF) << 4 | ((c >> 4) & 0xF);
    }

    /** Most frequent colours (by 4-bit buckets), returned as the average colour of each bucket. */
    static int[] dominant(int[] px, int count, double[] coverageOut) {
        Map<Integer, long[]> acc = new HashMap<>();
        for (int c : px) {
            int k = bucket(c);
            long[] a = acc.get(k);
            if (a == null) {
                a = new long[4];
                acc.put(k, a);
            }
            a[0]++;
            a[1] += (c >> 16) & 0xFF;
            a[2] += (c >> 8) & 0xFF;
            a[3] += c & 0xFF;
        }
        int[] out = new int[count];
        long[] taken = new long[count];
        int[] keys = new int[count];
        for (int i = 0; i < count; i++) keys[i] = -1;
        for (Map.Entry<Integer, long[]> e : acc.entrySet()) {
            long n = e.getValue()[0];
            for (int i = 0; i < count; i++) {
                if (n > taken[i]) {
                    for (int j = count - 1; j > i; j--) {
                        taken[j] = taken[j - 1];
                        keys[j] = keys[j - 1];
                    }
                    taken[i] = n;
                    keys[i] = e.getKey();
                    break;
                }
            }
        }
        for (int i = 0; i < count; i++) {
            if (keys[i] < 0) {
                out[i] = out[0];
                if (coverageOut != null) coverageOut[i] = 0;
                continue;
            }
            long[] a = acc.get(keys[i]);
            out[i] = 0xFF000000 | (int) (a[1] / a[0]) << 16 | (int) (a[2] / a[0]) << 8 | (int) (a[3] / a[0]);
            if (coverageOut != null) coverageOut[i] = px.length == 0 ? 0 : a[0] / (double) px.length;
        }
        return out;
    }

    static double dist(int a, int b) {
        int dr = ((a >> 16) & 0xFF) - ((b >> 16) & 0xFF);
        int dg = ((a >> 8) & 0xFF) - ((b >> 8) & 0xFF);
        int db = (a & 0xFF) - (b & 0xFF);
        return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    /** Distance from colour p to the RGB segment a..b (blends of two backgrounds lie on it). */
    static double distToSegment(int p, int a, int b) {
        double ar = (a >> 16) & 0xFF, ag = (a >> 8) & 0xFF, ab = a & 0xFF;
        double vr = ((b >> 16) & 0xFF) - ar, vg = ((b >> 8) & 0xFF) - ag, vb = (b & 0xFF) - ab;
        double pr = ((p >> 16) & 0xFF) - ar, pg = ((p >> 8) & 0xFF) - ag, pb = (p & 0xFF) - ab;
        double len2 = vr * vr + vg * vg + vb * vb;
        double t = len2 == 0 ? 0 : Math.max(0, Math.min(1, (pr * vr + pg * vg + pb * vb) / len2));
        double dr = pr - t * vr, dg = pg - t * vg, db = pb - t * vb;
        return Math.sqrt(dr * dr + dg * dg + db * db);
    }

    static final double LOW = 22;
    static final double HIGH = 72;

    /**
     * Returns the icon pixels with the background(s) keyed out. bg2 may equal bg (single
     * background). Edge colours are un-mixed from the nearest background.
     */
    static int[] keyOut(int[] px, int bg, int bg2) {
        int[] out = new int[px.length];
        for (int i = 0; i < px.length; i++) {
            int p = px[i];
            double d = bg == bg2 ? dist(p, bg) : distToSegment(p, bg, bg2);
            double a = (d - LOW) / (HIGH - LOW);
            if (a <= 0) {
                out[i] = 0;
                continue;
            }
            if (a > 1) a = 1;
            int near = dist(p, bg) <= dist(p, bg2) ? bg : bg2;
            int r = unmix((p >> 16) & 0xFF, (near >> 16) & 0xFF, a);
            int g = unmix((p >> 8) & 0xFF, (near >> 8) & 0xFF, a);
            int b = unmix(p & 0xFF, near & 0xFF, a);
            out[i] = ((int) Math.round(a * 255)) << 24 | r << 16 | g << 8 | b;
        }
        return out;
    }

    private static int unmix(int p, int bg, double a) {
        double f = (p - (1 - a) * bg) / a;
        return (int) Math.max(0, Math.min(255, Math.round(f)));
    }

    /** Tight bounds {l, t, r, b} (exclusive r/b) of pixels with alpha above 40, or null if empty. */
    static int[] trim(int[] argb, int w, int h) {
        int l = w, t = h, r = -1, b = -1;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                if ((argb[y * w + x] >>> 24) > 40) {
                    if (x < l) l = x;
                    if (x > r) r = x;
                    if (y < t) t = y;
                    if (y > b) b = y;
                }
            }
        }
        return r < 0 ? null : new int[] {l, t, r + 1, b + 1};
    }

    static double luminance(int c) {
        return (0.2126 * ((c >> 16) & 0xFF) + 0.7152 * ((c >> 8) & 0xFF) + 0.0722 * (c & 0xFF)) / 255.0;
    }
}
