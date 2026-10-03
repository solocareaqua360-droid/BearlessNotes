/*
 * evaBoard: short labels.
 */

package dev.patrickgold.florisboard.ime.eva

import dev.patrickgold.florisboard.lib.FlorisLocale

/** The two-letter language mark in the space bar's corner: in the language's own script where it is Cyrillic. */
fun evaShortLanguage(locale: FlorisLocale): String = when (locale.language) {
    "uk" -> "ук"
    "ru" -> "ру"
    "be" -> "бе"
    "bg" -> "бг"
    "sr" -> "ср"
    "mk" -> "мк"
    "kk" -> "кк"
    else -> locale.language.lowercase()
}
