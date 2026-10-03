/*
 * evaBoard: every new screenshot - as taken, and again after it is edited and saved - goes onto
 * Android's clipboard, so it can be pasted anywhere at once (and lands in evaBoard's own
 * clipboard history under "Images", which records whatever reaches the clipboard).
 *
 * The keyboard watches the phone's media store while it runs (it runs as long as it is the
 * chosen keyboard) and picks images whose folder is Screenshots. It needs the photos permission,
 * which Android grants for all photos, not just screenshots. For the user's own use; meant to be
 * removed or limited before any public release.
 */

package dev.patrickgold.florisboard.ime.eva

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentUris
import android.content.Context
import android.content.pm.PackageManager
import android.database.ContentObserver
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import dev.patrickgold.florisboard.app.FlorisPreferenceStore

object EvaScreenshots {
    /** Only images saved this recently count as "new" (an edit saves a fresh file or a fresh date). */
    private const val FRESH_SECONDS = 20L
    /** Media-store changes come in bursts; wait for the file to settle before reading it. */
    private const val SETTLE_MS = 800L

    private val main = Handler(Looper.getMainLooper())
    private var observer: ContentObserver? = null
    /** "id:dateModified" of the last screenshot put on the clipboard, so a burst puts it there once. */
    private var lastHandled: String? = null

    val permission: String
        get() = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.READ_MEDIA_IMAGES
        else Manifest.permission.READ_EXTERNAL_STORAGE

    fun hasPermission(context: Context) =
        context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED

    /** Starts watching; called once when the keyboard service starts. */
    fun start(context: Context) {
        if (observer != null) return
        val app = context.applicationContext
        val check = Runnable { checkLatest(app) }
        observer = object : ContentObserver(main) {
            override fun onChange(selfChange: Boolean, uri: Uri?) {
                main.removeCallbacks(check)
                main.postDelayed(check, SETTLE_MS)
            }
        }.also {
            app.contentResolver.registerContentObserver(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, true, it,
            )
        }
    }

    fun stop(context: Context) {
        observer?.let { context.applicationContext.contentResolver.unregisterContentObserver(it) }
        observer = null
    }

    private fun checkLatest(context: Context) {
        val prefs by FlorisPreferenceStore
        if (!prefs.keyboard.evaScreenshotsToClipboard.get() || !hasPermission(context)) return
        val now = System.currentTimeMillis() / 1000
        val projection = arrayOf(
            MediaStore.Images.Media._ID,
            MediaStore.Images.Media.DATE_MODIFIED,
            MediaStore.Images.Media.RELATIVE_PATH,
        )
        val selection = "${MediaStore.Images.Media.DATE_MODIFIED} >= ? AND " +
            "${MediaStore.Images.Media.IS_PENDING} = 0 AND " +
            "${MediaStore.Images.Media.RELATIVE_PATH} LIKE ?"
        val args = arrayOf((now - FRESH_SECONDS).toString(), "%Screenshots%")
        val order = "${MediaStore.Images.Media.DATE_MODIFIED} DESC"
        val found = runCatching {
            context.contentResolver.query(
                MediaStore.Images.Media.EXTERNAL_CONTENT_URI, projection, selection, args, order,
            )?.use { cursor ->
                if (!cursor.moveToFirst()) return@use null
                cursor.getLong(0) to cursor.getLong(1)
            }
        }.getOrNull() ?: return
        val (id, modified) = found
        val key = "$id:$modified"
        if (key == lastHandled) return
        lastHandled = key
        val uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
        val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
        runCatching {
            clipboard.setPrimaryClip(ClipData.newUri(context.contentResolver, "Screenshot", uri))
        }
    }
}
