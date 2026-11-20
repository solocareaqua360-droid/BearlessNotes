package expo.modules.mindevanative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.Image
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.view.WindowManager
import java.io.File
import java.io.FileOutputStream

// A FRAME FROM WHATEVER IS ON THE SCREEN - the video playing on a board
// (the user's, 2026-10-04: "скріншоти з відео, яке я відтворюю"). A video
// in a WebView cannot be read from the page (YouTube keeps its pixels to
// itself) nor photographed as a view (the video is its own surface and
// comes out black), so this is Android's own screen capture - what screen
// recorders use. The phone asks once (a system dialog), then the screen is
// mirrored into an ImageReader for as long as the session lasts; a frame
// is just the newest image, cut to the player's rectangle.
//
// Android 10+ wants a foreground service of type mediaProjection running
// while the screen is captured (ScreenCaptureService below), and Android 14
// a callback registered before the virtual display is made.
object ScreenCapture {
  private val lock = Any()
  private var projection: MediaProjection? = null
  private var display: VirtualDisplay? = null
  private var reader: ImageReader? = null
  private var latest: Image? = null
  private var thread: HandlerThread? = null
  // Told once the session is up (or could not start).
  var onReady: ((Boolean) -> Unit)? = null

  fun isActive(): Boolean = synchronized(lock) { projection != null }

  private fun ready(ok: Boolean) {
    val callback = onReady
    onReady = null
    callback?.invoke(ok)
  }

  fun begin(context: Context, resultCode: Int, data: Intent?) {
    if (data == null) return ready(false)
    try {
      val manager = context.getSystemService(MediaProjectionManager::class.java)
      val proj = manager.getMediaProjection(resultCode, data) ?: return ready(false)
      val handlerThread = HandlerThread("mindeva-capture").apply { start() }
      val handler = Handler(handlerThread.looper)
      proj.registerCallback(object : MediaProjection.Callback() {
        override fun onStop() {
          release()
        }
      }, handler)

      val windowManager = context.getSystemService(WindowManager::class.java)
      val width: Int
      val height: Int
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val bounds = windowManager.maximumWindowMetrics.bounds
        width = bounds.width()
        height = bounds.height()
      } else {
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        windowManager.defaultDisplay.getRealMetrics(metrics)
        width = metrics.widthPixels
        height = metrics.heightPixels
      }
      val dpi = context.resources.displayMetrics.densityDpi

      val imageReader = ImageReader.newInstance(width, height, PixelFormat.RGBA_8888, 3)
      // Only the newest image is kept, and the one before it let go - no
      // copy per frame, so a running session costs next to nothing.
      imageReader.setOnImageAvailableListener({ r ->
        val image = try {
          r.acquireLatestImage()
        } catch (e: Exception) {
          null
        }
        if (image != null) {
          synchronized(lock) {
            latest?.close()
            latest = image
          }
        }
      }, handler)
      val virtualDisplay = proj.createVirtualDisplay(
        "mindeva-capture",
        width,
        height,
        dpi,
        DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
        imageReader.surface,
        null,
        handler
      )
      synchronized(lock) {
        projection = proj
        display = virtualDisplay
        reader = imageReader
        thread = handlerThread
      }
      ready(true)
    } catch (e: Exception) {
      release()
      ready(false)
    }
  }

  fun release() {
    synchronized(lock) {
      latest?.close()
      latest = null
      display?.release()
      display = null
      reader?.close()
      reader = null
      try {
        projection?.stop()
      } catch (e: Exception) {
      }
      projection = null
      thread?.quitSafely()
      thread = null
    }
  }

  // The newest frame, cut to (x, y, w, h) in screen pixels (w <= 0: the
  // whole screen), as a JPEG in the cache. Null when there is no session
  // or no frame yet.
  fun grab(context: Context, x: Int, y: Int, w: Int, h: Int): Map<String, Any>? {
    val full: Bitmap = synchronized(lock) {
      val image = latest ?: return null
      val plane = image.planes[0]
      val pixelStride = plane.pixelStride
      val rowStride = plane.rowStride
      val rowPadding = rowStride - pixelStride * image.width
      val bitmap = Bitmap.createBitmap(image.width + rowPadding / pixelStride, image.height, Bitmap.Config.ARGB_8888)
      val buffer = plane.buffer
      buffer.rewind()
      bitmap.copyPixelsFromBuffer(buffer)
      if (rowPadding == 0) bitmap else Bitmap.createBitmap(bitmap, 0, 0, image.width, image.height)
    }
    val left = x.coerceIn(0, full.width - 1)
    val top = y.coerceIn(0, full.height - 1)
    val cutW = if (w <= 0) full.width - left else w.coerceAtMost(full.width - left)
    val cutH = if (h <= 0) full.height - top else h.coerceAtMost(full.height - top)
    val frame = if (left == 0 && top == 0 && cutW == full.width && cutH == full.height) full
      else Bitmap.createBitmap(full, left, top, cutW, cutH)
    val dir = File(context.cacheDir, "frames").apply { mkdirs() }
    val file = File(dir, "frame-${System.currentTimeMillis()}.jpg")
    FileOutputStream(file).use { frame.compress(Bitmap.CompressFormat.JPEG, 92, it) }
    return mapOf("uri" to "file://${file.absolutePath}", "width" to frame.width, "height" to frame.height)
  }
}

// The foreground service a screen capture must run under (Android 10+):
// started with the user's consent in its intent, it shows a quiet
// notification for as long as the session lasts and ends it when stopped.
class ScreenCaptureService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val channelId = "mindeva_screen_capture"
    val notification: Notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      if (manager.getNotificationChannel(channelId) == null) {
        manager.createNotificationChannel(
          NotificationChannel(channelId, "Кадри з відео", NotificationManager.IMPORTANCE_LOW)
        )
      }
      Notification.Builder(this, channelId)
        .setContentTitle("mindEva бере кадри з відео")
        .setSmallIcon(android.R.drawable.ic_menu_camera)
        .setOngoing(true)
        .build()
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
        .setContentTitle("mindEva бере кадри з відео")
        .setSmallIcon(android.R.drawable.ic_menu_camera)
        .build()
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
    val code = intent?.getIntExtra(EXTRA_CODE, 0) ?: 0
    val data: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      intent?.getParcelableExtra(EXTRA_DATA, Intent::class.java)
    } else {
      @Suppress("DEPRECATION")
      intent?.getParcelableExtra(EXTRA_DATA)
    }
    ScreenCapture.begin(this, code, data)
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    ScreenCapture.release()
    super.onDestroy()
  }

  companion object {
    const val NOTIFICATION_ID = 4711
    const val EXTRA_CODE = "code"
    const val EXTRA_DATA = "data"
  }
}
