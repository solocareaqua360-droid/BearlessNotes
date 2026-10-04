/*
 * evaBoard: the menu under a long press of the globe key - the languages set up in evaBoard, then
 * the emoji panel. A short press of the globe only cycles the languages; emoji are reached from this
 * menu alone. The language the keyboard is in now sits under the finger, so letting go at once changes nothing.
 */

package dev.patrickgold.florisboard.ime.eva

import dev.patrickgold.florisboard.ime.keyboard.AbstractKeyData
import dev.patrickgold.florisboard.ime.keyboard.ComputingEvaluator
import dev.patrickgold.florisboard.ime.popup.PopupSet
import dev.patrickgold.florisboard.ime.text.keyboard.TextKeyData
import dev.patrickgold.florisboard.subtypeManager

object EvaLanguageMenu {
    /** Key codes of the language items: BASE - the subtype's place in the list. */
    private const val BASE = -1100
    val CODES = (BASE - 99)..BASE

    fun indexOf(code: Int) = BASE - code

    fun popups(evaluator: ComputingEvaluator): PopupSet<AbstractKeyData>? {
        val manager = evaluator.context()?.subtypeManager()?.value ?: return null
        val subtypes = manager.subtypes.take(CODES.last - CODES.first + 1)
        if (subtypes.isEmpty()) return null
        val activeId = manager.activeSubtype.id
        val items = subtypes.mapIndexed { i, subtype ->
            subtype.id to TextKeyData(code = BASE - i, label = evaShortLanguage(subtype.primaryLocale).uppercase())
        }
        val current = items.firstOrNull { it.first == activeId } ?: items.first()
        val others = items.filter { it !== current }.map { it.second }
        return PopupSet(main = current.second, relevant = others + TextKeyData.IME_UI_MODE_MEDIA)
    }
}
