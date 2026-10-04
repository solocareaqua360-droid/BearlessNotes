/*
 * evaBoard: what the row above the keys shows. The up / down button in the bottom strip steps through
 * HIDDEN -> NUMBERS -> EDIT -> HIDDEN; holding it shows TOOLS (the old row of icons) and back.
 */

package dev.patrickgold.florisboard.ime.eva

enum class EvaTopRowState {
    /** Lowered: no row, a keyboard one row shorter. */
    HIDDEN,
    /** Raised with the digits 1-0. */
    NUMBERS,
    /** Raised with undo, redo and the word suggestions in one row. */
    EDIT,
    /** The icon row of earlier versions (settings, emoji, cursor keys...) - reached by holding the button. */
    TOOLS;

    /** The next state a short press of the strip button goes to. */
    fun next() = when (this) {
        HIDDEN -> NUMBERS
        NUMBERS -> EDIT
        EDIT -> HIDDEN
        TOOLS -> HIDDEN
    }
}
