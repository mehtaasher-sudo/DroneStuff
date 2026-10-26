package com.liquidglass.navbar;

import java.awt.image.BufferedImage;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import javax.imageio.ImageIO;

/** Plain-JVM tests for the bar detector and icon extraction (run by tests/run.sh). */
public class LogicTest {

    private static int failures;
    private static final float D = 3.5f; // ~xxhdpi phone, 1440 px wide
    private static final int W = 1440, BOTTOM = 3120;

    private static void check(boolean ok, String what) {
        System.out.println((ok ? "PASS " : "FAIL ") + what);
        if (!ok) failures++;
    }

    private static BarDetector.Item item(int l, int t, int r, int b, String label, boolean sel) {
        return new BarDetector.Item(l, t, r, b, label, sel);
    }

    public static void main(String[] args) throws Exception {
        String fixtures = args[0];
        String outDir = args.length > 1 ? args[1] : null;

        // Gmail: two wide tabs, first selected.
        List<BarDetector.Item> n = new ArrayList<>();
        n.add(item(0, 2860, 720, 3070, "Mail", true));
        n.add(item(720, 2860, 1440, 3070, "Chat", false));
        n.add(item(40, 2400, 1400, 2700, "Email row", false)); // list content above
        BarDetector.Bar bar = BarDetector.detect(n, 0, W, BOTTOM, D);
        check(bar != null && bar.items.size() == 2 && bar.selectedIndex() == 0, "Gmail two-tab bar detected, Mail selected");

        // Play Store: five labelled tabs.
        n.clear();
        String[] play = {"Games", "Apps", "Search", "Books", "You"};
        for (int i = 0; i < 5; i++) n.add(item(i * 288, 2800, (i + 1) * 288, 3070, play[i], i == 0));
        bar = BarDetector.detect(n, 0, W, BOTTOM, D);
        check(bar != null && bar.items.size() == 5 && bar.items.get(4).label.equals("You"), "Play Store five-tab bar detected");

        // Browser toolbar: seven evenly spaced icon buttons, plus nested clickable icons inside them.
        n.clear();
        for (int i = 0; i < 7; i++) {
            int cx = 100 + i * 206;
            n.add(item(cx - 90, 2880, cx + 90, 3040, "b" + i, false));
            n.add(item(cx - 40, 2920, cx + 40, 3000, "icon" + i, false));
        }
        bar = BarDetector.detect(n, 0, W, BOTTOM, D);
        check(bar != null && bar.items.size() == 7 && bar.items.get(0).label.equals("b0"),
                "Browser seven-button toolbar detected, outer buttons kept");

        // Dialog buttons in the middle of the screen: not a menu bar.
        n.clear();
        n.add(item(800, 1700, 1050, 1840, "Cancel", false));
        n.add(item(1100, 1700, 1350, 1840, "OK", false));
        check(BarDetector.detect(n, 0, W, BOTTOM, D) == null, "Centered dialog buttons ignored");

        // Two buttons at the bottom right only (span < half the width): not a menu bar.
        n.clear();
        n.add(item(800, 2900, 1050, 3040, "Cancel", false));
        n.add(item(1100, 2900, 1350, 3040, "OK", false));
        check(BarDetector.detect(n, 0, W, BOTTOM, D) == null, "Bottom-right action buttons ignored");

        // A single wide button (e.g. "Continue") is not a bar.
        n.clear();
        n.add(item(60, 2900, 1380, 3060, "Continue", false));
        check(BarDetector.detect(n, 0, W, BOTTOM, D) == null, "Single full-width button ignored");

        // Bar floating high above the bottom (keyboard open) is ignored.
        n.clear();
        for (int i = 0; i < 4; i++) n.add(item(i * 360, 1900, (i + 1) * 360, 2100, "t" + i, false));
        check(BarDetector.detect(n, 0, W, BOTTOM, D) == null, "Bar far from window bottom ignored");

        // ---- icon extraction on the real screenshots ----
        BufferedImage gmail = ImageIO.read(new File(fixtures, "gmail_bar.jpg"));
        int[] mail = crop(gmail, 0, 35, 720, 225);
        int barColor = IconMath.dominant(crop(gmail, 0, 100, 1439, 140), 1, null)[0];
        check(IconMath.dist(barColor, 0xFF343436) < 12, "Gmail bar colour found (" + hex(barColor) + ")");
        double[] cov = new double[2];
        int[] dom = IconMath.dominant(mail, 2, cov);
        int bg2 = IconMath.dist(dom[0], barColor) < 24 ? dom[1] : dom[0];
        check(IconMath.dist(bg2, 0xFF3D4760) < 16, "Gmail selection pill colour found (" + hex(bg2) + ")");
        int[] keyed = IconMath.keyOut(mail, barColor, bg2);
        check(alpha(keyed, 720, 320 - 0, 90 - 35) == 0, "Selection pill keyed out");
        check(alpha(keyed, 720, 100, 120 - 35) == 0, "Bar background keyed out");
        check(alpha(keyed, 720, 400, 110 - 35) > 200, "Envelope glyph kept");
        int[] tb = IconMath.trim(keyed, 720, 190);
        check(tb != null && tb[0] > 330 && tb[2] < 470, "Mail icon trimmed to the glyph " + str(tb));
        save(outDir, "gmail_mail.png", keyed, 720, 190, tb);

        int[] chat = crop(gmail, 720, 35, 1439, 225);
        int[] chatKeyed = IconMath.keyOut(chat, barColor, barColor);
        int[] ctb = IconMath.trim(chatKeyed, 719, 190);
        check(ctb != null && ctb[2] - ctb[0] < 140, "Chat icon isolated " + str(ctb));
        save(outDir, "gmail_chat.png", chatKeyed, 719, 190, ctb);

        BufferedImage playImg = ImageIO.read(new File(fixtures, "play_bar.jpg"));
        int playBar = IconMath.dominant(crop(playImg, 0, 30, 1440, 50), 1, null)[0];
        int[] games = crop(playImg, 0, 20, 288, 259);
        dom = IconMath.dominant(games, 2, cov);
        int pill = IconMath.dist(dom[0], playBar) < 24 ? dom[1] : dom[0];
        int[] gk = IconMath.keyOut(games, playBar, pill);
        check(alpha(gk, 288, 60, 80) == 0, "Play selection pill keyed out");
        check(alpha(gk, 288, 140, 80) > 200, "Play controller glyph kept");
        int[] gtb = IconMath.trim(gk, 288, 239);
        save(outDir, "play_games.png", gk, 288, 239, gtb);

        BufferedImage browser = ImageIO.read(new File(fixtures, "browser_bar.jpg"));
        int bBar = IconMath.dominant(crop(browser, 0, 200, 1439, 230), 1, null)[0];
        int[] home = crop(browser, 420, 140, 610, 290);
        int[] hk = IconMath.keyOut(home, bBar, bBar);
        int[] htb = IconMath.trim(hk, 190, 150);
        check(htb != null && htb[2] - htb[0] < 110, "Browser home icon isolated " + str(htb));
        save(outDir, "browser_home.png", hk, 190, 150, htb);

        System.out.println(failures == 0 ? "ALL PASSED" : failures + " FAILED");
        System.exit(failures == 0 ? 0 : 1);
    }

    private static int[] crop(BufferedImage img, int l, int t, int r, int b) {
        int w = r - l, h = b - t;
        int[] px = new int[w * h];
        img.getRGB(l, t, w, h, px, 0, w);
        for (int i = 0; i < px.length; i++) px[i] |= 0xFF000000;
        return px;
    }

    private static int alpha(int[] px, int w, int x, int y) {
        return px[y * w + x] >>> 24;
    }

    private static String hex(int c) {
        return String.format("#%06X", c & 0xFFFFFF);
    }

    private static String str(int[] a) {
        return a == null ? "null" : java.util.Arrays.toString(a);
    }

    private static void save(String dir, String name, int[] px, int w, int h, int[] tb) throws Exception {
        if (dir == null || tb == null) return;
        int tw = tb[2] - tb[0], th = tb[3] - tb[1];
        BufferedImage out = new BufferedImage(tw, th, BufferedImage.TYPE_INT_ARGB);
        for (int y = 0; y < th; y++) for (int x = 0; x < tw; x++) out.setRGB(x, y, px[(tb[1] + y) * w + tb[0] + x]);
        ImageIO.write(out, "png", new File(dir, name));
    }
}
