import { useEffect, useRef } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { webEval } from '@/utils/cinemaNative';
import { getVideoEmbedInfo, youtubeCommand, youtubeEmbedAt } from '@/utils/videoEmbed';

// Where a timecode in a note sends the player: `t` seconds, and `n` a
// counter, so tapping the same "04:32" twice seeks twice.
export type VideoSeek = { t: number; n: number };

// What a screen can ask of the playing video from outside (the buttons of
// the system's small window, which cannot touch the page itself).
export type VideoControl = { play(): void; pause(): void; seekTo(seconds: number): void };

// Navigating a WebView straight to youtube.com/embed/<id> reliably fails
// on-device with YouTube's own "Помилка 153" (player configuration error) -
// the IFrame player checks the page's origin/referrer, and a bare top-level
// WebView navigation supplies none. Wrapping the same embed URL in a tiny
// local HTML page (an actual <iframe>, not a direct navigation) gives it a
// real page context to check against and is the standard fix for this
// exact React Native + YouTube WebView failure.
// The player's own time, reported out: once the iframe has loaded, the page
// tells it "listening" (the IFrame API's handshake) and it answers with
// infoDelivery messages carrying currentTime, which are passed on to the
// app - what a frame taken from the video is stamped with.
const TIME_BRIDGE = `<script>
(function(){
  var f=document.querySelector('iframe');
  function listen(){try{f.contentWindow.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}),'*');}catch(e){}}
  f.addEventListener('load',function(){listen();setTimeout(listen,800);setTimeout(listen,2000);});
  window.addEventListener('message',function(e){
    try{var d=typeof e.data==='string'?JSON.parse(e.data):e.data;
      if(!d||!window.ReactNativeWebView)return;
      var o={};
      if(d.info&&typeof d.info==='object'){
        if(typeof d.info.currentTime==='number')o.t=d.info.currentTime;
        if(typeof d.info.playerState==='number')o.s=d.info.playerState;
      }
      if(d.event==='onStateChange'&&typeof d.info==='number')o.s=d.info;
      if('t' in o||'s' in o)window.ReactNativeWebView.postMessage(JSON.stringify(o));
    }catch(err){}
  });
})();
</script>`;

function htmlForYouTube(embedUrl: string): string {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" /><style>html,body{margin:0;padding:0;background:#000;height:100%;}iframe{position:fixed;top:0;left:0;width:100%;height:100%;border:0;}</style></head><body><iframe src="${embedUrl}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>${TIME_BRIDGE}</body></html>`;
}

// The player itself, with no window around it: it fills whatever box it
// is put in. A card plays one in place of its own thumbnail, and
// VideoPlayerModal is the same thing on a black full-screen backdrop -
// one copy of the WebView's hard-won configuration, not two.
//
// Only ever ONE of these should be mounted per screen: every instance is
// a live WebView with a player in it, and a list that mounted one per
// card would be running as many video players as there are rows. The
// screens that use it hold a single "which card is playing" id.
export default function InlineVideoPlayer({
  url,
  start,
  seek,
  onTime,
  nudge,
  controlRef,
  onState,
}: {
  url: string;
  start?: number;
  seek?: VideoSeek;
  // Where the video is now, in seconds (YouTube only) - as it plays.
  onTime?: (seconds: number) => void;
  // A counter: each change makes the page redraw itself and carry on
  // playing. Used when the system's small window opens or closes - the
  // video's own layer can stop being drawn there (black picture, sound
  // still going).
  nudge?: number;
  controlRef?: { current: VideoControl | null };
  // true = playing, false = paused / ended / not started (YouTube only).
  onState?: (playing: boolean) => void;
}) {
  const info = getVideoEmbedInfo(url);
  const webRef = useRef<WebView>(null);
  // The first seek is the `start` the player was mounted with; every later
  // one is a command into the player's iframe (see youtubeEmbedAt).
  const firstSeek = useRef(seek?.n);
  useEffect(() => {
    if (!seek || seek.n === firstSeek.current) return;
    const post = (cmd: string) => `document.querySelector('iframe').contentWindow.postMessage(${JSON.stringify(cmd)}, '*');`;
    webRef.current?.injectJavaScript(`${post(youtubeCommand('seekTo', [seek.t, true]))}${post(youtubeCommand('playVideo'))}true;`);
  }, [seek]);
  useEffect(() => {
    if (!controlRef) return;
    const post = (cmd: string) => {
      const script = `document.querySelector('iframe').contentWindow.postMessage(${JSON.stringify(cmd)}, '*');true;`;
      // Straight into the WebView where the APK can (works with the app in the
      // small window / the screen locked), otherwise through the bridge.
      if (!webEval(script)) webRef.current?.injectJavaScript(script);
    };
    controlRef.current = {
      play: () => post(youtubeCommand('playVideo')),
      pause: () => post(youtubeCommand('pauseVideo')),
      seekTo: (t) => post(youtubeCommand('seekTo', [Math.max(0, t), true])),
    };
    return () => {
      controlRef.current = null;
    };
  }, [controlRef]);

  useEffect(() => {
    if (!nudge) return;
    const redraw = `(function(){var f=document.querySelector('iframe');if(!f)return;f.style.transform='translateZ(0)';f.style.willChange='transform';var w=f.style.width;f.style.width='99.9%';window.dispatchEvent(new Event('resize'));setTimeout(function(){f.style.width=w||'100%';window.dispatchEvent(new Event('resize'));},60);f.contentWindow.postMessage(${JSON.stringify(youtubeCommand('playVideo'))},'*');})();true;`;
    const timers = [150, 600, 1500].map((ms) => setTimeout(() => webRef.current?.injectJavaScript(redraw), ms));
    return () => timers.forEach(clearTimeout);
  }, [nudge]);
  // Kept as it was mounted: a new `start` must not reload the player.
  const startRef = useRef(start);
  if (!info) return null;
  return (
    <WebView
      ref={webRef}
      source={
        info.provider === 'youtube'
          ? // `baseUrl` is the other half of the Error 153 fix: it makes
            // the WebView report a real https origin for this local
            // HTML page instead of `about:blank`, which is what the
            // IFrame player's origin check was actually rejecting -
            // wrapping the embed in an <iframe> alone wasn't enough.
            { html: htmlForYouTube(youtubeEmbedAt(info.embedUrl, startRef.current)), baseUrl: 'https://www.youtube-nocookie.com' }
          : { uri: info.embedUrl }
      }
      style={styles.webview}
      originWhitelist={['*']}
      javaScriptEnabled
      domStorageEnabled
      // TikTok's embed page tries to deep-link into the native TikTok
      // app via an `intent://`/`snssdk...://` URL on Android - a bare
      // WebView can't resolve that scheme at all and throws
      // net::ERR_UNKNOWN_URL_SCHEME (Error Code -10), which looked
      // like the whole player crashing. Blocking navigation to
      // anything that isn't plain http(s) keeps the WebView on the
      // embed page instead of trying (and failing) to hand off to an
      // app - exactly what "play it in this app" is supposed to mean.
      onShouldStartLoadWithRequest={(request) => /^https?:\/\//i.test(request.url)}
      onMessage={(event) => {
        try {
          const data = JSON.parse(event.nativeEvent.data) as { t?: number; s?: number };
          if (typeof data.t === 'number') onTime?.(data.t);
          // YouTube's states: 1 playing, 3 buffering (counts as playing); 0 ended, 2 paused, -1/5 not started.
          if (typeof data.s === 'number') onState?.(data.s === 1 || data.s === 3);
        } catch {
          // Not ours.
        }
      }}
      // The video drawn through a hardware layer - the usual fix for a
      // WebView video that goes black when its window changes shape.
      androidLayerType="hardware"
      // Lets the developer look inside the page from the Mac (adb + devtools).
      webviewDebuggingEnabled
      allowsFullscreenVideo
      mediaPlaybackRequiresUserAction={false}
      renderLoading={() => (
        <View style={styles.loading}>
          <ActivityIndicator color="#fff" />
        </View>
      )}
      startInLoadingState
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
});
