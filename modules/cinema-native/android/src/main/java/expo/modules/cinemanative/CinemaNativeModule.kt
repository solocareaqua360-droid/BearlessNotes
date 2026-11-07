package expo.modules.cinemanative

import android.app.Activity
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Rational
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// The state of the system picture-in-picture window, shared between
// MainActivity (see plugins/withPictureInPicture.js: it reports the window
// opening/closing and the user leaving the app) and the module below.
object PipState {
  const val ACTION_BACK = "com.bearlessnotes.app.pip.BACK"
  const val ACTION_TOGGLE = "com.bearlessnotes.app.pip.TOGGLE"
  const val ACTION_FWD = "com.bearlessnotes.app.pip.FWD"

  @Volatile var active: Boolean = false
  // A video is playing: leaving the app (Home, the swipe up) turns it into
  // the small window by itself.
  @Volatile var armed: Boolean = false
  @Volatile var playing: Boolean = false
  @Volatile var w: Int = 16
  @Volatile var h: Int = 9
  @Volatile var listener: ((Boolean) -> Unit)? = null

  @JvmStatic
  fun changed(isActive: Boolean) {
    active = isActive
    listener?.invoke(isActive)
  }

  private fun action(context: Context, icon: Int, title: String, name: String, code: Int): RemoteAction {
    val intent = Intent(name).setPackage(context.packageName)
    val pending = PendingIntent.getBroadcast(context, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    return RemoteAction(Icon.createWithResource(context, icon), title, title, pending)
  }

  // The window's shape and its three buttons: back 10 s, play/pause,
  // forward 10 s - the system draws them over the small window.
  @JvmStatic
  fun build(context: Context): PictureInPictureParams {
    val b = PictureInPictureParams.Builder().setAspectRatio(Rational(w.coerceAtLeast(1), h.coerceAtLeast(1)))
    b.setActions(
      listOf(
        action(context, android.R.drawable.ic_media_rew, "-10 с", ACTION_BACK, 1),
        action(
          context,
          if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
          if (playing) "Пауза" else "Грати",
          ACTION_TOGGLE,
          2
        ),
        action(context, android.R.drawable.ic_media_ff, "+10 с", ACTION_FWD, 3)
      )
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) b.setAutoEnterEnabled(armed)
    return b.build()
  }

  // The user leaves the app while a video plays (MainActivity.onUserLeaveHint).
  @JvmStatic
  fun enterIfArmed(activity: Activity) {
    if (!armed || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    if (activity.isInPictureInPictureMode) return
    try {
      activity.enterPictureInPictureMode(build(activity))
    } catch (e: Exception) {
    }
  }
}

// Picture-in-picture for the video player. The system shrinks the WHOLE
// activity into the small window, so the JS side draws only the player
// while `active` is true (see components/PlayerHost.tsx).
class CinemaNativeModule : Module() {
  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("CinemaNative")

    Constant("pip") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.O }
    // Buttons in the window + leaving the app enters it (this APK and newer).
    Constant("pipControls") { true }

    Events("onPipChanged", "onPipAction")

    OnCreate {
      PipState.listener = { isActive -> sendEvent("onPipChanged", mapOf("active" to isActive)) }
      CinemaMedia.sendAction = { name -> sendEvent("onPipAction", mapOf("action" to name)) }
      WebHost.attach(appContext.reactContext?.applicationContext as? android.app.Application, appContext.currentActivity)
      val ctx = appContext.reactContext
      if (ctx != null) {
        val r = object : BroadcastReceiver() {
          override fun onReceive(c: Context, i: Intent) {
            val name = when (i.action) {
              PipState.ACTION_BACK -> "back"
              PipState.ACTION_FWD -> "fwd"
              else -> "toggle"
            }
            sendEvent("onPipAction", mapOf("action" to name))
          }
        }
        val filter = IntentFilter().apply {
          addAction(PipState.ACTION_BACK)
          addAction(PipState.ACTION_TOGGLE)
          addAction(PipState.ACTION_FWD)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          ctx.registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
          ctx.registerReceiver(r, filter)
        }
        receiver = r
      }
    }
    OnDestroy {
      PipState.listener = null
      CinemaMedia.sendAction = null
      WebHost.detach(appContext.reactContext?.applicationContext as? android.app.Application)
      val ctx = appContext.reactContext
      val r = receiver
      if (ctx != null && r != null) {
        try {
          ctx.unregisterReceiver(r)
        } catch (e: Exception) {
        }
      }
      receiver = null
    }

    Function("isPipActive") { PipState.active }

    // A script into the player's page, at once (see WebHost).
    Constant("webEval") { true }
    Function("webEval") { script: String -> WebHost.eval(script, appContext.currentActivity) }

    // THE PLAYER IN THE BACKGROUND (see MediaPlaybackService). Start while the
    // app is on screen (Android refuses to start it from the background); later
    // calls only refresh the notification. `mediaStop` ends it.
    Constant("mediaService") { true }

    Function("mediaStart") { title: String, playing: Boolean ->
      val ctx = appContext.reactContext ?: return@Function false
      try {
        if (CinemaMedia.running) {
          val nm = ctx.getSystemService(android.app.NotificationManager::class.java)
          nm.notify(CinemaMedia.NOTIFICATION_ID, CinemaMedia.build(ctx, title, playing))
        } else {
          val i = Intent(ctx, MediaPlaybackService::class.java).putExtra("title", title).putExtra("playing", playing)
          if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
        }
        true
      } catch (e: Exception) {
        false
      }
    }

    Function("mediaStop") {
      val ctx = appContext.reactContext ?: return@Function false
      try {
        ctx.stopService(Intent(ctx, MediaPlaybackService::class.java))
        true
      } catch (e: Exception) {
        false
      }
    }

    // What the window should be right now: `armed` = a video is playing
    // (leaving the app turns it into the window), `playing` picks the
    // play/pause icon. Safe to call again while the window is open - the
    // buttons update in place.
    Function("configurePip") { armed: Boolean, playing: Boolean, w: Int, h: Int ->
      PipState.armed = armed
      PipState.playing = playing
      PipState.w = w
      PipState.h = h
      val activity = appContext.currentActivity ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      try {
        activity.setPictureInPictureParams(PipState.build(activity))
        true
      } catch (e: Exception) {
        false
      }
    }

    // The button: shrink into the small window now.
    Function("enterPip") { w: Int, h: Int ->
      PipState.w = w
      PipState.h = h
      val activity = appContext.currentActivity ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      try {
        activity.enterPictureInPictureMode(PipState.build(activity))
      } catch (e: Exception) {
        false
      }
    }
  }
}
