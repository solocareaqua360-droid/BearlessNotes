/*
 * evaBoard: the iPhone-style key preview - one shape, not a box over the key: a wide rounded
 * head above the key that narrows down through curved shoulders to exactly the key's width and
 * becomes the key itself.
 */

package dev.patrickgold.florisboard.ime.eva

import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.geometry.CornerRadius

/**
 * @param keyLeft the key's left edge inside the shape's bounds (px); the head may be shifted
 *   sideways, so the key is not always centred under it
 * @param keyWidth the key's width (px)
 * @param keyHeight the key's height (px); the key part sits at the bottom of the bounds
 * @param headHeight height of the head (px), from the top of the bounds
 * @param headRadius corner radius of the head (px)
 * @param keyRadius corner radius of the key's bottom corners (px)
 * @param shoulder how far (px) each shoulder may reach out from the key's side. Where the head
 *   ends within that reach (the small press preview), the head's side curves straight into the
 *   key; where the head is wider (the long-press menu), its bottom runs flat and only a fillet
 *   of this width joins it to the neck.
 */
class EvaKeyPreviewShape(
    private val keyLeft: Float,
    private val keyWidth: Float,
    private val keyHeight: Float,
    private val headHeight: Float,
    private val headRadius: Float,
    private val keyRadius: Float,
    private val shoulder: Float = Float.MAX_VALUE,
) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val w = size.width
        val h = size.height
        val keyRight = keyLeft + keyWidth
        val keyTop = h - keyHeight
        val headBottom = headHeight
        val r = headRadius
        // Where each shoulder starts on the head: at the head's own edge, or on its flat bottom.
        val rightReach = keyRight + shoulder
        val leftReach = keyLeft - shoulder
        val rightFromSide = rightReach >= w - r
        val leftFromSide = leftReach <= r
        val mid = (headBottom - r / 2 + keyTop) / 2

        val path = Path().apply {
            moveTo(0f, r)
            arcTo(Rect(0f, 0f, r * 2, r * 2), 180f, 90f, false)
            lineTo(w - r, 0f)
            arcTo(Rect(w - r * 2, 0f, w, r * 2), 270f, 90f, false)
            if (rightFromSide) {
                // the head's right side curves straight into the key
                lineTo(w, headBottom - r / 2)
                cubicTo(w, mid, keyRight, mid, keyRight, keyTop)
            } else {
                // flat head bottom, then a concave fillet down into the neck
                lineTo(w, headBottom - r)
                arcTo(Rect(w - r * 2, headBottom - r * 2, w, headBottom), 0f, 90f, false)
                lineTo(rightReach, headBottom)
                val drop = keyTop - headBottom
                cubicTo(keyRight + shoulder * 0.35f, headBottom, keyRight, headBottom + drop * 0.35f, keyRight, keyTop)
            }
            lineTo(keyRight, h - keyRadius)
            arcTo(Rect(keyRight - keyRadius * 2, h - keyRadius * 2, keyRight, h), 0f, 90f, false)
            lineTo(keyLeft + keyRadius, h)
            arcTo(Rect(keyLeft, h - keyRadius * 2, keyLeft + keyRadius * 2, h), 90f, 90f, false)
            lineTo(keyLeft, keyTop)
            if (leftFromSide) {
                cubicTo(keyLeft, mid, 0f, mid, 0f, headBottom - r / 2)
            } else {
                val drop = keyTop - headBottom
                cubicTo(keyLeft, headBottom + drop * 0.35f, keyLeft - shoulder * 0.35f, headBottom, leftReach, headBottom)
                lineTo(r, headBottom)
                arcTo(Rect(0f, headBottom - r * 2, r * 2, headBottom), 90f, 90f, false)
            }
            close()
        }
        return Outline.Generic(path)
    }
}
