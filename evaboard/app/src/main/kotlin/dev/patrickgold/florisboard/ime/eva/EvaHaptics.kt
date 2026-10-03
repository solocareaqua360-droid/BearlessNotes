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
     * Uses the vibrator's own tick primitive where the phone has one (Android 11+), else Android's
     * predefined tick, else a very short pulse.
     */
    fun tick(vibrator: Vibrator, strength: Int, factor: Double = 1.0) {
        val scale = ((0.25 + 0.75 * strength / 100.0) * factor).toFloat().coerceIn(0.05f, 1f)
        val primitive = VibrationEffect.Composition.PRIMITIVE_TICK
        when {
            Build.VERSION.SDK_INT >= 30 && vibrator.areAllPrimitivesSupported(primitive) ->
                vibrator.vibrate(VibrationEffect.startComposition().addPrimitive(primitive, scale).compose())
            Build.VERSION.SDK_INT >= 29 ->
                vibrator.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK))
            else -> vibrator.vibrate(duration = 8, strength = (scale * 100).toInt(), factor = 1.0)
        }
    }
}
