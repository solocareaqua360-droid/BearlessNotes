/*
 * evaBoard: «На Mac» in Android's Share sheet. What is shared - files, photos, text - goes into the
 * keyboard's clipboard history as a fresh copy, and from there the Mac link (EvaMacSync) sends it on:
 * a file lands in the Mac's Downloads and on its clipboard, ready for Cmd+V.
 *
 * Files are copied into the app's own storage before the activity closes, because the right to read
 * what another app shared ends with this activity.
 */

package dev.patrickgold.florisboard.ime.eva.macsync

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import dev.patrickgold.florisboard.app.FlorisPreferenceStore
import dev.patrickgold.florisboard.clipboardManager
import dev.patrickgold.florisboard.ime.clipboard.provider.ClipboardItem
import dev.patrickgold.florisboard.ime.clipboard.provider.ItemType
import dev.patrickgold.florisboard.FlorisApplication
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class EvaShareToMacActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val uris = streams(intent)
        val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
        lifecycleScope.launch {
            // a cold start reads the settings in the background: wait for them before trusting the switch
            (application as FlorisApplication).preferenceStoreLoaded.first { it }
            val prefs by FlorisPreferenceStore
            if (!prefs.keyboard.evaMacSync.get()) {
                Toast.makeText(this@EvaShareToMacActivity, "Увімкніть «Буфер обміну на Mac» у налаштуваннях evaBoard", Toast.LENGTH_LONG).show()
                finish()
                return@launch
            }
            val clipboard by clipboardManager()
            val sent = withContext(Dispatchers.IO) {
                var count = 0
                for ((index, uri) in uris.withIndex()) {
                    val info = EvaFiles.info(this@EvaShareToMacActivity, uri)
                    val kept = EvaFiles.keepShared(this@EvaShareToMacActivity, uri, info.name) ?: continue
                    clipboard.insertClip(
                        ClipboardItem(
                            type = ItemType.FILE,
                            text = info.name,
                            uri = kept,
                            // a little apart, so several files keep the order they were shared in
                            creationTimestampMs = System.currentTimeMillis() + index,
                            isPinned = false,
                            mimeTypes = listOf(info.mime),
                        )
                    )
                    count++
                }
                if (uris.isEmpty() && !text.isNullOrEmpty()) {
                    clipboard.insertClip(ClipboardItem.text(text))
                    count++
                }
                count
            }
            val status = EvaMacSync.status.value
            Toast.makeText(
                this@EvaShareToMacActivity,
                when {
                    sent == 0 -> "Нічого не вдалося взяти"
                    status.startsWith("Підключено") -> "Надсилаю на Mac…"
                    else -> "Mac зараз не на звʼязку - надішлю, щойно зʼявиться"
                },
                Toast.LENGTH_SHORT,
            ).show()
            finish()
        }
    }

    @Suppress("DEPRECATION")
    private fun streams(intent: Intent): List<Uri> = when (intent.action) {
        Intent.ACTION_SEND_MULTIPLE -> if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
        } else {
            intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
        }?.toList() ?: emptyList()
        else -> listOfNotNull(
            if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            else intent.getParcelableExtra(Intent.EXTRA_STREAM)
        )
    }
}
