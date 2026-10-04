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

    /** Like the iPhone: listening stops on its own only after this long without speech. */
    private const val SILENCE_LIMIT_MS = 30_000L
    /** Restarts that fail in a row before giving up, so a broken recognizer cannot loop. */
    private const val MAX_FAILED_RESTARTS = 3

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private val clearNote = Runnable { if (_state.value is State.Note) _state.value = State.Idle }

    /** One press of the microphone: lasts until the second press, the silence limit, or the keyboard hiding. */
    private class Session(val context: Context, val language: String) {
        /** What the current phrase has put into the field so far (partial results), so the next update can replace it. */
        var typed = ""
        var lastHeardAt = SystemClock.elapsedRealtime()
        var stopping = false
        var failedRestarts = 0
    }
    private var session: Session? = null

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
        s.typed = "" // this phrase is done: what it typed stays in the field as ordinary text
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

    /**
     * Puts [heard] into the field in place of what this phrase typed so far, so the words appear as
     * they are spoken and are corrected in place. Nothing of the user's own is touched: if the text
     * before the cursor is no longer what was typed (the cursor moved, the field changed), the phrase
     * starts afresh at the cursor instead of deleting anything.
     */
    private fun typeHeard(s: Session, heard: String) {
        val ic = FlorisImeService.currentInputConnection() ?: return
        ic.beginBatchEdit()
        try {
            // FlorisBoard keeps the last word of the field "composing"; finish that first, as its own typing does
            ic.finishComposingText()
            if (s.typed.isNotEmpty()) {
                val before = ic.getTextBeforeCursor(s.typed.length, 0)?.toString()
                if (before == s.typed) ic.deleteSurroundingText(s.typed.length, 0)
                s.typed = ""
            }
            val prev = ic.getTextBeforeCursor(1, 0)
            val text = if (!prev.isNullOrEmpty() && !prev.last().isWhitespace()) " $heard" else heard
            ic.commitText(text, 1)
            s.typed = text
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
                typeHeard(s, text)
            }
        }

        override fun onResults(results: Bundle?) {
            val s = session ?: return
            val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            if (!text.isNullOrBlank()) {
                heard()
                typeHeard(s, text)
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
