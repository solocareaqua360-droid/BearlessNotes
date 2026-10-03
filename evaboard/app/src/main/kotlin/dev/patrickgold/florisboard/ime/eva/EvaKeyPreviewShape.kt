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
 * @param keyLeft the key's left edge inside the preview's bounds (px); the head may be shifted
 *   sideways at the keyboard's edges, so the key is not always centred under it
 * @param keyWidth the key's width (px)
 * @param keyHeight the key's height (px); the key part sits at the bottom of the bounds
 * @param headHeight height of the head (px), from the top of the bounds
 * @param headRadius corner radius of the head (px)
 * @param keyRadius corner radius of the key's bottom corners (px)
 */
class EvaKeyPreviewShape(
    private val keyLeft: Float,
    private val keyWidth: Float,
    private val keyHeight: Float,
    private val headHeight: Float,
    private val headRadius: Float,
    private val keyRadius: Float,
) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val w = size.width
        val h = size.height
        val keyRight = keyLeft + keyWidth
        val keyTop = h - keyHeight
        // The shoulders run from the head's bottom corners down to the key's top corners.
        val shoulderTop = headHeight - headRadius / 2
        val mid = (shoulderTop + keyTop) / 2

        val path = Path().apply {
            // head, top edge and corners
            moveTo(0f, headRadius)
            arcTo(Rect(0f, 0f, headRadius * 2, headRadius * 2), 180f, 90f, false)
            lineTo(w - headRadius, 0f)
            arcTo(Rect(w - headRadius * 2, 0f, w, headRadius * 2), 270f, 90f, false)
            // right side of the head, then the right shoulder curving in to the key
            lineTo(w, shoulderTop)
            cubicTo(w, mid, keyRight, mid, keyRight, keyTop)
            // the key's right side and rounded bottom
            lineTo(keyRight, h - keyRadius)
            arcTo(Rect(keyRight - keyRadius * 2, h - keyRadius * 2, keyRight, h), 0f, 90f, false)
            lineTo(keyLeft + keyRadius, h)
            arcTo(Rect(keyLeft, h - keyRadius * 2, keyLeft + keyRadius * 2, h), 90f, 90f, false)
            // the key's left side, then the left shoulder back out to the head
            lineTo(keyLeft, keyTop)
            cubicTo(keyLeft, mid, 0f, mid, 0f, shoulderTop)
            close()
        }
        return Outline.Generic(path)
    }
}
