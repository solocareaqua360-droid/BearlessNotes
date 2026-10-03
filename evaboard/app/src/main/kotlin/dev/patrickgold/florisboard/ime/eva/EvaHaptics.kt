/*
 * evaBoard: the iPhone keyboard's feel - one short, crisp, light tick per key rather than a buzz.
 */

package dev.patrickgold.florisboard.ime.eva

import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import org.florisboard.lib.android.vibrate

object EvaHaptics {
    /**
     * Plays the tick at [strength] (1..100, the "vibration strength" setting) times [factor].
     * Uses the vibrator's own click primitive where the phone has one (Android 11+) - the tick
     * primitive was barely felt on the user's Samsung - else Android's predefined click, else a
     * short pulse.
     */
    fun tick(vibrator: Vibrator, strength: Int, factor: Double = 1.0) {
        val scale = ((0.45 + 0.55 * strength / 100.0) * factor).toFloat().coerceIn(0.05f, 1f)
        val primitive = VibrationEffect.Composition.PRIMITIVE_CLICK
        when {
            Build.VERSION.SDK_INT >= 30 && vibrator.areAllPrimitivesSupported(primitive) ->
                vibrator.vibrate(VibrationEffect.startComposition().addPrimitive(primitive, scale).compose())
            Build.VERSION.SDK_INT >= 29 ->
                vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK))
            else -> vibrator.vibrate(duration = 12, strength = (scale * 100).toInt(), factor = 1.0)
        }
    }
}
