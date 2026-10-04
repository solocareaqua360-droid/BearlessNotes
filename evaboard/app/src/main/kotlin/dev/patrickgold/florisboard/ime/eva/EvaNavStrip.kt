/*
 * evaBoard: the bottom strip under the keys, drawn by the keyboard itself.
 *
 * On gesture navigation Android draws its own strip under every keyboard,
 * with a switch-keyboard button on the left and a hide button on the right.
 * From Android 16 a keyboard may hide that strip and draw its own instead
 * (FlorisImeService requests it). This is that strip: the left button is
 * either the keyboard switcher or a microphone, chosen by holding it; the
 * right button hides the keyboard.
 */

package dev.patrickgold.florisboard.ime.eva

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.patrickgold.florisboard.FlorisImeService
import dev.patrickgold.florisboard.R
import dev.patrickgold.florisboard.app.FlorisPreferenceStore
import dev.patrickgold.florisboard.ime.text.keyboard.TextKeyData
import dev.patrickgold.florisboard.ime.theme.FlorisImeUi
import dev.patrickgold.jetpref.datastore.model.observeAsState
import org.florisboard.lib.android.systemServiceOrNull
import org.florisboard.lib.compose.rippleClickable
import org.florisboard.lib.compose.stringRes
import org.florisboard.lib.snygg.ui.SnyggBox
import org.florisboard.lib.snygg.ui.SnyggColumn
import org.florisboard.lib.snygg.ui.SnyggIcon
import org.florisboard.lib.snygg.ui.SnyggRow
import org.florisboard.lib.snygg.SnyggSelector
import org.florisboard.lib.snygg.ui.SnyggText
import android.view.inputmethod.InputMethodManager
import kotlinx.coroutines.launch

/**
 * Draws the strip at the bottom of the keyboard window, [stripHeight] tall,
 * plus the hold menu that swaps the left button. Must be called last inside
 * the keyboard's Box so it lies on top of the keys.
 */
@Composable
fun BoxScope.EvaNavStripLayer(stripHeight: Dp) {
    val prefs by FlorisPreferenceStore
    val leftIsMic by prefs.keyboard.evaNavLeftMic.observeAsState()
    var menuOpen by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val voice by EvaVoice.state.collectAsState()

    if (menuOpen) {
        // A tap anywhere outside the menu closes it.
        Box(
            modifier = Modifier
                .matchParentSize()
                .pointerInput(Unit) { detectTapGestures { menuOpen = false } },
        )
        SnyggColumn(
            elementName = FlorisImeUi.ClipboardItemActions.elementName,
            modifier = Modifier
                .align(Alignment.BottomStart)
                .padding(start = 8.dp, bottom = stripHeight + 4.dp)
                .widthIn(max = 320.dp),
        ) {
            val (icon, text) = if (leftIsMic) {
                EvaIcons.lucide("keyboard") to R.string.eva__nav_left_use_switcher
            } else {
                EvaIcons.lucide("mic") to R.string.eva__nav_left_use_mic
            }
            SnyggRow(
                elementName = FlorisImeUi.ClipboardItemAction.elementName,
                modifier = Modifier.rippleClickable {
                    scope.launch { prefs.keyboard.evaNavLeftMic.set(!leftIsMic) }
                    menuOpen = false
                },
                verticalAlignment = Alignment.CenterVertically,
            ) {
                SnyggIcon(FlorisImeUi.ClipboardItemActionIcon.elementName, imageVector = icon)
                SnyggText(FlorisImeUi.ClipboardItemActionText.elementName, text = stringRes(text))
            }
        }
    }

    Box(
        modifier = Modifier
            .align(Alignment.BottomCenter)
            .fillMaxWidth()
            .height(stripHeight),
    ) {
        StripButton(
            modifier = Modifier.align(Alignment.CenterStart).padding(start = 12.dp),
            icon = EvaIcons.lucide(if (leftIsMic) "mic" else "keyboard"),
            iconSize = StripIconDefault,
            active = leftIsMic && voice is EvaVoice.State.Listening,
            onTap = {
                if (leftIsMic) {
                    EvaVoice.toggle(context)
                } else {
                    context.systemServiceOrNull(InputMethodManager::class)?.showInputMethodPicker()
                }
            },
            onHold = { menuOpen = true },
        )
        // Shows / hides the top row of digits, right beside the left button.
        val topRowVisible by prefs.keyboard.evaTopRowVisible.observeAsState()
        StripButton(
            modifier = Modifier.align(Alignment.CenterStart).padding(start = 12.dp + 44.dp + 8.dp),
            icon = EvaIcons.lucide(if (topRowVisible) "panel-top-close" else "panel-top-open"),
            iconSize = StripIconDefault,
            onTap = { scope.launch { prefs.keyboard.evaTopRowVisible.set(!topRowVisible) } },
            onHold = null,
        )
        StripButton(
            modifier = Modifier.align(Alignment.CenterEnd).padding(end = 12.dp),
            icon = EvaIcons.lucide("chevron-down"),
            iconSize = StripIconLarge,
            onTap = { FlorisImeService.hideUi() },
            onHold = null,
        )
        // What the voice input is doing, between the two buttons.
        val voiceText = when (val v = voice) {
            is EvaVoice.State.Listening -> v.partial.ifEmpty { "Слухаю…" }
            is EvaVoice.State.Note -> v.text
            EvaVoice.State.Idle -> null
        }
        if (voiceText != null) {
            SnyggText(
                elementName = FlorisImeUi.ClipboardItemActionText.elementName,
                modifier = Modifier.align(Alignment.Center).padding(horizontal = 116.dp),
                // SnyggText has no line limit; keep the tail so it fits on one line.
                text = if (voiceText.length > 40) "…" + voiceText.takeLast(40) else voiceText,
            )
        }
    }
}

/** The height of evaBoard's bottom strip while it is up (0 otherwise); the clipboard lets its cards run under it. */
object EvaStrip {
    val height = kotlinx.coroutines.flow.MutableStateFlow(0.dp)
}

/** Keyboard switcher and microphone: the toolbar's icon size (30dp was too big for the mic). */
private val StripIconDefault = 24.dp
/** Hide: its chevron glyph is small, so it is drawn larger to match the toolbar icons. */
private val StripIconLarge = 30.dp

@Composable
private fun StripButton(
    modifier: Modifier,
    icon: ImageVector,
    iconSize: Dp,
    active: Boolean = false,
    onTap: () -> Unit,
    onHold: (() -> Unit)?,
) {
    val haptic = LocalHapticFeedback.current
    val inputFeedbackController = FlorisImeService.inputFeedbackController()
    SnyggBox(
        elementName = "${FlorisImeUi.SmartbarActionKey.elementName}-icon",
        selector = if (active) SnyggSelector.PRESSED else null,
        modifier = modifier
            .size(44.dp)
            .pointerInput(onHold) {
                detectTapGestures(
                    onTap = {
                        inputFeedbackController?.keyPress(TextKeyData.UNSPECIFIED)
                        onTap()
                    },
                    onLongPress = if (onHold != null) {
                        {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            onHold()
                        }
                    } else {
                        null
                    },
                )
            },
        contentAlignment = Alignment.Center,
    ) {
        SnyggIcon(
            modifier = Modifier.size(iconSize),
            imageVector = icon,
            selector = if (active) SnyggSelector.PRESSED else null,
        )
    }
}
