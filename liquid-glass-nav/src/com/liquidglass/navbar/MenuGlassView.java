package com.liquidglass.navbar;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Rect;
import android.graphics.RectF;
import android.graphics.Shader;
import android.view.HapticFeedbackConstants;
import android.view.MotionEvent;
import android.view.View;
import android.view.animation.DecelerateInterpolator;
import android.view.animation.OvershootInterpolator;

/**
 * Covers an app's bottom menu bar and redraws its buttons inside a floating Liquid Glass
 * bubble: backdrop in the app's content colour, soft shadow, the content above the bar
 * blurred into the glass, specular highlight, refractive rim and a liquid selection droplet.
 */
public class MenuGlassView extends View {

    public interface Listener {
        void onItem(int index, boolean longPress);
    }

    /** Everything the view needs to draw one app's bar. */
    static final class Model {
        Bitmap[] icons;        // keyed-out icons (may contain nulls)
        int count;
        int selected = -1;
        int backdrop;          // colour of the app content right above the bar
        int barColor;          // colour of the app's original bar
        Bitmap lens;           // small blurred copy of the content above the bar (nullable)
        int bubbleCenterY;     // in view coordinates
    }

    private static final long LONG_PRESS_MS = 480;

    private final float dp;
    private final Paint backdropPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint glass = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint lensPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final Paint highlight = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint caustic = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint rim = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint drop = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint dropRim = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final Paint iconPaint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
    private final RectF bubble = new RectF();
    private final RectF tmp = new RectF();
    private final Rect src = new Rect();
    private final Path clip = new Path();

    private Model model;
    private Listener listener;
    private boolean haptics = true;
    private boolean light;

    private int pressed = -1;
    private boolean longFired;
    private float dropX;
    private float dropScale = 1f;
    private float dropAlpha;
    private float stretch;
    private ValueAnimator dropAnim;

    private final Runnable longPress = new Runnable() {
        @Override
        public void run() {
            if (pressed < 0) return;
            longFired = true;
            if (haptics) performHapticFeedback(HapticFeedbackConstants.LONG_PRESS);
            if (listener != null) listener.onItem(pressed, true);
        }
    };

    public MenuGlassView(Context context) {
        super(context);
        dp = context.getResources().getDisplayMetrics().density;
        rim.setStyle(Paint.Style.STROKE);
        rim.setStrokeWidth(1.2f * dp);
        dropRim.setStyle(Paint.Style.STROKE);
        dropRim.setStrokeWidth(1f * dp);
        setLayerType(LAYER_TYPE_HARDWARE, null);
    }

    public void setListener(Listener l) {
        listener = l;
    }

    public void setHaptics(boolean on) {
        haptics = on;
    }

    void setModel(Model m) {
        boolean first = model == null || model.count != m.count;
        model = m;
        light = IconMath.luminance(m.barColor) > 0.55;
        backdropPaint.setColor(m.backdrop);
        layoutBubble();
        if (pressed < 0) {
            if (m.selected >= 0) {
                float target = center(m.selected);
                if (first || dropAlpha < 0.01f) {
                    dropX = target;
                    animateDrop(1f, 1f, 200, new DecelerateInterpolator());
                } else {
                    slideDropTo(target);
                }
            } else {
                animateDrop(0.8f, 0f, 200, new DecelerateInterpolator());
            }
        }
        invalidate();
    }

    @Override
    protected void onSizeChanged(int w, int h, int ow, int oh) {
        layoutBubble();
    }

    private void layoutBubble() {
        if (model == null || getWidth() == 0) return;
        float w = getWidth();
        float margin = 16 * dp;
        float maxW = w - 2 * margin;
        float perItem = model.count <= 3 ? 104 * dp : maxW / model.count;
        float bw = Math.min(maxW, perItem * model.count);
        float bh = Math.min(64 * dp, getHeight() - 10 * dp);
        float cy = model.bubbleCenterY > 0 ? model.bubbleCenterY : getHeight() / 2f;
        cy = Math.max(bh / 2f + 8 * dp, Math.min(getHeight() - bh / 2f - 2 * dp, cy));
        bubble.set((w - bw) / 2f, cy - bh / 2f, (w + bw) / 2f, cy + bh / 2f);

        highlight.setShader(new LinearGradient(0, bubble.top, 0, bubble.top + bh * 0.55f,
                light ? 0x99FFFFFF : 0x3DFFFFFF, 0x00FFFFFF, Shader.TileMode.CLAMP));
        caustic.setShader(new LinearGradient(0, bubble.top + bh * 0.55f, 0, bubble.bottom,
                0x00FFFFFF, light ? 0x40FFFFFF : 0x1AFFFFFF, Shader.TileMode.CLAMP));
        rim.setShader(new LinearGradient(bubble.left, bubble.top, bubble.left + bw * 0.6f, bubble.bottom + bh,
                new int[] {light ? 0xFFFFFFFF : 0xD9FFFFFF, light ? 0x33FFFFFF : 0x1FFFFFFF,
                        light ? 0x1A000000 : 0x14FFFFFF, light ? 0xCCFFFFFF : 0x99FFFFFF},
                new float[] {0f, 0.35f, 0.7f, 1f}, Shader.TileMode.CLAMP));
        int bar = model.barColor;
        glass.setColor(Color.argb(light ? 200 : 214, Color.red(bar), Color.green(bar), Color.blue(bar)));
        glass.setShadowLayer(14 * dp, 0, 4 * dp, light ? 0x33000000 : 0x66000000);
        clip.reset();
        clip.addRoundRect(bubble, bh / 2f, bh / 2f, Path.Direction.CW);
    }

    private float segW() {
        return bubble.width() / Math.max(1, model.count);
    }

    private float center(int i) {
        return bubble.left + segW() * (i + 0.5f);
    }

    @Override
    protected void onDraw(Canvas c) {
        if (model == null) return;
        float w = getWidth();
        float h = getHeight();

        // Backdrop that hides the original bar; fades in at the top edge.
        float fade = 10 * dp;
        int bd = model.backdrop;
        backdropPaint.setShader(new LinearGradient(0, 0, 0, fade, bd & 0x00FFFFFF, bd, Shader.TileMode.CLAMP));
        c.drawRect(0, 0, w, h, backdropPaint);

        float r = bubble.height() / 2f;
        c.drawRoundRect(bubble, r, r, glass);

        if (model.lens != null) {
            c.save();
            c.clipPath(clip);
            lensPaint.setAlpha(light ? 70 : 90);
            src.set(0, 0, model.lens.getWidth(), model.lens.getHeight());
            c.drawBitmap(model.lens, src, bubble, lensPaint);
            c.restore();
        }

        c.drawRoundRect(bubble, r, r, highlight);
        c.drawRoundRect(bubble, r, r, caustic);
        if (dropAlpha > 0.01f) drawDroplet(c);

        for (int i = 0; i < model.count; i++) {
            Bitmap icon = model.icons == null || i >= model.icons.length ? null : model.icons[i];
            if (icon == null) continue;
            float maxH = bubble.height() - 12 * dp;
            float maxW = segW() - 6 * dp;
            float s = Math.min(1f, Math.min(maxH / icon.getHeight(), maxW / icon.getWidth()));
            if (i == pressed) s *= 1f + 0.08f * dropScale;
            float iw = icon.getWidth() * s;
            float ih = icon.getHeight() * s;
            float cx = center(i);
            float cy = bubble.centerY();
            tmp.set(cx - iw / 2f, cy - ih / 2f, cx + iw / 2f, cy + ih / 2f);
            c.drawBitmap(icon, null, tmp, iconPaint);
        }

        c.drawRoundRect(bubble, r, r, rim);
    }

    private void drawDroplet(Canvas c) {
        float baseW = Math.min(segW() - 6 * dp, 96 * dp);
        float baseH = bubble.height() - 8 * dp;
        float dw = baseW * dropScale * (1f + stretch);
        float dh = baseH * dropScale * (1f - stretch * 0.2f);
        float cy = bubble.centerY();
        tmp.set(dropX - dw / 2f, cy - dh / 2f, dropX + dw / 2f, cy + dh / 2f);
        float rr = dh / 2f;
        drop.setShader(null);
        drop.setColor(light ? 0x14000000 : 0x24FFFFFF);
        drop.setAlpha((int) (Color.alpha(drop.getColor()) * dropAlpha));
        c.drawRoundRect(tmp, rr, rr, drop);
        drop.setShader(new LinearGradient(0, tmp.top, 0, tmp.centerY(), 0x73FFFFFF, 0x00FFFFFF,
                Shader.TileMode.CLAMP));
        drop.setAlpha((int) (255 * dropAlpha));
        c.drawRoundRect(tmp, rr, rr, drop);
        dropRim.setColor(light ? 0xFFFFFFFF : 0xB3FFFFFF);
        dropRim.setAlpha((int) ((light ? 0xFF : 0xB3) * dropAlpha));
        c.drawRoundRect(tmp, rr, rr, dropRim);
    }

    private int indexAt(float x) {
        int i = (int) ((x - bubble.left) / segW());
        return Math.max(0, Math.min(model.count - 1, i));
    }

    @Override
    public boolean onTouchEvent(MotionEvent e) {
        if (model == null || model.count == 0) return true;
        float x = e.getX();
        switch (e.getActionMasked()) {
            case MotionEvent.ACTION_DOWN:
                tmp.set(bubble);
                tmp.inset(-8 * dp, -10 * dp);
                if (!tmp.contains(x, e.getY())) {
                    pressed = -1;
                    return true; // swallow taps on the backdrop so the hidden bar is not hit
                }
                longFired = false;
                pressed = indexAt(x);
                if (haptics) performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                if (dropAlpha < 0.01f) dropX = center(pressed);
                else slideDropTo(center(pressed));
                animateDrop(1.12f, 1f, 220, new OvershootInterpolator(2.2f));
                postDelayed(longPress, LONG_PRESS_MS);
                return true;
            case MotionEvent.ACTION_MOVE: {
                if (pressed < 0) return true;
                float target = Math.max(center(0), Math.min(center(model.count - 1), x));
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
                pressed = -1;
                if (idx < 0) return true;
                if (!longFired && listener != null) listener.onItem(idx, false);
                // Optimistically rest the droplet on the tapped item; the next scan confirms it.
                model.selected = idx;
                slideDropTo(center(idx));
                animateDrop(1f, 1f, 360, new OvershootInterpolator(3f));
                return true;
            }
            case MotionEvent.ACTION_CANCEL:
                removeCallbacks(longPress);
                pressed = -1;
                if (model.selected >= 0) {
                    slideDropTo(center(model.selected));
                    animateDrop(1f, 1f, 300, new DecelerateInterpolator());
                } else {
                    animateDrop(0.8f, 0f, 300, new DecelerateInterpolator());
                }
                return true;
            default:
                return true;
        }
    }

    private void slideDropTo(final float to) {
        final float from = dropX;
        ValueAnimator a = ValueAnimator.ofFloat(0f, 1f);
        a.setDuration(380);
        a.setInterpolator(new OvershootInterpolator(1.4f));
        a.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator v) {
                float f = (float) v.getAnimatedValue();
                dropX = from + (to - from) * f;
                // Liquid stretch: widest mid-flight, settles back to round.
                stretch = 0.3f * (float) Math.sin(Math.PI * Math.min(1f, f)) * Math.min(1f,
                        Math.abs(to - from) / Math.max(1f, segW()));
                invalidate();
            }
        });
        a.start();
    }

    private void animateDrop(final float scaleTo, final float alphaTo, long ms,
            android.animation.TimeInterpolator interp) {
        if (dropAnim != null) dropAnim.cancel();
        final float s0 = dropAlpha < 0.01f ? 0.6f : dropScale;
        final float a0 = dropAlpha;
        dropAnim = ValueAnimator.ofFloat(0f, 1f);
        dropAnim.setDuration(ms);
        dropAnim.setInterpolator(interp);
        dropAnim.addUpdateListener(new ValueAnimator.AnimatorUpdateListener() {
            @Override
            public void onAnimationUpdate(ValueAnimator v) {
                float f = (float) v.getAnimatedValue();
                dropScale = s0 + (scaleTo - s0) * f;
                dropAlpha = Math.max(0f, Math.min(1f, a0 + (alphaTo - a0) * Math.min(1f, f)));
                invalidate();
            }
        });
        dropAnim.start();
    }
}
