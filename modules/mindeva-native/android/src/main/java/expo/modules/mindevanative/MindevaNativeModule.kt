package expo.modules.mindevanative

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The app's own small native pieces - each one something a JS library in
// the app could not do (see src/utils/mindevaNative.ts for the JS side,
// which also keeps the app working on an APK built before this existed).
class MindevaNativeModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("MindevaNative")

    // The window shows the phone's wallpaper under the app (see
    // plugins/withWallpaperWindow) - JS only offers "Шпалери телефона"
    // where this is true.
    Constant("wallpaperWindow") { true }

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
}
