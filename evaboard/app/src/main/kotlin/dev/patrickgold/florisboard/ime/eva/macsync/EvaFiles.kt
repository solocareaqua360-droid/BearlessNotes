/*
 * evaBoard: files in the clipboard history - the ones that came from the Mac and the ones sent to it.
 *
 * Android has nowhere to paste a file into, so a file card is for opening and sharing: a file from
 * the Mac is saved in Downloads/evaBoard (where the user can find it), and its card's tap shares it
 * (or pastes it, in the rare field that accepts its type). A file sent to the Mac from the Share sheet
 * (EvaShareToMacActivity) is copied into the app's own storage first, so it can still be sent after
 * the app that shared it has let go of it; that copy goes when its card does. Downloads are never
 * deleted with their card.
 */

package dev.patrickgold.florisboard.ime.eva.macsync

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import dev.patrickgold.florisboard.BuildConfig
import dev.patrickgold.florisboard.ime.clipboard.provider.ClipboardItem
import java.io.File
import java.io.InputStream

object EvaFiles {
    private val fileAuthority get() = "${BuildConfig.APPLICATION_ID}.provider.file"
    private const val SHARED_DIR = "eva-files"

    data class Info(val name: String, val mime: String, val size: Long)

    fun mimeFor(name: String): String =
        MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase())
            ?: "application/octet-stream"

    /** Name, type and size of a content URI, as far as its provider tells. */
    fun info(context: Context, uri: Uri, fallbackName: String = "file"): Info {
        var name = fallbackName
        var size = -1L
        try {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
                if (c.moveToFirst()) {
                    c.getString(0)?.let { name = it }
                    if (!c.isNull(1)) size = c.getLong(1)
                }
            }
        } catch (_: Exception) {
        }
        if (uri.scheme == "file") uri.path?.let { File(it) }?.let { name = it.name; size = it.length() }
        val mime = context.contentResolver.getType(uri)?.takeIf { it != "application/octet-stream" } ?: mimeFor(name)
        return Info(name, mime, size)
    }

    fun open(context: Context, uri: Uri): InputStream? = try {
        context.contentResolver.openInputStream(uri)
    } catch (_: Exception) {
        null
    }

    /** Keeps a copy of a shared file in the app's own storage; its content URI, or null. */
    fun keepShared(context: Context, source: Uri, name: String): Uri? {
        val dir = File(context.filesDir, SHARED_DIR).apply { mkdirs() }
        val safe = name.replace('/', '_').ifBlank { "file" }
        val target = File(dir, "${System.nanoTime()}-$safe")
        return try {
            context.contentResolver.openInputStream(source)!!.use { input -> target.outputStream().use { input.copyTo(it) } }
            FileProvider.getUriForFile(context, fileAuthority, target)
        } catch (_: Exception) {
            target.delete()
            null
        }
    }

    /** Saves a file that came from the Mac into Downloads/evaBoard; its content URI, or null. */
    fun saveDownload(context: Context, temp: File, name: String, mime: String): Uri? {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, name)
                    put(MediaStore.Downloads.MIME_TYPE, mime)
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/evaBoard")
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = context.contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return null
                resolver.openOutputStream(uri)!!.use { out -> temp.inputStream().use { it.copyTo(out) } }
                resolver.update(uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
                uri
            } else {
                val dir = File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "evaBoard").apply { mkdirs() }
                val target = File(dir, name)
                temp.copyTo(target, overwrite = true)
                FileProvider.getUriForFile(context, fileAuthority, target)
            }
        } catch (_: Exception) {
            null
        }
    }

    /** A card is going: its private copy goes with it; a download stays where it is. */
    fun release(context: Context, uri: Uri?) {
        if (uri == null || uri.authority != fileAuthority) return
        if (uri.pathSegments.firstOrNull() != "eva_files") return
        val name = uri.lastPathSegment ?: return
        File(File(context.filesDir, SHARED_DIR), name).delete()
    }

    fun share(context: Context, item: ClipboardItem) {
        val uri = item.uri ?: return
        val send = Intent(Intent.ACTION_SEND).apply {
            type = item.mimeTypes.firstOrNull() ?: "*/*"
            putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        start(context, Intent.createChooser(send, item.text ?: "Файл"))
    }

    fun view(context: Context, item: ClipboardItem) {
        val uri = item.uri ?: return
        val view = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, item.mimeTypes.firstOrNull() ?: "*/*")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        start(context, Intent.createChooser(view, item.text ?: "Файл"))
    }

    private fun start(context: Context, intent: Intent) {
        try {
            context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (_: Exception) {
        }
    }
}
