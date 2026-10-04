/*
 * evaBoard: clipboard thumbnails, decoded off the main thread, downscaled, and remembered.
 *
 * FlorisBoard decoded every picture at full size, on the main thread, each time its card came back
 * into view - a screenshot is two megapixels, so scrolling the clipboard stuttered. Here a card shows
 * nothing until a copy scaled to the card's size is ready, and finished copies stay in a small cache.
 */

package dev.patrickgold.florisboard.ime.clipboard

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.media.ThumbnailUtils
import android.provider.MediaStore
import android.util.LruCache
import android.util.Size
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

object ClipThumbnails {
    /** About 24 MB of thumbnails; the cache is sized in KB. */
    private val cache = object : LruCache<String, ImageBitmap>(24 * 1024) {
        override fun sizeOf(key: String, value: ImageBitmap) = value.width * value.height * 4 / 1024
    }

    /** The picture in [file], scaled so its longer side is about [maxSide] px (never enlarged). */
    suspend fun image(file: File, maxSide: Int): Result<ImageBitmap> = withContext(Dispatchers.IO) {
        val key = "i:${file.absolutePath}:${file.lastModified()}:$maxSide"
        cache.get(key)?.let { return@withContext Result.success(it) }
        runCatching {
            check(file.exists()) { "Unable to resolve image at ${file.absolutePath}" }
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(file.absolutePath, bounds)
            var sample = 1
            while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
            val raw = BitmapFactory.decodeFile(file.absolutePath, BitmapFactory.Options().apply { inSampleSize = sample })
            checkNotNull(raw) { "Unable to decode image at ${file.absolutePath}" }
            raw.asImageBitmap().also { cache.put(key, it) }
        }
    }

    /** A thumbnail of the video in [file], about [maxSide] px. */
    suspend fun video(file: File, maxSide: Int): Result<ImageBitmap> = withContext(Dispatchers.IO) {
        val key = "v:${file.absolutePath}:${file.lastModified()}:$maxSide"
        cache.get(key)?.let { return@withContext Result.success(it) }
        runCatching {
            check(file.exists()) { "Unable to resolve video at ${file.absolutePath}" }
            val raw: Bitmap? = if (android.os.Build.VERSION.SDK_INT >= 29) {
                ThumbnailUtils.createVideoThumbnail(file, Size(maxSide, maxSide), null)
            } else {
                @Suppress("DEPRECATION")
                ThumbnailUtils.createVideoThumbnail(file.absolutePath, MediaStore.Video.Thumbnails.MINI_KIND)
            }
            checkNotNull(raw) { "Unable to decode video at ${file.absolutePath}" }
            raw.asImageBitmap().also { cache.put(key, it) }
        }
    }
}
