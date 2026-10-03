/*
 * evaBoard: the row above the keys.
 *
 * It replaces FlorisBoard's Smartbar row and shows one of two things in the
 * same place, so the keyboard never grows: digits 1-0 as ordinary keys, or
 * the toolbar icons on one long plate. The round button in the first slot
 * switches between them; the keyboard always opens on the digits, the
 * symbols bring up the icons (they have digits of their own) and going back
 * to the letters brings the digits back. While the digits show, the letter
 * keys carry no digit hints.
 *
 * The row is cut into 11 equal slots - the Ukrainian top row - so every
 * digit and every icon stands above its own letter column (in English, with
 * 10 letters, they sit slightly off; the user chose one fixed grid over a
 * row that changes with the language).
 */

package dev.patrickgold.florisboard.ime.eva

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.GridView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import dev.patrickgold.florisboard.FlorisImeService
import dev.patrickgold.florisboard.app.FlorisPreferenceStore
import dev.patrickgold.florisboard.ime.keyboard.FlorisImeSizing
import dev.patrickgold.florisboard.ime.keyboard.KeyboardMode
import dev.patrickgold.florisboard.ime.smartbar.quickaction.QuickAction
import dev.patrickgold.florisboard.ime.smartbar.quickaction.QuickActionButton
import dev.patrickgold.florisboard.ime.smartbar.quickaction.ToggleOverflowPanelAction
import dev.patrickgold.florisboard.ime.text.key.KeyCode
import dev.patrickgold.florisboard.ime.text.keyboard.TextKeyData
import dev.patrickgold.florisboard.ime.theme.FlorisImeUi
import dev.patrickgold.florisboard.keyboardManager
import dev.patrickgold.jetpref.datastore.model.observeAsState
import kotlinx.coroutines.flow.MutableStateFlow
import org.florisboard.lib.snygg.SnyggSelector
import org.florisboard.lib.snygg.ui.SnyggBox
import org.florisboard.lib.snygg.ui.SnyggIcon
import org.florisboard.lib.snygg.ui.SnyggText

object EvaTopRow {
    /** Slots in the row: the switch button plus ten digits, as wide as the Ukrainian letter keys. */
    const val SLOTS = 11

    /** false = digits, true = icons. Back to digits every time the keyboard opens. */
    val showIcons = MutableStateFlow(false)

    /**
     * The row's height as last laid out (null before the first layout). Digit keys are square -
     * as tall as a letter key is wide - so the height follows the keyboard width; the clipboard
     * and emoji panels read it through FlorisImeSizing.smartbarUiHeight() to keep the same height.
     */
    val rowHeight = MutableStateFlow<Dp?>(null)

    fun resetToDigits() {
        showIcons.value = false
    }
}

@Composable
fun EvaTopRowUi() {
    val context = LocalContext.current
    val keyboardManager by context.keyboardManager()
    val showIcons by EvaTopRow.showIcons.collectAsState()
    val state by keyboardManager.activeState.collectAsState()
    // Symbols have digits of their own, so they bring the icons up; back on the letters, the digits return.
    LaunchedEffect(state.keyboardMode) {
        when (state.keyboardMode) {
            KeyboardMode.SYMBOLS, KeyboardMode.SYMBOLS2 -> EvaTopRow.showIcons.value = true
            KeyboardMode.CHARACTERS -> EvaTopRow.showIcons.value = false
            else -> Unit
        }
    }
    val prefs by FlorisPreferenceStore
    val keyMarginH by prefs.keyboard.keySpacingHorizontal.observeAsState()
    val keyMarginV by prefs.keyboard.keySpacingVertical.observeAsState()

    BoxWithConstraints(modifier = Modifier.fillMaxWidth()) {
        // A digit key is as tall as a letter key is wide: the slot width minus the side margins,
        // plus the top and bottom margins around it.
        val rowHeight = (maxWidth / EvaTopRow.SLOTS) - (keyMarginH * 2).dp + (keyMarginV * 2).dp
        SideEffect { EvaTopRow.rowHeight.value = rowHeight }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(rowHeight),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Slot {
                SwitchButton(showIcons) {
                    if (showIcons) keyboardManager.activeState.isActionsOverflowVisible = false
                    EvaTopRow.showIcons.value = !showIcons
                }
            }
            if (showIcons) {
                IconsPlate(modifier = Modifier.weight((EvaTopRow.SLOTS - 1).toFloat()))
            } else {
                for (digit in "1234567890") {
                    Slot { DigitKey(digit) }
                }
            }
        }
    }
}

@Composable
private fun RowScope.Slot(content: @Composable () -> Unit) {
    Box(
        modifier = Modifier.weight(1f).fillMaxHeight(),
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}

/** The round button: "123" while the icons show, a grid while the digits show. */
@Composable
private fun SwitchButton(showIcons: Boolean, onClick: () -> Unit) {
    val inputFeedbackController = FlorisImeService.inputFeedbackController()
    SnyggBox(
        elementName = FlorisImeUi.SmartbarSharedActionsToggle.elementName,
        modifier = Modifier
            // Same size as FlorisBoard's own round toggle it replaces
            .sizeIn(maxHeight = FlorisImeSizing.smartbarHeight)
            .aspectRatio(1f)
            .pointerInput(showIcons) {
                awaitEachGesture {
                    awaitFirstDown().consume()
                    inputFeedbackController?.keyPress(TextKeyData.UNSPECIFIED)
                    val up = waitForUpOrCancellation()
                    if (up != null) {
                        up.consume()
                        onClick()
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        if (showIcons) {
            SnyggText(text = "123")
        } else {
            SnyggIcon(imageVector = Icons.Default.GridView)
        }
    }
}

/** A digit drawn and pressed exactly like a letter key. */
@Composable
private fun DigitKey(digit: Char) {
    val context = LocalContext.current
    val keyboardManager by context.keyboardManager()
    val prefs by FlorisPreferenceStore
    val keyMarginH by prefs.keyboard.keySpacingHorizontal.observeAsState()
    val keyMarginV by prefs.keyboard.keySpacingVertical.observeAsState()
    val inputFeedbackController = FlorisImeService.inputFeedbackController()
    var pressed by remember { mutableStateOf(false) }
    val data = remember(digit) { TextKeyData(code = digit.code, label = digit.toString()) }

    SnyggBox(
        elementName = FlorisImeUi.Key.elementName,
        attributes = mapOf(FlorisImeUi.Attr.Code to digit.code),
        selector = if (pressed) SnyggSelector.PRESSED else SnyggSelector.NONE,
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = keyMarginH.dp, vertical = keyMarginV.dp)
            .pointerInput(digit) {
                awaitEachGesture {
                    awaitFirstDown().consume()
                    pressed = true
                    inputFeedbackController?.keyPress(data)
                    val up = waitForUpOrCancellation()
                    pressed = false
                    if (up != null) {
                        up.consume()
                        keyboardManager.inputEventDispatcher.sendDownUp(data)
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        SnyggText(text = digit.toString())
    }
}

/**
 * The toolbar icons on one long key-like plate. Each icon takes one slot, so it stands
 * above its own letter column; slots left over on the right stay empty.
 */
@Composable
private fun IconsPlate(modifier: Modifier) {
    val context = LocalContext.current
    val keyboardManager by context.keyboardManager()
    val prefs by FlorisPreferenceStore
    val keyMarginH by prefs.keyboard.keySpacingHorizontal.observeAsState()
    val keyMarginV by prefs.keyboard.keySpacingVertical.observeAsState()
    val actionArrangement by prefs.smartbar.actionArrangement.observeAsState()
    val evaluator by keyboardManager.activeSmartbarEvaluator.collectAsState()

    val slots = EvaTopRow.SLOTS - 1
    // The microphone lives in the bottom strip; the overflow button always takes the last icon place.
    val actions = remember(actionArrangement) {
        actionArrangement.dynamicActions
            .filter { (it as? QuickAction.InsertKey)?.data?.code != KeyCode.VOICE_INPUT }
            .take(slots - 2) + ToggleOverflowPanelAction
    }

    Box(modifier = modifier.fillMaxHeight()) {
        // The plate is drawn like the space bar; the icons are laid over it without its margins,
        // so each icon slot is exactly as wide as a letter column.
        SnyggBox(
            elementName = FlorisImeUi.Key.elementName,
            attributes = mapOf(FlorisImeUi.Attr.Code to KeyCode.SPACE),
            modifier = Modifier
                .matchParentSize()
                .padding(horizontal = keyMarginH.dp, vertical = keyMarginV.dp),
        ) {}
        Row(
            modifier = Modifier.fillMaxSize(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            for (index in 0 until slots) {
                Box(
                    modifier = Modifier.weight(1f).fillMaxHeight(),
                    contentAlignment = Alignment.Center,
                ) {
                    actions.getOrNull(index)?.let { action ->
                        QuickActionButton(action = action, evaluator = evaluator)
                    }
                }
            }
        }
    }
}
