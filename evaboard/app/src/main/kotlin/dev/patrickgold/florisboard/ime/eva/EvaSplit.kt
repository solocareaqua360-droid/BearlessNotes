/*
 * evaBoard: the split keyboard for the Fold's big inner screen, measured on Samsung's own split
 * keyboard (the user's reference): a margin of about 5% of the width at each side, a gap of about
 * 18% in the middle, keys at their normal size - nothing is stretched.
 *
 * Every row is laid out for the width minus the margins and the gap; then all keys move right by
 * one margin and the keys whose centre lies right of the middle also move across the gap. Rows of
 * 11 split 5 | 6 (й…е | н…х), the same column the top row splits at. The space bar, which spans
 * the middle, becomes two space bars, one in each half, like Samsung's. The cover screen keeps
 * the whole keyboard.
 */

package dev.patrickgold.florisboard.ime.eva

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalConfiguration
import dev.patrickgold.florisboard.app.FlorisPreferenceStore
import dev.patrickgold.florisboard.ime.keyboard.ComputingEvaluator
import dev.patrickgold.florisboard.ime.text.key.KeyCode
import dev.patrickgold.florisboard.ime.text.keyboard.TextKey
import dev.patrickgold.florisboard.ime.text.keyboard.TextKeyboard
import dev.patrickgold.jetpref.datastore.model.observeAsState
import java.util.Collections
import java.util.IdentityHashMap

object EvaSplit {
    /** Screens at least this wide (dp) get the split keyboard: the Fold's inner screen, not its cover. */
    const val MIN_WIDTH_DP = 600

    /** Measured on Samsung's split keyboard: the side margins and the central gap, as shares of the width. */
    const val MARGIN_FRACTION = 0.052f
    const val GAP_FRACTION = 0.18f

    /** The second space bars added for the right half, so they can be taken out again. */
    private val addedSpaces: MutableSet<TextKey> = Collections.newSetFromMap(IdentityHashMap())

    /** Takes out the right-half space bars added earlier; call before laying the keyboard out again. */
    fun removeAddedKeys(keyboard: TextKeyboard) {
        for (r in keyboard.arrangement.indices) {
            val row = keyboard.arrangement[r]
            if (row.any { it in addedSpaces }) {
                keyboard.arrangement[r] = row.filterNot { it in addedSpaces }.toTypedArray()
            }
        }
    }

    /**
     * Splits a keyboard laid out over [layoutWidth] (the full width minus both margins and the gap):
     * every key moves right by [margin], the right half also by [gap], and the space bar is cut at
     * the middle into two.
     */
    fun apply(keyboard: TextKeyboard, layoutWidth: Float, margin: Float, gap: Float, evaluator: ComputingEvaluator) {
        val middle = layoutWidth / 2f
        for (r in keyboard.arrangement.indices) {
            val row = keyboard.arrangement[r]
            val newRow = ArrayList<TextKey>(row.size + 1)
            for (key in row) {
                val visible = key.visibleBounds
                val touch = key.touchBounds
                val isSpace = key.computedData.code == KeyCode.SPACE || key.computedData.code == KeyCode.CJK_SPACE
                if (isSpace && visible.left < middle && visible.right > middle) {
                    // one space bar each side of the gap
                    val insetLeft = visible.left - touch.left
                    val insetRight = touch.right - visible.right
                    val right = TextKey(key.data).also {
                        it.compute(evaluator)
                        it.computeLabelsAndDrawables(evaluator)
                        it.touchBounds.applyFrom(touch)
                        it.visibleBounds.applyFrom(visible)
                        it.touchBounds.left = middle + margin + gap
                        it.touchBounds.right = touch.right + margin + gap
                        it.visibleBounds.left = it.touchBounds.left + insetLeft
                        it.visibleBounds.right = visible.right + margin + gap
                    }
                    touch.left += margin
                    touch.right = middle + margin
                    visible.left += margin
                    visible.right = touch.right - insetRight
                    newRow.add(key)
                    newRow.add(right)
                    addedSpaces.add(right)
                    continue
                }
                val shift = if ((visible.left + visible.right) / 2f >= middle - 0.5f) margin + gap else margin
                visible.left += shift
                visible.right += shift
                touch.left += shift
                touch.right += shift
                newRow.add(key)
            }
            keyboard.arrangement[r] = newRow.toTypedArray()
        }
    }
}

/** Whether the keyboard is split on the current screen: a wide screen, with the split switched on. */
@Composable
fun evaIsSplit(): Boolean {
    val prefs by FlorisPreferenceStore
    val enabled by prefs.keyboard.evaSplit.observeAsState()
    return enabled && LocalConfiguration.current.screenWidthDp >= EvaSplit.MIN_WIDTH_DP
}
