/*
 * evaBoard: the keyboard's "glass" edge - the user's iOS-glass recipe. The ground itself is
 * the theme's translucent window colour (#EBEBF5 / #1C1C1E at 80%); this adds the rounded top
 * corners and a hairline rim that fades from a faint highlight at the top to almost nothing.
 */

package dev.patrickgold.florisboard.ime.eva

import androidx.compose.foundation.border
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val GlassShape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)

/** Rounded top corners plus the rim; [dark] picks a white rim on dark glass, a black one on light. */
fun Modifier.evaGlass(dark: Boolean): Modifier {
    val rim = if (dark) Color(0x33FFFFFF) else Color(0x33000000)
    return this
        .clip(GlassShape)
        .border(
            width = 0.5.dp,
            brush = Brush.verticalGradient(listOf(rim, rim.copy(alpha = 0.05f))),
            shape = GlassShape,
        )
}
