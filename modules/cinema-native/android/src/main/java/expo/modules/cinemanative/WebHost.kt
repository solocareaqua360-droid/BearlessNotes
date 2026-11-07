package expo.modules.cinemanative

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import java.lang.ref.WeakReference

// The player's WebView, reached from native code - for two things React
// Native's own bridge cannot do while the app is in the small window or the
// screen is locked:
//  1. `eval`: run a script in the page right away (React Native queues its
//     own view commands until the next frame, which never comes then) -
//     this is how the window's and the notification's buttons reach the video;
//  2. `keepAlive`: when the app stops (screen lock, Home) the system tells
//     the WebView its window is gone, the page believes it is hidden and
//     YouTube pauses. While a video plays, the WebView is told again that
//     its window is visible, so the sound keeps going.
object WebHost {
  private val handler = Handler(Looper.getMainLooper())
  @Volatile private var activity: WeakReference<Activity>? = null

  private fun collect(view: View, out: MutableList<WebView>) {
    if (view is WebView) out.add(view)
    if (view is ViewGroup) for (i in 0 until view.childCount) collect(view.getChildAt(i), out)
  }

  private fun webViews(): List<WebView> {
    val act = activity?.get() ?: return emptyList()
    val out = ArrayList<WebView>()
    collect(act.window.decorView, out)
    return out
  }

  @JvmStatic
  fun eval(script: String, fallback: Activity?): Boolean {
    if (activity?.get() == null && fallback != null) activity = WeakReference(fallback)
    if (activity?.get() == null) return false
    handler.post {
      for (w in webViews()) {
        try {
          w.evaluateJavascript(script, null)
        } catch (e: Exception) {
        }
      }
    }
    return true
  }

  private fun keepAlive() {
    if (!PipState.armed && !CinemaMedia.running) return
    for (delay in longArrayOf(50, 400, 1500, 4000)) {
      handler.postDelayed({
        if (!PipState.armed && !CinemaMedia.running) return@postDelayed
        for (w in webViews()) {
          try {
            w.dispatchWindowVisibilityChanged(View.VISIBLE)
          } catch (e: Exception) {
          }
        }
      }, delay)
    }
  }

  private val callbacks = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(a: Activity, s: Bundle?) { activity = WeakReference(a) }
    override fun onActivityStarted(a: Activity) { activity = WeakReference(a) }
    override fun onActivityResumed(a: Activity) { activity = WeakReference(a) }
    override fun onActivityPaused(a: Activity) {}
    override fun onActivityStopped(a: Activity) { keepAlive() }
    override fun onActivitySaveInstanceState(a: Activity, s: Bundle) {}
    override fun onActivityDestroyed(a: Activity) {}
  }

  @JvmStatic
  fun attach(app: Application?, current: Activity?) {
    if (current != null) activity = WeakReference(current)
    app?.registerActivityLifecycleCallbacks(callbacks)
  }

  @JvmStatic
  fun detach(app: Application?) {
    app?.unregisterActivityLifecycleCallbacks(callbacks)
  }
}
