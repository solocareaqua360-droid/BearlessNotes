/*
 * evaBoard: the held-space cursor touchpad. While the finger steers the caret, the keys give way to a
 * plain surface (just the ground, no letters) - like the iPhone - so the keyboard reads as a trackpad.
 * The gesture itself is handled in TextKeyboardLayout; this only carries the "is dragging" flag to the UI.
 */

package dev.patrickgold.florisboard.ime.eva

import kotlinx.coroutines.flow.MutableStateFlow

object EvaSpaceCursor {
    /** True while the held space bar is moving the caret. The text layout then shows a blank touchpad. */
    val dragging = MutableStateFlow(false)
}
