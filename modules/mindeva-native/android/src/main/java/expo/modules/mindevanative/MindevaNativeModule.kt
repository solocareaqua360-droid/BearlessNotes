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
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

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

    Function("stopScreenCapture") {
      context.stopService(Intent(context, ScreenCaptureService::class.java))
      ScreenCapture.release()
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
  }
}
