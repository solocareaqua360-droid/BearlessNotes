/*
 * evaBoard: the keyboard's "glass" edge - the user's iOS-glass recipe. The ground itself is
 * the theme's translucent window colour (#EBEBF5 / #1C1C1E at 80%); this adds the rounded top
 * corners and a hairline rim that fades from a faint highlight at the top to almost nothing.
 * The full keyboard rounds its top corners too, as round as the screen's own.
 */

package dev.patrickgold.florisboard.ime.eva

import android.os.Build
import android.view.RoundedCorner
import androidx.compose.foundation.border
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Dp
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** The glass's own corner, when the full keyboard does not ask for the screen's. */
val EvaGlassCorner = 16.dp

/** Rounded top corners of [corner] plus the rim; [dark] picks a white rim on dark glass, a black one on light. */
fun Modifier.evaGlass(dark: Boolean, corner: Dp = EvaGlassCorner): Modifier {
    val shape = RoundedCornerShape(topStart = corner, topEnd = corner)
    val rim = if (dark) Color(0x33FFFFFF) else Color(0x33000000)
    return this
        .clip(shape)
        .border(
            width = 0.5.dp,
            brush = Brush.verticalGradient(listOf(rim, rim.copy(alpha = 0.05f))),
            shape = shape,
        )
}

/**
 * The screen's own corner radius (the full keyboard's top corners repeat it), as Android reports
 * it from Android 12 on; 24dp where it does not.
 */
@Composable
fun evaScreenCorner(): Dp {
    val view = LocalView.current
    val density = LocalDensity.current
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        val radius = view.rootWindowInsets?.getRoundedCorner(RoundedCorner.POSITION_BOTTOM_LEFT)?.radius ?: 0
        if (radius > 0) return with(density) { radius.toDp() }
    }
    return 24.dp
}
