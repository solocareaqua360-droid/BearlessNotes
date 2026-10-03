/*
 * evaBoard: the keyboard's icons, drawn from Lucide - the same icon set mindEva uses - instead of
 * Material. The shapes live in LucideData.kt (generated); this builds them into ImageVectors and
 * says which icon belongs to which key.
 */

package dev.patrickgold.florisboard.ime.eva

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.unit.dp
import dev.patrickgold.florisboard.ime.input.InputShiftState
import dev.patrickgold.florisboard.ime.text.key.KeyCode

object EvaIcons {
    private val cache = HashMap<String, ImageVector>()

    /**
     * Lucide fills its 24x24 frame almost edge to edge, where Material (what the sizes in this
     * keyboard were chosen against) keeps about 2 units of empty margin around the glyph. Drawn
     * at the same size, Lucide looks about a tenth to a seventh bigger, so every icon is shrunk
     * inside its frame by this factor: "26dp" then looks the way 26dp looked before Lucide.
     */
    private const val FRAME_FILL = 0.76f

    /** The Lucide icon [name] as a 24x24 outline ImageVector (tinted by whoever draws it). */
    fun lucide(name: String): ImageVector = cache.getOrPut(name) {
        val builder = ImageVector.Builder(
            name = name,
            defaultWidth = 24.dp,
            defaultHeight = 24.dp,
            viewportWidth = 24f,
            viewportHeight = 24f,
        )
        builder.addGroup(pivotX = 12f, pivotY = 12f, scaleX = FRAME_FILL, scaleY = FRAME_FILL)
        for (d in LUCIDE_PATHS.getValue(name)) {
            builder.addPath(
                pathData = PathParser().parsePathString(d).toNodes(),
                stroke = SolidColor(Color.Black),
                strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round,
                strokeLineJoin = StrokeJoin.Round,
            )
        }
        builder.build()
    }

    /** The icon for a key code, or null to leave the key to the stock icon. */
    fun forKey(code: Int, shift: InputShiftState, incognito: Boolean): ImageVector? {
        val name = when (code) {
            KeyCode.ARROW_LEFT -> "arrow-left"
            KeyCode.ARROW_RIGHT -> "arrow-right"
            KeyCode.ARROW_UP -> "arrow-up"
            KeyCode.ARROW_DOWN -> "arrow-down"
            KeyCode.CLIPBOARD_COPY -> "copy"
            KeyCode.CLIPBOARD_CUT -> "scissors"
            KeyCode.CLIPBOARD_PASTE -> "clipboard-paste"
            KeyCode.CLIPBOARD_SELECT_ALL -> "lasso-select"
            KeyCode.CLIPBOARD_CLEAR_PRIMARY_CLIP -> "eraser"
            KeyCode.COMPACT_LAYOUT_TO_LEFT, KeyCode.COMPACT_LAYOUT_TO_RIGHT, KeyCode.TOGGLE_COMPACT_LAYOUT -> "smartphone"
            KeyCode.VOICE_INPUT -> "mic"
            KeyCode.IME_HIDE_UI -> "chevron-down"
            KeyCode.DELETE -> "delete"
            KeyCode.IME_UI_MODE_MEDIA -> "face-slightly-smiling"
            KeyCode.IME_UI_MODE_CLIPBOARD -> "clipboard"
            KeyCode.LANGUAGE_SWITCH -> "globe"
            KeyCode.SETTINGS -> "settings"
            KeyCode.SHIFT -> if (shift != InputShiftState.UNSHIFTED) "arrow-big-up-dash" else "arrow-big-up"
            KeyCode.UNDO -> "undo-2"
            KeyCode.REDO -> "redo-2"
            KeyCode.TOGGLE_ACTIONS_OVERFLOW -> "ellipsis"
            KeyCode.TOGGLE_INCOGNITO_MODE -> if (incognito) "venetian-mask" else "eye"
            KeyCode.TOGGLE_AUTOCORRECT -> "spell-check"
            else -> return null
        }
        return lucide(name)
    }

    /** The Enter key's icon, by what the field wants Enter to do; null = stock icon. */
    fun forEnter(action: String): ImageVector = lucide(
        when (action) {
            "DONE" -> "check"
            "GO", "NEXT" -> "arrow-right"
            "PREVIOUS" -> "arrow-left"
            "SEARCH" -> "search"
            "SEND" -> "send"
            else -> "corner-down-left"
        }
    )
}
