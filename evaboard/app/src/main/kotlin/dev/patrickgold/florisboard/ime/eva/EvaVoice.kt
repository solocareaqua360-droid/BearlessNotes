/*
 * evaBoard: voice input inside the keyboard itself.
 *
 * FlorisBoard's voice key handed the text field over to another, voice-only
 * keyboard; on the user's phone that keyboard started and stopped again 4-5
 * times before it stayed. Here evaBoard listens itself through Android's own
 * speech recognizer (SpeechRecognizer), in the language of the active
 * layout, and types the result into the field.
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
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import dev.patrickgold.florisboard.editorInstance
import dev.patrickgold.florisboard.subtypeManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

object EvaVoice {
    sealed interface State {
        data object Idle : State
        /** Listening; [partial] is what has been heard so far (shown in the strip, not typed yet). */
        data class Listening(val partial: String) : State
        /** A short note shown in the strip for a moment (nothing heard, no permission, ...). */
        data class Note(val text: String) : State
    }

    private val _state = MutableStateFlow<State>(State.Idle)
    val state: StateFlow<State> = _state.asStateFlow()

    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private val clearNote = Runnable { if (_state.value is State.Note) _state.value = State.Idle }

    /** The microphone button: starts listening, or stops early if already listening. */
    fun toggle(context: Context) {
        if (recognizer != null) {
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
        val sr = SpeechRecognizer.createSpeechRecognizer(context)
        recognizer = sr
        sr.setRecognitionListener(Listener(context))
        _state.value = State.Listening("")
        sr.startListening(
            Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
        )
    }

    /** Drops whatever is being listened to - the keyboard went away. */
    fun cancel() {
        recognizer?.let {
            it.cancel()
            it.destroy()
        }
        recognizer = null
        if (_state.value is State.Listening) _state.value = State.Idle
    }

    private fun finish() {
        recognizer?.destroy()
        recognizer = null
    }

    private fun note(text: String) {
        _state.value = State.Note(text)
        main.removeCallbacks(clearNote)
        main.postDelayed(clearNote, 2500)
    }

    private fun type(context: Context, heard: String) {
        val editor = context.editorInstance().value
        val before = editor.activeContent.textBeforeSelection
        val text = if (before.isNotEmpty() && !before.last().isWhitespace()) " $heard" else heard
        editor.commitText(text)
    }

    private class Listener(private val context: Context) : RecognitionListener {
        override fun onPartialResults(partialResults: Bundle?) {
            val heard = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            if (!heard.isNullOrBlank()) _state.value = State.Listening(heard)
        }

        override fun onResults(results: Bundle?) {
            val heard = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
            finish()
            if (heard.isNullOrBlank()) {
                note("Нічого не розпізнано")
            } else {
                _state.value = State.Idle
                type(context, heard)
            }
        }

        override fun onError(error: Int) {
            finish()
            note(
                when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Нічого не розпізнано"
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT ->
                        "Немає інтернету для розпізнавання"
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Немає дозволу на мікрофон"
                    SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE ->
                        "Ця мова не розпізнається"
                    SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Розпізнавання зайняте, спробуйте ще раз"
                    else -> "Не вдалося розпізнати (код $error)"
                }
            )
        }

        override fun onReadyForSpeech(params: Bundle?) = Unit
        override fun onBeginningOfSpeech() = Unit
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
