package expo.modules.cinemanative

import android.app.PictureInPictureParams
import android.os.Build
import android.util.Rational
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Where MainActivity (see plugins/withPictureInPicture.js) reports the
// system picture-in-picture window opening and closing; the module below
// passes it on to JS as an event.
object PipState {
  @Volatile var active: Boolean = false
  @Volatile var listener: ((Boolean) -> Unit)? = null

  @JvmStatic
  fun changed(isActive: Boolean) {
    active = isActive
    listener?.invoke(isActive)
  }
}

// Picture-in-picture for the video player. The system shrinks the WHOLE
// activity into the small window, so the JS side draws only the player
// while `active` is true (see components/PlayerHost.tsx).
class CinemaNativeModule : Module() {
  private fun params(w: Int, h: Int, autoEnter: Boolean): PictureInPictureParams {
    val b = PictureInPictureParams.Builder().setAspectRatio(Rational(w.coerceAtLeast(1), h.coerceAtLeast(1)))
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) b.setAutoEnterEnabled(autoEnter)
    return b.build()
  }

  override fun definition() = ModuleDefinition {
    Name("CinemaNative")

    Constant("pip") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.O }

    Events("onPipChanged")

    OnCreate {
      PipState.listener = { isActive -> sendEvent("onPipChanged", mapOf("active" to isActive)) }
    }
    OnDestroy { PipState.listener = null }

    Function("isPipActive") { PipState.active }

    // While a video plays, going Home turns it into the small window by
    // itself (Android 12+); `enabled = false` turns that off again.
    Function("setAutoPip") { enabled: Boolean, w: Int, h: Int ->
      val activity = appContext.currentActivity ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      try {
        activity.setPictureInPictureParams(params(w, h, enabled))
        true
      } catch (e: Exception) {
        false
      }
    }

    // The button: shrink into the small window now.
    Function("enterPip") { w: Int, h: Int ->
      val activity = appContext.currentActivity ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return@Function false
      try {
        activity.enterPictureInPictureMode(params(w, h, true))
      } catch (e: Exception) {
        false
      }
    }
  }
}
