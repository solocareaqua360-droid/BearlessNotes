/*
 * evaBoard: scan a page from the keyboard straight onto the clipboard.
 *
 * A transparent activity launched from the clipboard panel's scan button. It opens Google's on-device
 * document scanner (camera, edge detection, straighten, crop, the user's own filter choice - the whole
 * UI is Google's, nothing here decides the look of the page), then copies each scanned JPEG into the
 * app's private cache and puts it on the clipboard, where evaBoard's history clones it into its own private
 * storage (never the gallery or a shared folder) and the Mac sync carries it over. No camera permission of
 * our own: the scanner runs inside Play Services.
 */

package dev.patrickgold.florisboard.ime.eva

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.core.content.FileProvider
import java.io.File
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult

class EvaScanActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val options = GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true)
            .setPageLimit(20)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            // FULL: crop, rotate and the filters - the user picks the filter in the scanner itself.
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build()
        GmsDocumentScanning.getClient(options).getStartScanIntent(this)
            .addOnSuccessListener { sender ->
                try {
                    startIntentSenderForResult(sender, REQ, null, 0, 0, 0)
                } catch (_: Exception) {
                    finish()
                }
            }
            .addOnFailureListener { finish() }
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ || resultCode != RESULT_OK) {
            finish()
            return
        }
        val pages = GmsDocumentScanningResult.fromActivityResultIntent(data)?.pages.orEmpty()
        val saved = pages.mapNotNull { copyToPrivateCache(it.imageUri) }
        putOnClipboard(saved)
        finish()
    }

    /**
     * Copies a scanned JPEG into the app's PRIVATE cache and returns its content URI (served by our own
     * FileProvider), or null. Nothing goes to the gallery or any shared folder: the clipboard history
     * clones whatever URI it is given into its own private storage (ClipboardFileStorage), so the cache
     * file is only a short-lived hand-over. Old hand-over files are swept on every scan.
     */
    private fun copyToPrivateCache(source: Uri): Uri? {
        return try {
            val dir = File(cacheDir, "eva-scans").apply { mkdirs() }
            val now = System.currentTimeMillis()
            dir.listFiles()?.forEach { if (now - it.lastModified() > DAY_MS) it.delete() }
            val file = File(dir, "scan-$now-${source.hashCode()}.jpg")
            contentResolver.openInputStream(source)!!.use { input ->
                file.outputStream().use { input.copyTo(it) }
            }
            FileProvider.getUriForFile(this, "$packageName.provider.file", file)
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Puts the scans on the clipboard. evaBoard's clipboard listens for the primary clip and records
     * each one in its history (and syncs it to the Mac); setting them one after another, with a gap,
     * lets every page land in the history, the last one staying as the primary clip to paste.
     */
    private fun putOnClipboard(uris: List<Uri>) {
        if (uris.isEmpty()) return
        val clipboard = getSystemService(ClipboardManager::class.java) ?: return
        val main = Handler(Looper.getMainLooper())
        uris.forEachIndexed { index, uri ->
            main.postDelayed({
                runCatching { clipboard.setPrimaryClip(ClipData.newUri(contentResolver, "Скан", uri)) }
            }, index * 450L)
        }
    }

    companion object {
        private const val REQ = 7301
        private const val DAY_MS = 24L * 60 * 60 * 1000

        /** Opens the scanner over the current app; the keyboard calls this from its scan button. */
        fun start(context: android.content.Context) {
            try {
                context.startActivity(
                    Intent(context, EvaScanActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            } catch (_: Exception) {
            }
        }
    }
}
