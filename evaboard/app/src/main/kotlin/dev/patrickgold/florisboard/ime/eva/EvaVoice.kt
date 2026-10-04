/*
 * evaBoard: voice input inside the keyboard itself.
 *
 * FlorisBoard's voice key handed the text field over to another, voice-only
 * keyboard; on the user's phone that keyboard started and stopped again 4-5
 * times before it stayed. Here evaBoard listens itself through Android's own
 * speech recognizer (SpeechRecognizer), in the language of the active
 * layout, and types each phrase into the field. Like the iPhone it keeps
 * listening through pauses until the microphone is pressed again.
 */

package dev.patrickgold.florisboard.ime.eva

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import dev.patrickgold.florisboard.FlorisImeService
import dev.patrickgold.florisboard.subtypeManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

object EvaVoice {
    sealed interface State {
        data object Idle : State
        /** Listening; the words heard so far are typed into the field as they come. */
        data class Listening(val partial: String) : State
        /** A short note shown in the strip for a moment (no permission, no network, ...). */
        data class Note(val text: String) : State
    }

    /**
     * Listening stops on its own after this long without speech. Short, because the recognizer
     * restarts after every phrase and every silence, and each restart plays its start tone.
     */
    private const val SILENCE_LIMIT_MS = 10_000L
    /** One typed letter per tick: ~35 letters a second, a visible typewriter beat. */
    private const val TYPE_TICK_MS = 28L
    /** Restarts that fail in a row before giving up, so a broken recognizer cannot loop. */
    private const val MAX_FAILED_RESTARTS = 3

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private val clearNote = Runnable { if (_state.value is State.Note) _state.value = State.Idle }

    /** One press of the microphone: lasts until the second press, the silence limit, or the keyboard hiding. */
    private class Session(val context: Context, val language: String) {
        /** Phrases waiting to be typed, oldest first; the typing ticker works on the first. */
        val phrases = ArrayDeque<Phrase>()
        var lastHeardAt = SystemClock.elapsedRealtime()
        var stopping = false
        var failedRestarts = 0
    }
    private var session: Session? = null

    /**
     * One recognised phrase. [target] is the best text so far (it changes as the recognizer refines
     * it), [typed] is what is in the field (including [prefix]); the ticker moves [typed] to
     * prefix + [target] a letter at a time. [closed]: the recognizer finished this phrase.
     */
    private class Phrase {
        var target = ""
        var typed = ""
        var prefix: String? = null
        var closed = false
    }

    private val typingTick = object : Runnable {
        override fun run() {
            val s = session ?: return
            if (typeStep(s)) main.postDelayed(this, TYPE_TICK_MS)
        }
    }

    /** The microphone button: starts listening, or stops if already listening (the phrase being said still lands). */
    fun toggle(context: Context) {
        session?.let {
            it.stopping = true
            recognizer?.stopListening()
            return
        }
        if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            note("Дозвольте мікрофон і натисніть ще раз")
            context.startActivity(
                Intent(context, EvaMicPermissionActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            note("На телефоні немає служби розпізнавання мови")
            return
        }
        val language = context.subtypeManager().value.activeSubtype.primaryLocale.languageTag()
        session = Session(context, language)
        _state.value = State.Listening("")
        listen()
    }

    /** Drops whatever is being listened to - the keyboard went away. */
    fun cancel() {
        session?.let { s ->
            // type out whatever is still queued, at once - it was heard
            main.removeCallbacks(typingTick)
            while (typeStep(s)) Unit
        }
        session = null
        recognizer?.let {
            it.cancel()
            it.destroy()
        }
        recognizer = null
        if (_state.value is State.Listening) _state.value = State.Idle
    }

    private fun listen() {
        val s = session ?: return
        // Pressed again between two phrases: nothing is being said, just stop.
        if (s.stopping) {
            end()
            return
        }
        val sr = recognizer ?: SpeechRecognizer.createSpeechRecognizer(s.context).also {
            it.setRecognitionListener(Listener)
            recognizer = it
        }
        sr.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, s.language)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, s.context.packageName)
        )
    }

    /** Android ends recognition after every phrase; while the session lasts, quietly start the next one. */
    private fun next() {
        val s = session ?: return
        s.phrases.lastOrNull()?.closed = true // the recognizer is done with this phrase
        if (s.stopping) {
            end()
            return
        }
        if (SystemClock.elapsedRealtime() - s.lastHeardAt > SILENCE_LIMIT_MS) {
            end("Мікрофон вимкнено після тиші")
            return
        }
        _state.value = State.Listening("")
        main.postDelayed({ if (session === s) listen() }, 100)
    }

    private fun end(noteText: String? = null) {
        session?.let { s ->
            main.removeCallbacks(typingTick)
            while (typeStep(s)) Unit
        }
        session = null
        recognizer?.destroy()
        recognizer = null
        if (noteText != null) note(noteText) else _state.value = State.Idle
    }

    private fun note(text: String) {
        _state.value = State.Note(text)
        main.removeCallbacks(clearNote)
        main.postDelayed(clearNote, 2500)
    }

    /** The recognizer's latest text for the phrase being said; typed out by the ticker. */
    private fun hear(s: Session, text: String, final: Boolean) {
        var phrase = s.phrases.lastOrNull()
        if (phrase == null || phrase.closed) {
            phrase = Phrase()
            s.phrases.addLast(phrase)
        }
        phrase.target = text
        if (final) phrase.closed = true
        main.removeCallbacks(typingTick)
        main.post(typingTick)
    }

    /**
     * One beat of the typewriter: moves the field one step towards the first phrase's text. Adds the
     * next letter(s), or - when the recognizer revised words already typed - first backs up over the
     * part that changed (only that tail, so the rest does not flicker). Returns whether more is to do.
     * Nothing of the user's own is ever deleted: before backing up, the text before the cursor must
     * still be what was typed, else the phrase starts afresh at the cursor.
     */
    private fun typeStep(s: Session): Boolean {
        val phrase = s.phrases.firstOrNull() ?: return false
        val ic = FlorisImeService.currentInputConnection() ?: return false
        ic.beginBatchEdit()
        try {
            // FlorisBoard keeps the last word of the field "composing"; finish that first, as its own typing does
            ic.finishComposingText()
            if (phrase.typed.isEmpty() && phrase.prefix == null) {
                val prev = ic.getTextBeforeCursor(1, 0)
                phrase.prefix = if (!prev.isNullOrEmpty() && !prev.last().isWhitespace()) " " else ""
            }
            val goal = (phrase.prefix ?: "") + phrase.target
            if (!goal.startsWith(phrase.typed)) {
                var common = 0
                while (common < phrase.typed.length && common < goal.length && phrase.typed[common] == goal[common]) common++
                val back = phrase.typed.length - common
                val before = ic.getTextBeforeCursor(phrase.typed.length, 0)?.toString()
                if (before == phrase.typed) {
                    ic.deleteSurroundingText(back, 0)
                    phrase.typed = phrase.typed.substring(0, common)
                } else {
                    // the field is no longer as typed: leave it alone, start this phrase afresh here
                    phrase.typed = ""
                    phrase.prefix = null
                }
                return true
            }
            if (phrase.typed.length < goal.length) {
                val backlog = goal.length - phrase.typed.length
                val n = (backlog / 8).coerceAtLeast(1) // lagging behind: take bigger steps
                val chunk = goal.substring(phrase.typed.length, phrase.typed.length + n)
                ic.commitText(chunk, 1)
                phrase.typed += chunk
                return true
            }
            // fully typed: a finished phrase leaves the queue, an open one waits for the recognizer
            if (phrase.closed) {
                s.phrases.removeFirst()
                return s.phrases.isNotEmpty()
            }
            return false
        } finally {
            ic.endBatchEdit()
        }
    }

    private object Listener : RecognitionListener {
        private fun heard() {
            session?.let {
                it.lastHeardAt = SystemClock.elapsedRealtime()
                it.failedRestarts = 0
            }
        }

        override fun onBeginningOfSpeech() = heard()

        override fun onPartialResults(partialResults: Bundle?) {
            val text = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            val s = session
            if (!text.isNullOrBlank() && s != null) {
                heard()
                hear(s, text, final = false)
            }
        }

        override fun onResults(results: Bundle?) {
            val s = session ?: return
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            if (!text.isNullOrBlank()) {
                heard()
                hear(s, text, final = true)
            }
            next()
        }

        override fun onError(error: Int) {
            val s = session ?: return
            when (error) {
                // Silence: keep listening until the silence limit.
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> next()
                // The recognizer tripped over its own restart: start over with a fresh one.
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY, SpeechRecognizer.ERROR_CLIENT -> {
                    recognizer?.destroy()
                    recognizer = null
                    if (++s.failedRestarts > MAX_FAILED_RESTARTS) end("Не вдалося розпізнати") else next()
                }
                SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
                    end("Немає інтернету для розпізнавання")
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> end("Немає дозволу на мікрофон")
                SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
                    end("Ця мова не розпізнається")
                else -> end("Не вдалося розпізнати (код $error)")
            }
        }

        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onRmsChanged(rmsdB: Float) = Unit
        override fun onBufferReceived(buffer: ByteArray?) = Unit
        override fun onEndOfSpeech() = Unit
        override fun onEvent(eventType: Int, params: Bundle?) = Unit
    }
}

/**
 * A keyboard cannot ask for a permission itself, so this invisible screen asks for the
 * microphone once and closes.
 */
class EvaMicPermissionActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        finish()
    }
}
