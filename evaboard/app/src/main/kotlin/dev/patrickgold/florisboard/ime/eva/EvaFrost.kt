/*
 * evaBoard: "frosted glass" over the see-through keyboard ground.
 *
 * The phone does not allow a real blur of what lies behind the keyboard, so the look is
 * imitated: over the translucent ground go a soft top-to-bottom light gradient and a fine
 * grain of noise. With the theme's colours this reads much like the iPhone's blurred keyboard.
 */

package dev.patrickgold.florisboard.ime.eva

import android.graphics.Bitmap
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.asImageBitmap
import kotlin.random.Random

/** Strength of the effect: how much light the gradient adds at the top, how visible the grain is. */
private const val GRADIENT_LIGHT_ALPHA = 0.14f
private const val GRADIENT_DARK_ALPHA = 0.07f
private const val NOISE_ALPHA_MAX = 14 // of 255, per grain pixel
private const val NOISE_TILE = 128

/** Draws the frost over the keyboard's ground; [dark] picks the dark theme's gentler light. */
@Composable
fun BoxScope.EvaFrost(dark: Boolean) {
    val noise = remember { ShaderBrush(ImageShader(noiseTile(), TileMode.Repeated, TileMode.Repeated)) }
    val light = if (dark) GRADIENT_DARK_ALPHA else GRADIENT_LIGHT_ALPHA
    Canvas(modifier = Modifier.matchParentSize()) {
        drawRect(
            brush = Brush.verticalGradient(
                0f to Color.White.copy(alpha = light),
                0.6f to Color.White.copy(alpha = light / 3),
                1f to Color.Transparent,
            ),
        )
        drawRect(brush = noise)
    }
}

/** A tile of grain: each pixel black or white at a small random opacity, so it neither lightens nor darkens. */
private fun noiseTile() = Bitmap.createBitmap(NOISE_TILE, NOISE_TILE, Bitmap.Config.ARGB_8888).apply {
    val random = Random(7)
    val pixels = IntArray(NOISE_TILE * NOISE_TILE) {
        val alpha = random.nextInt(NOISE_ALPHA_MAX + 1)
        val shade = if (random.nextBoolean()) 0xFFFFFF else 0x000000
        (alpha shl 24) or shade
    }
    setPixels(pixels, 0, NOISE_TILE, 0, 0, NOISE_TILE, NOISE_TILE)
}.asImageBitmap()
