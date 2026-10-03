/*
 * evaBoard: whether Android is blurring what lies behind the keyboard (Android 12+, and only
 * when the phone has cross-window blur switched on). While it is, the keyboard's ground is
 * translucent; when it is not, the ground is painted solid so the app does not show through.
 */

package dev.patrickgold.florisboard.ime.eva

import kotlinx.coroutines.flow.MutableStateFlow

object EvaBlur {
    val enabled = MutableStateFlow(false)
}
