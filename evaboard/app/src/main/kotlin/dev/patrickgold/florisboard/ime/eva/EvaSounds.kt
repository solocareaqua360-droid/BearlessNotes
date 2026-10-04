/*
 * evaBoard: the voice input's own sounds - soft and short, in place of the recognizer's system
 * tones (which are silenced while dictating, see EvaVoice). Two notes rising when listening starts,
 * two falling when it stops; synthesised here, a sine with a touch of its octave under a smooth
 * swell, so there is no sound file and nothing harsh at the edges.
 */

package dev.patrickgold.florisboard.ime.eva

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import kotlin.math.PI
import kotlin.math.sin

object EvaSounds {
    private const val RATE = 44_100
    private const val NOTE_MS = 85
    /** How long the start sound takes - listening begins after it, so it is not heard by the microphone. */
    const val START_MS = NOTE_MS * 2 + 20

    private val main = Handler(Looper.getMainLooper())
    private val rising by lazy { render(660.0, 880.0) }
    private val falling by lazy { render(880.0, 660.0) }

    fun listening() = play(rising)
    fun stopped() = play(falling)

    private fun render(first: Double, second: Double): ShortArray {
        val n = RATE * NOTE_MS / 1000
        val pcm = ShortArray(n * 2)
        for ((k, f) in listOf(first, second).withIndex()) {
            for (i in 0 until n) {
                val swell = sin(PI * i / n).let { it * it } // raised-cosine in and out
                val tone = sin(2 * PI * f * i / RATE) + 0.18 * sin(4 * PI * f * i / RATE)
                pcm[k * n + i] = (tone * swell * 0.26 * Short.MAX_VALUE).toInt().toShort()
            }
        }
        return pcm
    }

    private fun play(pcm: ShortArray) {
        runCatching {
            val track = AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(RATE)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(pcm.size * 2)
                .setTransferMode(AudioTrack.MODE_STATIC)
                .build()
            track.write(pcm, 0, pcm.size)
            track.play()
            main.postDelayed({ runCatching { track.release() } }, (pcm.size * 1000L / RATE) + 300)
        }
    }
}
