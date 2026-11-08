package expo.modules.cinemanative

import android.app.Activity
import android.app.Application
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import java.lang.ref.WeakReference
import java.util.Collections
import java.util.WeakHashMap

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
// A script that runs INSIDE the YouTube player's iframe, before the player's own code:
//  1. the page always says it is visible - so YouTube does not pause the video when the
//     screen locks (no more blip of sound);
//  2. on a message {cinema:'hideControls', on:true|false} from our page, YouTube's own
//     controls (its big play button among them) are hidden or shown again - the system
//     window has its own buttons, and two sets on top of each other looked bad.
private const val FRAME_SCRIPT = """
(function(){
  try {
    Object.defineProperty(document,'hidden',{get:function(){return false;},configurable:true});
    Object.defineProperty(document,'visibilityState',{get:function(){return 'visible';},configurable:true});
    document.addEventListener('visibilitychange',function(e){e.stopImmediatePropagation();},true);
    var st=document.createElement('style');
    var CSS='.ytp-chrome-top,.ytp-chrome-bottom,.ytp-gradient-top,.ytp-gradient-bottom,.ytp-large-play-button,.ytp-pause-overlay,.ytp-cued-thumbnail-overlay,.ytp-ce-element,.ytp-endscreen-content,.ytp-watermark,.ytp-youtube-button,.ytp-spinner{display:none!important}';
    window.addEventListener('message',function(e){
      var d=e.data;
      try{ if(typeof d==='string') d=JSON.parse(d); }catch(_){ return; }
      if(d&&d.cinema==='hideControls'){ st.textContent=d.on?CSS:''; }
    });
    var add=function(){ (document.head||document.documentElement).appendChild(st); };
    if(document.head) add(); else document.addEventListener('DOMContentLoaded',add);
  } catch(e) {}
})();
"""

object WebHost {
  private val handler = Handler(Looper.getMainLooper())
  @Volatile private var activity: WeakReference<Activity>? = null
  private val withScript: MutableSet<WebView> = Collections.newSetFromMap(WeakHashMap<WebView, Boolean>())
  private var lastScan = 0L

  // Puts FRAME_SCRIPT into every player WebView not yet given it. A WebView that is
  // created and loads in the same moment may miss it for its first page; the next ones have it.
  private fun installScripts() {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return
    for (w in webViews()) {
      if (withScript.contains(w)) continue
      try {
        WebViewCompat.addDocumentStartJavaScript(w, FRAME_SCRIPT, setOf("https://www.youtube-nocookie.com"))
        withScript.add(w)
      } catch (e: Exception) {
      }
    }
  }

  private val layoutListener = android.view.ViewTreeObserver.OnGlobalLayoutListener {
    val now = System.currentTimeMillis()
    if (now - lastScan > 400) {
      lastScan = now
      installScripts()
    }
  }
  private var listenedOn: WeakReference<View>? = null

  private fun listen(a: Activity) {
    val root = a.window?.decorView ?: return
    if (listenedOn?.get() === root) return
    listenedOn?.get()?.viewTreeObserver?.takeIf { it.isAlive }?.removeOnGlobalLayoutListener(layoutListener)
    root.viewTreeObserver.addOnGlobalLayoutListener(layoutListener)
    listenedOn = WeakReference(root)
  }

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
    override fun onActivityResumed(a: Activity) { activity = WeakReference(a); listen(a) }
    override fun onActivityPaused(a: Activity) {}
    override fun onActivityStopped(a: Activity) { keepAlive() }
    override fun onActivitySaveInstanceState(a: Activity, s: Bundle) {}
    override fun onActivityDestroyed(a: Activity) {}
  }

  @JvmStatic
  fun attach(app: Application?, current: Activity?) {
    if (current != null) {
      activity = WeakReference(current)
      handler.post { listen(current) }
    }
    app?.registerActivityLifecycleCallbacks(callbacks)
  }

  @JvmStatic
  fun detach(app: Application?) {
    app?.unregisterActivityLifecycleCallbacks(callbacks)
  }
}
