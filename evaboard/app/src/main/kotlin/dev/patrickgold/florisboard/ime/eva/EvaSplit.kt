/*
 * evaBoard: the split keyboard for the Fold's big inner screen.
 *
 * On a wide screen every row is laid out for the width minus a central gap and then the keys
 * of the right half are moved across the gap, so the two halves sit under the thumbs. A key
 * that straddles the middle (the space bar) is stretched across the gap instead. The top row
 * splits at the same column, so digits stay above their letters. The cover screen keeps the
 * whole keyboard.
 */

package dev.patrickgold.florisboard.ime.eva

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.platform.LocalConfiguration
import dev.patrickgold.florisboard.app.FlorisPreferenceStore
import dev.patrickgold.florisboard.ime.text.keyboard.TextKeyboard
import dev.patrickgold.jetpref.datastore.model.observeAsState

object EvaSplit {
    /** Screens at least this wide (dp) get the split keyboard: the Fold's inner screen, not its cover. */
    const val MIN_WIDTH_DP = 600

    /** The central gap as a share of the keyboard's width. */
    const val GAP_FRACTION = 0.26f

    /**
     * Moves the right half of every row across a gap of [gap] px, for a keyboard laid out over
     * [layoutWidth] (the full width minus the gap).
     */
    fun apply(keyboard: TextKeyboard, layoutWidth: Float, gap: Float) {
        val middle = layoutWidth / 2f
        for (key in keyboard.keys()) {
            val visible = key.visibleBounds
            val touch = key.touchBounds
            when {
                visible.left < middle && visible.right > middle -> {
                    visible.right += gap
                    touch.right += gap
                }
                (visible.left + visible.right) / 2f >= middle -> {
                    visible.left += gap
                    visible.right += gap
                    touch.left += gap
                    touch.right += gap
                }
            }
        }
    }
}

/** The gap fraction for the current screen: [EvaSplit.GAP_FRACTION] on a wide screen if enabled, else 0. */
@Composable
fun evaSplitGapFraction(): Float {
    val prefs by FlorisPreferenceStore
    val enabled by prefs.keyboard.evaSplit.observeAsState()
    val wide = LocalConfiguration.current.screenWidthDp >= EvaSplit.MIN_WIDTH_DP
    return if (enabled && wide) EvaSplit.GAP_FRACTION else 0f
}
