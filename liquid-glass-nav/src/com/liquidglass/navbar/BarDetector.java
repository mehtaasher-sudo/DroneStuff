package com.liquidglass.navbar;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * Finds an app's bottom menu bar (tab bar / bottom toolbar) among the clickable nodes of
 * its window: a single row of 2-7 similar, evenly spaced buttons hugging the window bottom.
 * Pure Java so it can be unit-tested off-device.
 */
final class BarDetector {

    static final class Item {
        final int l, t, r, b;
        final String label;
        final boolean selected;
        Object ref;

        Item(int l, int t, int r, int b, String label, boolean selected) {
            this.l = l;
            this.t = t;
            this.r = r;
            this.b = b;
            this.label = label == null ? "" : label;
            this.selected = selected;
        }

        int w() {
            return r - l;
        }

        int h() {
            return b - t;
        }

        float cx() {
            return (l + r) / 2f;
        }

        float cy() {
            return (t + b) / 2f;
        }

        boolean contains(Item o) {
            return l <= o.l && t <= o.t && r >= o.r && b >= o.b;
        }
    }

    static final class Bar {
        final List<Item> items;
        final int top, bottom;

        Bar(List<Item> items, int top, int bottom) {
            this.items = items;
            this.top = top;
            this.bottom = bottom;
        }

        int selectedIndex() {
            for (int i = 0; i < items.size(); i++) if (items.get(i).selected) return i;
            return -1;
        }

        /** Changes whenever the bar's buttons, labels or selection change. */
        String signature() {
            StringBuilder sb = new StringBuilder();
            sb.append(top).append(',').append(bottom);
            for (Item it : items) {
                sb.append('|').append(it.l).append(',').append(it.t).append(',').append(it.r).append(',')
                        .append(it.b).append(',').append(it.label).append(it.selected ? "*" : "");
            }
            return sb.toString();
        }
    }

    private BarDetector() {}

    /** Bottom band of the window in which a menu bar can live. */
    static int bandTop(int winBottom, float density) {
        return winBottom - Math.round(200 * density);
    }

    static Bar detect(List<Item> nodes, int winLeft, int winRight, int winBottom, float density) {
        int winW = winRight - winLeft;
        int bandTop = bandTop(winBottom, density);
        float minH = 28 * density;
        float maxH = 112 * density;
        float minW = 28 * density;

        List<Item> cands = new ArrayList<>();
        for (Item it : nodes) {
            if (it.t < bandTop || it.b > winBottom + 2) continue;
            if (it.h() < minH || it.h() > maxH) continue;
            if (it.w() < minW || it.w() > winW * 0.62f) continue;
            cands.add(it);
        }
        // Keep the outermost clickable of nested clickables (e.g. item container vs. icon).
        List<Item> outer = new ArrayList<>();
        for (Item a : cands) {
            boolean inner = false;
            for (Item b : cands) {
                if (a != b && b.contains(a) && !(a.contains(b) && cands.indexOf(a) < cands.indexOf(b))) {
                    inner = true;
                    break;
                }
            }
            if (!inner) outer.add(a);
        }

        List<Item> seeds = new ArrayList<>(outer);
        Collections.sort(seeds, new Comparator<Item>() {
            @Override
            public int compare(Item x, Item y) {
                return Float.compare(y.cy(), x.cy());
            }
        });

        float rowTol = 14 * density;
        for (Item seed : seeds) {
            List<Item> row = new ArrayList<>();
            for (Item it : outer) {
                if (Math.abs(it.cy() - seed.cy()) <= rowTol
                        && it.h() >= seed.h() * 0.6f && it.h() <= seed.h() * 1.6f) {
                    row.add(it);
                }
            }
            Bar bar = validate(row, winW, winBottom, density);
            if (bar != null) return bar;
        }
        return null;
    }

    private static Bar validate(List<Item> row, int winW, int winBottom, float density) {
        if (row.size() < 2 || row.size() > 7) return null;
        Collections.sort(row, new Comparator<Item>() {
            @Override
            public int compare(Item x, Item y) {
                return Float.compare(x.cx(), y.cx());
            }
        });
        int minL = Integer.MAX_VALUE, maxR = Integer.MIN_VALUE, top = Integer.MAX_VALUE, bottom = 0;
        int minW = Integer.MAX_VALUE, maxW = 0;
        for (int i = 0; i < row.size(); i++) {
            Item it = row.get(i);
            if (i > 0 && it.l < row.get(i - 1).r - Math.round(2 * density)) return null; // overlapping
            minL = Math.min(minL, it.l);
            maxR = Math.max(maxR, it.r);
            top = Math.min(top, it.t);
            bottom = Math.max(bottom, it.b);
            minW = Math.min(minW, it.w());
            maxW = Math.max(maxW, it.w());
        }
        if (maxR - minL < winW * 0.5f) return null;
        if (maxW > minW * 2.6f) return null;
        if (bottom < winBottom - 96 * density) return null;
        if (row.size() >= 3) {
            float minGap = Float.MAX_VALUE, maxGap = 0;
            for (int i = 1; i < row.size(); i++) {
                float g = row.get(i).cx() - row.get(i - 1).cx();
                minGap = Math.min(minGap, g);
                maxGap = Math.max(maxGap, g);
            }
            if (maxGap > minGap * 2.2f) return null;
        }
        return new Bar(new ArrayList<>(row), top, bottom);
    }
}
