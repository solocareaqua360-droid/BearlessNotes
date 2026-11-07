package expo.modules.cinemanative

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.IBinder

// The player in the background: while a video plays, this foreground
// service keeps the app alive with the screen off, and draws the media
// notification (lock screen included) with the same three buttons as the
// small window: back 10 s, play/pause, forward 10 s. The buttons and the
// headset's keys all come back to JS as the same actions (see
// CinemaNativeModule's `onPipAction` event).
object CinemaMedia {
  private const val CHANNEL = "cinema_playback"
  const val NOTIFICATION_ID = 4711

  @Volatile var running: Boolean = false
  @Volatile var sendAction: ((String) -> Unit)? = null
  private var session: MediaSession? = null

  private fun ensureSession(context: Context): MediaSession {
    session?.let { return it }
    val s = MediaSession(context.applicationContext, "CinemaPlayback")
    s.setCallback(object : MediaSession.Callback() {
      override fun onPlay() { sendAction?.invoke("play") }
      override fun onPause() { sendAction?.invoke("pause") }
      override fun onSkipToNext() { sendAction?.invoke("fwd") }
      override fun onFastForward() { sendAction?.invoke("fwd") }
      override fun onSkipToPrevious() { sendAction?.invoke("back") }
      override fun onRewind() { sendAction?.invoke("back") }
    })
    s.isActive = true
    session = s
    return s
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val nm = context.getSystemService(NotificationManager::class.java)
    if (nm.getNotificationChannel(CHANNEL) == null) {
      val ch = NotificationChannel(CHANNEL, "Відтворення", NotificationManager.IMPORTANCE_LOW)
      ch.setShowBadge(false)
      nm.createNotificationChannel(ch)
    }
  }

  private fun button(context: Context, icon: Int, title: String, name: String, code: Int): Notification.Action {
    val intent = Intent(name).setPackage(context.packageName)
    val pending = PendingIntent.getBroadcast(context, code, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    return Notification.Action.Builder(Icon.createWithResource(context, icon), title, pending).build()
  }

  fun build(context: Context, title: String, playing: Boolean): Notification {
    ensureChannel(context)
    val s = ensureSession(context)
    s.setMetadata(MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title).build())
    s.setPlaybackState(
      PlaybackState.Builder()
        .setActions(
          PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
            PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS or
            PlaybackState.ACTION_FAST_FORWARD or PlaybackState.ACTION_REWIND
        )
        .setState(
          if (playing) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
          PlaybackState.PLAYBACK_POSITION_UNKNOWN,
          1f
        )
        .build()
    )
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val openPending = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
    return builder
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setContentTitle(title)
      .setContentIntent(openPending)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setOngoing(playing)
      .setOnlyAlertOnce(true)
      .addAction(button(context, android.R.drawable.ic_media_rew, "-10 с", PipState.ACTION_BACK, 11))
      .addAction(
        button(
          context,
          if (playing) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
          if (playing) "Пауза" else "Грати",
          PipState.ACTION_TOGGLE,
          12
        )
      )
      .addAction(button(context, android.R.drawable.ic_media_ff, "+10 с", PipState.ACTION_FWD, 13))
      .setStyle(Notification.MediaStyle().setMediaSession(s.sessionToken).setShowActionsInCompactView(0, 1, 2))
      .build()
  }

  fun release() {
    session?.release()
    session = null
  }
}

class MediaPlaybackService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra("title") ?: "Cinema"
    val playing = intent?.getBooleanExtra("playing", true) ?: true
    val n = CinemaMedia.build(this, title, playing)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(CinemaMedia.NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
    } else {
      startForeground(CinemaMedia.NOTIFICATION_ID, n)
    }
    CinemaMedia.running = true
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    CinemaMedia.running = false
    CinemaMedia.release()
    super.onDestroy()
  }
}
