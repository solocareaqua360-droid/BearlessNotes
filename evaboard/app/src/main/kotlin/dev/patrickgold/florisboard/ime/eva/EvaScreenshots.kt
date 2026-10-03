/*
 * evaBoard: every new screenshot - as taken, and again after it is edited and saved - goes onto
 * Android's clipboard, so it can be pasted anywhere at once (and lands in evaBoard's own
 * clipboard history under "Images", which records whatever reaches the clipboard).
 *
 * The keyboard watches the phone's media store while it runs (it runs as long as it is the
 * chosen keyboard) and picks images whose folder is Screenshots. It needs the photos permission,
 * which Android grants for all photos, not just screenshots. For the user's own use; meant to be
 * removed or limited before any public release.
 *
 * Edited screenshots replace their original: the user wants the edited version, and the
 * original only when it was never edited. On the user's Samsung a screenshot is saved by
 * com.android.systemui, and an edited one - under a new name with its own save time - by the
 * screenshot editor, com.samsung.android.app.smartcapture. So a file saved by the editor takes
 * the place of the last screenshot put on the clipboard (the original, or an earlier edit), if
 * that came within EDIT_WINDOW_MS; the same media-store entry saved again replaces itself too.
 * Two plain screenshots in a row are both kept. The last few files (name, saver, size) are
 * listed on the settings card for checking.
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
import dev.patrickgold.florisboard.clipboardManager
import dev.patrickgold.florisboard.ime.clipboard.provider.ItemType
import kotlinx.coroutines.flow.MutableStateFlow

object EvaScreenshots {
    /** Only images saved this recently count as "new" (an edit saves a fresh file or a fresh date). */
    private const val FRESH_SECONDS = 20L
    /** Media-store changes come in bursts; wait for the file to settle before reading it. */
    private const val SETTLE_MS = 800L

    private val main = Handler(Looper.getMainLooper())
    private var observer: ContentObserver? = null
    /** "id:dateModified" of the last screenshot put on the clipboard, so a burst puts it there once. */
    private var lastHandled: String? = null
    /** How long to wait for evaBoard's clipboard history to record a clip we just set. */
    private const val HISTORY_SETTLE_MS = 1500L

    /** Samsung's screenshot editor: a file it saves is an edited screenshot. */
    private const val EDITOR_PACKAGE = "com.samsung.android.app.smartcapture"
    /** An edit replaces the previous screenshot only if that came this recently. */
    private const val EDIT_WINDOW_MS = 10 * 60 * 1000L

    /** Media id -> its entry in the clipboard history. */
    private val historyEntryById = HashMap<Long, Long>()
    /** The clipboard-history entry of the last screenshot put on the clipboard, and when. */
    private var lastEntry: Long? = null
    private var lastEntryAt = 0L

    /** The last few screenshot file names seen, newest first - shown on the settings card. */
    val recentNames = MutableStateFlow<List<String>>(emptyList())

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
            MediaStore.Images.Media.DISPLAY_NAME,
            MediaStore.Images.Media.OWNER_PACKAGE_NAME,
            MediaStore.Images.Media.WIDTH,
            MediaStore.Images.Media.HEIGHT,
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
                // Diagnostics for the settings card: who saved the file and its size - Samsung names an
                // edited screenshot with its own save time, so the name cannot link it to its original.
                val info = "${cursor.getString(2) ?: ""} · ${cursor.getString(3) ?: "?"} · ${cursor.getInt(4)}x${cursor.getInt(5)}"
                Triple(cursor.getLong(0), cursor.getLong(1), (cursor.getString(3) ?: "") to info)
            }
        }.getOrNull() ?: return
        val (id, modified, ownerAndInfo) = found
        val (owner, info) = ownerAndInfo
        val key = "$id:$modified"
        if (key == lastHandled) return
        lastHandled = key
        recentNames.value = (listOf(info) + recentNames.value.filter { it != info }).take(3)

        // An edit of a screenshot already on the clipboard: its original leaves the history.
        val isEdit = owner == EDITOR_PACKAGE
        val earlierEntry = historyEntryById.remove(id)
            ?: lastEntry.takeIf { isEdit && System.currentTimeMillis() - lastEntryAt < EDIT_WINDOW_MS }
        if (earlierEntry != null) {
            val history = context.clipboardManager().value
            history.currentHistory.all.firstOrNull { it.id == earlierEntry }?.let {
                history.deleteClip(it, onlyIfUnpinned = true)
            }
        }

        val uri = ContentUris.withAppendedId(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, id)
        val clipboard = context.getSystemService(ClipboardManager::class.java) ?: return
        val setAt = System.currentTimeMillis()
        runCatching {
            clipboard.setPrimaryClip(ClipData.newUri(context.contentResolver, "Screenshot", uri))
        }.onFailure { return }

        // Note which history entry the clipboard made of it, once the history has recorded it.
        main.postDelayed({
            val entry = context.clipboardManager().value.currentHistory.all
                .filter { it.type == ItemType.IMAGE && it.creationTimestampMs >= setAt - 1000 }
                .maxByOrNull { it.creationTimestampMs }
                ?: return@postDelayed
            historyEntryById[id] = entry.id
            lastEntry = entry.id
            lastEntryAt = System.currentTimeMillis()
        }, HISTORY_SETTLE_MS)
    }
}
