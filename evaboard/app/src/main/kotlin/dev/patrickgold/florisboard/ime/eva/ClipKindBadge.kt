/*
 * evaBoard: the small icon in a clipboard card's top left corner that says what the card is - text, link or
 * picture. Over a picture it sits on a dark translucent disc so it reads on any image; on a text card it is a
 * quiet icon in the card's own colour.
 */

package dev.patrickgold.florisboard.ime.eva

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import org.florisboard.lib.snygg.ui.SnyggIcon

@Composable
fun ClipKindBadge(icon: String, overPicture: Boolean, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .padding(8.dp)
            .size(24.dp)
            .then(if (overPicture) Modifier.background(Color.Black.copy(alpha = 0.5f), CircleShape) else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        if (overPicture) {
            Icon(
                modifier = Modifier.size(15.dp),
                imageVector = EvaIcons.lucide(icon),
                contentDescription = null,
                tint = Color.White,
            )
        } else {
            SnyggIcon(modifier = Modifier.size(15.dp), imageVector = EvaIcons.lucide(icon))
        }
    }
}
