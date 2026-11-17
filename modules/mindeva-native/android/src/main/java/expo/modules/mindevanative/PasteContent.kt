package expo.modules.mindevanative

import android.content.ClipData
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import android.widget.EditText
import androidx.core.view.ContentInfoCompat
import androidx.core.view.OnReceiveContentListener
import androidx.core.view.ViewCompat
import java.io.File
import java.util.UUID

// PICTURES AND FILES INTO A NOTE'S FIELD (2026-11-17, the user: Gboard's clipboard panel and «Вставити» did nothing for an
// image or a file). A React Native text field is an EditText that tells the keyboard it takes TEXT ONLY, so the keyboard
// never even offers the picture. Naming a content listener on the field changes that for the keyboard (its clipboard panel,
// stickers, GIFs) and for the long-press «Вставити» alike: whatever carries a content:// uri comes here, and plain text is
// handed back to the field untouched.
//
// The uri's read grant lives only while the listener runs, so each item is copied into the app's cache RIGHT HERE and JS
// gets file:// paths it can keep.
object PasteContent {
  private val MIME_TYPES = arrayOf("image/*", "video/*", "audio/*", "application/*", "text/*", "*/*")

  fun attach(field: EditText, onItems: (List<Map<String, Any?>>) -> Unit) {
    val listener = OnReceiveContentListener { _, payload ->
      // Items with a uri are ours; the rest (plain text) goes on to the field.
      val split = payload.partition { item -> item.uri != null }
      val withUri = split.first
      val rest = split.second
      if (withUri != null) {
        val items = ArrayList<Map<String, Any?>>()
        val clip: ClipData = withUri.clip
        for (i in 0 until clip.itemCount) {
          val uri = clip.getItemAt(i).uri ?: continue
          copyOne(field.context, uri)?.let { items.add(it) }
        }
        if (items.isNotEmpty()) onItems(items)
      }
      rest
    }
    ViewCompat.setOnReceiveContentListener(field, MIME_TYPES, listener)
  }

  private fun copyOne(context: Context, uri: Uri): Map<String, Any?>? {
    return try {
      val resolver = context.contentResolver
      var name: String? = null
      var size = -1L
      resolver.query(uri, null, null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          val n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          val s = c.getColumnIndex(OpenableColumns.SIZE)
          if (n >= 0) name = c.getString(n)
          if (s >= 0 && !c.isNull(s)) size = c.getLong(s)
        }
      }
      val mime = resolver.getType(uri) ?: "application/octet-stream"
      val ext = MimeTypeMap.getSingleton().getExtensionFromMimeType(mime)
      var fileName = name?.takeIf { it.isNotBlank() } ?: "paste-${System.currentTimeMillis()}" + (if (ext != null) ".$ext" else "")
      if (!fileName.contains('.') && ext != null) fileName = "$fileName.$ext"
      val dir = File(context.cacheDir, "pasted").apply { mkdirs() }
      val target = File(dir, UUID.randomUUID().toString().take(8) + "-" + fileName.replace(Regex("[\\\\/:*?\"<>|]"), "_"))
      resolver.openInputStream(uri)?.use { input -> target.outputStream().use { out -> input.copyTo(out) } } ?: return null
      mapOf("uri" to "file://${target.absolutePath}", "name" to fileName, "mime" to mime, "size" to (if (size >= 0) size else target.length()))
    } catch (e: Exception) {
      null
    }
  }
}
