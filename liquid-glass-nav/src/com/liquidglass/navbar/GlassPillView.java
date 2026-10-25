package com.liquidglass.navbar;

import android.animation.ValueAnimator;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.RectF;
import android.graphics.Shader;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;

/**
 * The floating glass bubble: specular highlight, refractive rim, a liquid "droplet"
 * lens that follows the finger between buttons, and Back / Home / Recents glyphs.
 * The frosted blur itself comes from the window (Window#setBackgroundBlurRadius).
 */
public class GlassPillView extends View {

    public interface Listener {
        void onButton(int index, boolean longPress);
    }

    static final int BACK = 0;
    static final int HOME = 1;
    static final int RECENTS = 2;
    private static final int COUNT = 3;
    private static final long LONG_PRESS_MS = 450;

    private final float dp;
    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint highlight = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint caustic = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint rim = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dropFill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dropRim = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint icon = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final RectF rect = new RectF();
    private final RectF tmp = new RectF();
    private final Path path = new Path();

    private Listener listener;
    private boolean drawOwnTint;
    private int tintColor;
    private boolean haptics = true;
    private boolean dark;

    private int pressed = -1;
    private boolean longFired;
    private float dropX;
    private float dropScale;
    private float dropAlpha;
    private float stretch;
    private ValueAnimator dropAnim;

    private final Runnable longPress = new Runnable() {
        @Override
        public void run() {
            if (pressed < 0) return;
            longFired = true;
            if (haptics) performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
            if (listener != null) listener.onButton(pressed, true);
        }
    };

    public GlassPillView(Context context) {
        super(context);
        dp = context.getResources().getDisplayMetrics().density;
        rim.setStyle(Paint.Style.STROKE);
        rim.setStrokeWidth(1.2f * dp);
        dropRim.setStyle(Paint.Style.STROKE);
        dropRim.setStrokeWidth(1f * dp);
        icon.setStyle(Paint.Style.STROKE);
        icon.setStrokeWidth(2.2f * dp);
        icon.setStrokeCap(Paint.Cap.ROUND);
        icon.setStrokeJoin(Paint.Join.ROUND);
        setLayerType(LAYER_TYPE_HARDWARE, null);
        updateTheme();
    }

    public void setListener(Listener l) {
        listener = l;
    }

    /** In the settings preview there is no window blur, so the view paints its own tint. */
    public void setDrawOwnTint(boolean own, int color) {
        drawOwnTint = own;
        tintColor = color;
        invalidate();
    }

    public void setHaptics(boolean on) {
        haptics = on;
    }

    public void updateTheme() {
        int night = getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK;
        dark = night == Configuration.UI_MODE_NIGHT_YES;
        icon.setColor(dark ? 0xF2FFFFFF : 0xE61C1C1E);
        icon.setShadowLayer(dark ? 2f * dp : 0f, 0, 0, 0x40000000);
        rebuildShaders(getWidth(), getHeight());
        invalidate();
    }

    @Override
    protected void onSizeChanged(int w, int h, int oldw, int oldh) {
        rebuildShaders(w, h);
        if (pressed < 0) dropX = w / 2f;
    }

    private void rebuildShaders(int w, int h) {
        if (w == 0 || h == 0) return;
        int hiTop = dark ? 0x40FFFFFF : 0x80FFFFFF;
        highlight.setShader(new LinearGradient(0, 0, 0, h * 0.55f, hiTop, 0x00FFFFFF, Shader.TileMode.CLAMP));
        caustic.setShader(new LinearGradient(0, h * 0.55f, 0, h, 0x00FFFFFF, dark ? 0x1AFFFFFF : 0x33FFFFFF,
                Shader.TileMode.CLAMP));
        rim.setShader(new LinearGradient(0, 0, w * 0.6f, h * 1.6f,
                new int[] {0xE6FFFFFF, 0x26FFFFFF, 0x14FFFFFF, 0xA6FFFFFF},
                new float[] {0f, 0.35f, 0.7f, 1f}, Shader.TileMode.CLAMP));
    }

    private float segW() {
        return getWidth() / (float) COUNT;
    }

    private float center(int i) {
        return segW() * (i + 0.5f);
    }

    @Override
    protected void onDraw(Canvas c) {
        float w = getWidth();
        float h = getHeight();
        if (w == 0 || h == 0) return;
        float r = h / 2f;

        rect.set(0, 0, w, h);
        if (drawOwnTint) {
            fill.setColor(tintColor);
            c.drawRoundRect(rect, r, r, fill);
        }

        float in = 0.8f * dp;
        rect.set(in, in, w - in, h - in);
        c.drawRoundRect(rect, r - in, r - in, highlight);
        c.drawRoundRect(rect, r - in, r - in, caustic);

        if (dropAlpha > 0.01f) drawDroplet(c, h);

        c.drawRoundRect(rect, r - in, r - in, rim);

        for (int i = 0; i < COUNT; i++) {
            float s = (i == pressed) ? 1f + 0.12f * dropScale : 1f;
            drawGlyph(c, i, center(i), h / 2f, 11f * dp * s);
        }
    }

    private void drawDroplet(Canvas c, float h) {
        float baseW = segW() * 0.84f;
        float baseH = h - 9f * dp;
        float dw = baseW * dropScale * (1f + stretch);
        float dh = baseH * dropScale * (1f - stretch * 0.25f);
        tmp.set(dropX - dw / 2f, h / 2f - dh / 2f, dropX + dw / 2f, h / 2f + dh / 2f);
        float rr = dh / 2f;
        int a = (int) (255 * dropAlpha);
        dropFill.setColor(dark ? 0x2EFFFFFF : 0x4DFFFFFF);
        dropFill.setAlpha((int) (Color.alpha(dropFill.getColor()) * dropAlpha));
        c.drawRoundRect(tmp, rr, rr, dropFill);
        dropFill.setShader(new LinearGradient(0, tmp.top, 0, tmp.centerY(), 0x66FFFFFF, 0x00FFFFFF,
                Shader.TileMode.CLAMP));
        dropFill.setAlpha(a);
        c.drawRoundRect(tmp, rr, rr, dropFill);
        dropFill.setShader(null);
        dropRim.setColor(0xB3FFFFFF);
        dropRim.setAlpha((int) (0xB3 * dropAlpha));
        c.drawRoundRect(tmp, rr, rr, dropRim);
    }

    private void drawGlyph(Canvas c, int i, float cx, float cy, float s) {
        path.reset();
        switch (i) {
            case BACK:
                path.moveTo(cx + s * 0.35f, cy - s * 0.75f);
                path.lineTo(cx - s * 0.4f, cy);
                path.lineTo(cx + s * 0.35f, cy + s * 0.75f);
                c.drawPath(path, icon);
                break;
            case HOME:
                c.drawCircle(cx, cy, s * 0.72f, icon);
                break;
            case RECENTS:
                tmp.set(cx - s * 0.66f, cy - s * 0.66f, cx + s * 0.66f, cy + s * 0.66f);
                c.drawRoundRect(tmp, s * 0.28f, s * 0.28f, icon);
                break;
            default:
                break;
        }
    }

    private int indexAt(float x) {
        int i = (int) (x / segW());
        return Math.max(0, Math.min(COUNT - 1, i));
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        float x = e.getX();
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN: {
                longFired = false;
                pressed = indexAt(x);
                if (haptics) performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                dropX = center(pressed);
                animateDroplet(1f, 1f, 220, new OvershootInterpolator(2.2f));
                postDelayed(longPress, LONG_PRESS_MS);
                return true;
            }
            case MotionEvent.ACTION_MOVE: {
                float min = center(0);
                float max = center(COUNT - 1);
                float target = Math.max(min, Math.min(max, x));
                stretch = Math.min(0.35f, Math.abs(target - dropX) / segW() * 2.5f);
                dropX = target;
                int idx = indexAt(x);
                if (idx != pressed && !longFired) {
                    pressed = idx;
                    removeCallbacks(longPress);
                    postDelayed(longPress, LONG_PRESS_MS);
                    if (haptics) performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);
                }
                invalidate();
                return true;
            }
            case MotionEvent.ACTION_UP: {
                removeCallbacks(longPress);
                int idx = pressed;
                if (!longFired && idx >= 0 && listener != null) listener.onButton(idx, false);
                release(idx);
                return true;
            }
            case MotionEvent.ACTION_CANCEL:
                removeCallbacks(longPress);
                release(pressed);
                return true;
            default:
                return super.onTouchEvent(e);
        }
    }

    private void release(int idx) {
        if (idx >= 0) {
            final float from = dropX;
            final float to = center(idx);
            ValueAnimator snap = ValueAnimator.ofFloat(0f, 1f);
            snap.setDuration(160);
            snap.setInterpolator(new DecelerateInterpolator());
            snap.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
                @Override
                public void onAnimationUpdate(ValueAnimator a) {
                    float f = (float) a.getAnimatedValue();
                    dropX = from + (to - from) * f;
                    stretch = stretch * (1f - f);
                    invalidate();
                }
            });
            snap.start();
        }
        pressed = -1;
        animateDroplet(0.7f, 0f, 320, new DecelerateInterpolator());
    }

    private void animateDroplet(final float scaleTo, final float alphaTo, long ms,
            android.animation.TimeInterpolator interp) {
        if (dropAnim != null) dropAnim.cancel();
        final float s0 = dropAlpha < 0.01f ? 0.6f : dropScale;
        final float a0 = dropAlpha;
        dropAnim = ValueAnimator.ofFloat(0f, 1f);
        dropAnim.setDuration(ms);
        dropAnim.setInterpolator(interp);
        dropAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator a) {
                float f = (float) a.getAnimatedValue();
                dropScale = s0 + (scaleTo - s0) * f;
                dropAlpha = Math.max(0f, Math.min(1f, a0 + (alphaTo - a0) * Math.min(1f, f)));
                invalidate();
            }
        });
        dropAnim.start();
    }
}
