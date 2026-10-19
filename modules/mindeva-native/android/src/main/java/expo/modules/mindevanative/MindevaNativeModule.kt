package expo.modules.mindevanative

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.graphics.Bitmap
import android.graphics.Rect
import android.view.View
import android.widget.EditText
import android.view.PixelCopy
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executors
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues

// The app's own small native pieces - each one something a JS library in
// the app could not do (see src/utils/mindevaNative.ts for the JS side,
// which also keeps the app working on an APK built before this existed).
class MindevaNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  // The screen capture's consent, waiting for the system dialog's answer.
  private var capturePromise: Promise? = null

  override fun definition() = ModuleDefinition {
    Name("MindevaNative")

    // The window shows the phone's wallpaper under the app (see
    // plugins/withWallpaperWindow) - JS only offers "Шпалери телефона"
    // where this is true.
    Constant("wallpaperWindow") { true }

    // FRAMES FROM A PLAYING VIDEO (see ScreenCapture.kt). Starting asks the
    // phone (its own dialog) and resolves true once the session is up;
    // a frame is then taken as often as wanted until it is stopped.
    Constant("screenCapture") { true }

    AsyncFunction("startScreenCapture") { promise: Promise ->
      if (ScreenCapture.isActive()) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.resolve(false)
        return@AsyncFunction
      }
      val manager = context.getSystemService(MediaProjectionManager::class.java)
      capturePromise?.resolve(false)
      capturePromise = promise
      activity.startActivityForResult(manager.createScreenCaptureIntent(), CAPTURE_REQUEST)
    }

    OnActivityResult { _, payload ->
      if (payload.requestCode != CAPTURE_REQUEST) return@OnActivityResult
      val promise = capturePromise ?: return@OnActivityResult
      capturePromise = null
      if (payload.resultCode != Activity.RESULT_OK || payload.data == null) {
        promise.resolve(false)
        return@OnActivityResult
      }
      ScreenCapture.onReady = { ok -> promise.resolve(ok) }
      val intent = Intent(context, ScreenCaptureService::class.java)
        .putExtra(ScreenCaptureService.EXTRA_CODE, payload.resultCode)
        .putExtra(ScreenCaptureService.EXTRA_DATA, payload.data)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent)
      else context.startService(intent)
    }

    AsyncFunction("grabScreenFrame") { x: Int, y: Int, w: Int, h: Int ->
      ScreenCapture.grab(context, x, y, w, h)
    }

    Function("isScreenCapturing") { ScreenCapture.isActive() }

    // A PICTURE OF WHAT IS ALREADY ON THE SCREEN (the preview plan, stage 1,
    // 2026-10-06). react-native-view-shot draws a view tree again, in
    // software, on the UI thread - the thread that takes taps - and a desk
    // full of page miniatures and blur took long enough to be felt. Android
    // already HAS the frame: PixelCopy copies a rectangle of the window's
    // composited surface, off the UI thread, in a few milliseconds - the
    // way the phone's own recent-apps screen keeps its pictures. Window
    // pixels in; a JPEG in the cache out, at most maxWidth wide (0: as is).
    Constant("windowCopy") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.O }

    AsyncFunction("copyWindowRect") { x: Int, y: Int, w: Int, h: Int, maxWidth: Int, quality: Int, promise: Promise ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
        promise.resolve(null)
        return@AsyncFunction
      }
      val activity = appContext.currentActivity
      val window = activity?.window
      val decor = window?.peekDecorView()
      if (window == null || decor == null || decor.width <= 0 || decor.height <= 0) {
        promise.resolve(null)
        return@AsyncFunction
      }
      val left = x.coerceIn(0, decor.width - 1)
      val top = y.coerceIn(0, decor.height - 1)
      val right = (if (w <= 0) decor.width else x + w).coerceIn(left + 1, decor.width)
      val bottom = (if (h <= 0) decor.height else y + h).coerceIn(top + 1, decor.height)
      val rect = Rect(left, top, right, bottom)
      val bitmap = try {
        Bitmap.createBitmap(rect.width(), rect.height(), Bitmap.Config.ARGB_8888)
      } catch (e: Throwable) {
        promise.resolve(null)
        return@AsyncFunction
      }
      try {
        PixelCopy.request(window, rect, bitmap, { result ->
          if (result != PixelCopy.SUCCESS) {
            bitmap.recycle()
            promise.resolve(null)
            return@request
          }
          writer.execute {
            try {
              val out = if (maxWidth > 0 && bitmap.width > maxWidth) {
                val scaled = Bitmap.createScaledBitmap(bitmap, maxWidth, (bitmap.height.toLong() * maxWidth / bitmap.width).toInt().coerceAtLeast(1), true)
                bitmap.recycle()
                scaled
              } else bitmap
              val dir = File(context.cacheDir, "windowCopies").apply { mkdirs() }
              // Copies are short-lived (moved away, or shown for a moment):
              // whatever is older than ten minutes is nobody's any more.
              val stale = System.currentTimeMillis() - 10 * 60 * 1000
              dir.listFiles()?.forEach { if (it.lastModified() < stale) it.delete() }
              val file = File(dir, "copy-${System.currentTimeMillis()}-${(Math.random() * 1e6).toInt()}.jpg")
              FileOutputStream(file).use { out.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(30, 100), it) }
              val result2 = mapOf("uri" to "file://${file.absolutePath}", "width" to out.width, "height" to out.height)
              out.recycle()
              promise.resolve(result2)
            } catch (e: Throwable) {
              promise.resolve(null)
            }
          }
        }, copyHandler)
      } catch (e: Throwable) {
        bitmap.recycle()
        promise.resolve(null)
      }
    }

    Function("stopScreenCapture") {
      context.stopService(Intent(context, ScreenCaptureService::class.java))
      ScreenCapture.release()
      true
    }

    // A NOTE LINK WHILE TYPING, ROUNDED (see ChipSpans.kt). JS hands over
    // the look in dp and the alpha that marks a link's run, then names each
    // field that shows links by its view tag.
    Constant("chipSpans") { true }

    Function("configureChipSpans") { fill: Int, mark: Int, radius: Double, padX: Double, padTop: Double, padBottom: Double ->
      ChipSpans.configure(
        context.resources.displayMetrics.density,
        fill,
        mark,
        radius.toFloat(),
        padX.toFloat(),
        padTop.toFloat(),
        padBottom.toFloat()
      )
      true
    }

    AsyncFunction("attachChipField") { viewTag: Int ->
      val field = appContext.findView<View>(viewTag) as? EditText ?: return@AsyncFunction false
      ChipSpans.attach(field)
      true
    }.runOnQueue(Queues.MAIN)

    // THE WHITE STRIP AT THE FOOT OF THE FOLD'S INNER SCREEN (found
    // 2026-10-02, there only - the cover screen has none): Android lays a
    // contrast veil over the navigation bar's area when it thinks the app
    // under it might be hard to read against. The app draws its own ground
    // there, so the veil only shows as a pale band. Off asks the phone not
    // to lay it (Android 10+; false where there is no such setting).
    Function("setNavigationBarContrast") { enforced: Boolean ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return@Function false
      val activity = appContext.currentActivity ?: return@Function false
      activity.runOnUiThread { activity.window.isNavigationBarContrastEnforced = enforced }
      true
    }

    // BLUR OF THE WALLPAPER (the user's, 2026-10-02: "окрім затемнення ще
    // і блюру"). Android 12+ blurs whatever lies under a window's
    // background - here, the wallpaper the window shows (see
    // plugins/withWallpaperWindow) - at a radius that can change while
    // the app runs, so a slider can drive it. Returns whether the phone
    // will actually draw it: blur can be off system-wide (power saving,
    // "reduce transparency"), and below Android 12 there is none.
    Function("setWindowBlur") { radius: Int ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function false
      val activity = appContext.currentActivity ?: return@Function false
      activity.runOnUiThread { activity.window.setBackgroundBlurRadius(radius.coerceIn(0, 300)) }
      activity.windowManager.isCrossWindowBlurEnabled
    }

    // A notification channel whose sound plays on Android's ALARM stream
    // (the alarm volume slider, and Do Not Disturb's alarm exception)
    // with the phone's own alarm ringtone - what notifee's createChannel
    // cannot ask for: it has no AudioAttributes. A channel's sound is
    // fixed once created, hence a new channel id rather than changing
    // the old one.
    Function("ensureAlarmChannel") { id: String, name: String, description: String ->
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(id) != null) return@Function true
      val sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
      val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_ALARM)
        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
        .build()
      val channel = NotificationChannel(id, name, NotificationManager.IMPORTANCE_HIGH).apply {
        this.description = description
        setSound(sound, attributes)
        enableVibration(true)
        vibrationPattern = longArrayOf(0, 300, 700, 300, 700)
        setBypassDnd(true)
        lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
      }
      manager.createNotificationChannel(channel)
      true
    }
  }

  companion object {
    private const val CAPTURE_REQUEST = 47110

    // PixelCopy answers on this thread, and the JPEG is written on the
    // writer - neither is the UI thread.
    private val copyHandler: Handler by lazy {
      Handler(HandlerThread("mindeva-pixelcopy").apply { start() }.looper)
    }
    private val writer = Executors.newSingleThreadExecutor()
  }
}
