/*
 * evaBoard: the row above the keys.
 *
 * It replaces FlorisBoard's Smartbar row and shows one of two things in the
 * same place, so the keyboard never grows: digits 1-0 as ordinary keys, or
 * the toolbar icons, each on a key of its own. The key in the first slot
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
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
import dev.patrickgold.florisboard.ime.keyboard.ComputingEvaluator
import dev.patrickgold.florisboard.ime.keyboard.KeyData
import dev.patrickgold.florisboard.ime.keyboard.computeImageVector
import dev.patrickgold.florisboard.ime.keyboard.computeLabel
import dev.patrickgold.florisboard.ime.keyboard.KeyboardMode
import dev.patrickgold.florisboard.ime.smartbar.quickaction.QuickAction
import dev.patrickgold.florisboard.ime.smartbar.quickaction.ToggleOverflowPanelAction
import dev.patrickgold.florisboard.ime.smartbar.quickaction.keyData
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

    val visible by prefs.keyboard.evaTopRowVisible.observeAsState()
    if (!visible) return
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
                SwitchKey(showIcons) {
                    if (showIcons) keyboardManager.activeState.isActionsOverflowVisible = false
                    EvaTopRow.showIcons.value = !showIcons
                }
            }
            if (showIcons) {
                IconKeys()
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

/** The switch, a key like the others: "123" while the icons show, a grid while the digits show. */
@Composable
private fun SwitchKey(showIcons: Boolean, onClick: () -> Unit) {
    EvaKey(code = KeyCode.UNSPECIFIED, onRelease = onClick) {
        if (showIcons) {
            SnyggText(text = "123")
        } else {
            SnyggIcon(modifier = Modifier.size(ActionIconSize), imageVector = EvaIcons.lucide("layout-grid"))
        }
    }
}

/** A digit drawn and pressed exactly like a letter key. */
@Composable
private fun DigitKey(digit: Char) {
    val context = LocalContext.current
    val keyboardManager by context.keyboardManager()
    val data = remember(digit) { TextKeyData(code = digit.code, label = digit.toString()) }
    EvaKey(
        code = digit.code,
        feedback = data,
        onRelease = { keyboardManager.inputEventDispatcher.sendDownUp(data) },
    ) {
        SnyggText(text = digit.toString())
    }
}

/** Toolbar icons in the top row: drawn larger than in FlorisBoard's toolbar, one per key. */
private val ActionIconSize = 26.dp

/**
 * The toolbar icons, each on a key of its own above its own letter column. There is one icon
 * fewer than places, so the last key stays empty.
 */
@Composable
private fun RowScope.IconKeys() {
    val context = LocalContext.current
    val keyboardManager by context.keyboardManager()
    val prefs by FlorisPreferenceStore
    val actionArrangement by prefs.smartbar.actionArrangement.observeAsState()
    val evaluator by keyboardManager.activeSmartbarEvaluator.collectAsState()

    val places = EvaTopRow.SLOTS - 1
    // The microphone lives in the bottom strip; the overflow button always takes the last icon place.
    val actions = remember(actionArrangement) {
        actionArrangement.dynamicActions
            .filter { (it as? QuickAction.InsertKey)?.data?.code != KeyCode.VOICE_INPUT }
            .take(places - 2) + ToggleOverflowPanelAction
    }
    for (index in 0 until places) {
        Slot {
            val action = actions.getOrNull(index)
            if (action == null) {
                EvaKey(code = KeyCode.UNSPECIFIED) {}
            } else {
                ActionKey(action, evaluator)
            }
        }
    }
}

@Composable
private fun ActionKey(action: QuickAction, evaluator: ComputingEvaluator) {
    val context = LocalContext.current
    val data = action.keyData()
    val enabled = evaluator.evaluateEnabled(data)
    // Leaving the composition mid-press must not leave the action stuck down (as QuickActionButton does).
    DisposableEffect(action, enabled) {
        onDispose { action.onPointerCancel(context) }
    }
    EvaKey(
        code = data.code,
        enabled = enabled,
        onPress = { action.onPointerDown(context) },
        onRelease = { action.onPointerUp(context) },
        onCancel = { action.onPointerCancel(context) },
    ) {
        val imageVector = remember(action, evaluator) { evaluator.computeImageVector(data) }
        if (imageVector != null) {
            SnyggIcon(modifier = Modifier.size(ActionIconSize), imageVector = imageVector)
        } else {
            val label = remember(action, evaluator) { evaluator.computeLabel(data) }
            SnyggText(text = label ?: "")
        }
    }
}

/** One key of the top row, styled and spaced like the letter keys below it. */
@Composable
private fun EvaKey(
    code: Int,
    enabled: Boolean = true,
    feedback: KeyData = TextKeyData.UNSPECIFIED,
    onPress: () -> Unit = {},
    onRelease: () -> Unit = {},
    onCancel: () -> Unit = {},
    content: @Composable () -> Unit,
) {
    val prefs by FlorisPreferenceStore
    val keyMarginH by prefs.keyboard.keySpacingHorizontal.observeAsState()
    val keyMarginV by prefs.keyboard.keySpacingVertical.observeAsState()
    val inputFeedbackController = FlorisImeService.inputFeedbackController()
    var pressed by remember { mutableStateOf(false) }

    SnyggBox(
        elementName = FlorisImeUi.Key.elementName,
        attributes = mapOf(FlorisImeUi.Attr.Code to code),
        selector = when {
            !enabled -> SnyggSelector.DISABLED
            pressed -> SnyggSelector.PRESSED
            else -> SnyggSelector.NONE
        },
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = keyMarginH.dp, vertical = keyMarginV.dp)
            .pointerInput(code, enabled) {
                awaitEachGesture {
                    awaitFirstDown().consume()
                    if (!enabled) return@awaitEachGesture
                    pressed = true
                    inputFeedbackController?.keyPress(feedback)
                    onPress()
                    val up = waitForUpOrCancellation()
                    pressed = false
                    if (up != null) {
                        up.consume()
                        onRelease()
                    } else {
                        onCancel()
                    }
                }
            },
        contentAlignment = Alignment.Center,
    ) {
        content()
    }
}
