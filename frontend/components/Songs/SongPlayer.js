import { forwardRef, memo, useCallback, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// The song's YouTube video, played with YouTube's own embedded player (the
// IFrame Player API) inside a WebView. It reports the time while playing so
// the song reader can light the line being sung, and takes play / pause /
// seek / speed commands through the ref.
//
// The page is served as if from noeul.app: YouTube refuses embeds that come
// with no web origin (errors 152/153), and the origin has to be a real https
// site. YouTube's terms want the video visible while it plays, so this is a
// view on screen, never hidden audio.

const PLAYER_ORIGIN = 'https://noeul.app';
const TIME_TICK_MS = 250;

const playerHtml = (videoId, startSeconds) => `<!DOCTYPE html>
<html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}#player{position:absolute;inset:0;width:100%;height:100%}</style>
</head><body>
<div id="player"></div>
<script>
  var post = function (msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); };
  var player = null;
  var timer = null;
  var tick = function () {
    if (!player || !player.getCurrentTime) return;
    post({ type: 'time', time: player.getCurrentTime() });
  };
  window.noeulCommand = function (cmd) {
    if (!player) return;
    try {
      if (cmd.type === 'play') player.playVideo();
      else if (cmd.type === 'pause') player.pauseVideo();
      else if (cmd.type === 'seek') { player.seekTo(cmd.time, true); tick(); }
      else if (cmd.type === 'rate') player.setPlaybackRate(cmd.rate);

    } catch (e) { post({ type: 'error', code: 'command' }); }
  };
  window.onYouTubeIframeAPIReady = function () {
    player = new YT.Player('player', {
      videoId: ${JSON.stringify(videoId)},
      host: 'https://www.youtube.com',
      playerVars: {
        playsinline: 1, rel: 0, modestbranding: 1, fs: 0,
        start: ${Math.max(0, Math.floor(startSeconds || 0))},
        origin: ${JSON.stringify(PLAYER_ORIGIN)}
      },
      events: {
        onReady: function () {
          post({ type: 'ready', duration: player.getDuration(), rates: player.getAvailablePlaybackRates() });
        },
        onStateChange: function (event) {
          post({ type: 'state', state: event.data });
          clearInterval(timer);
          if (event.data === YT.PlayerState.PLAYING) timer = setInterval(tick, ${TIME_TICK_MS});
          tick();
        },
        onPlaybackRateChange: function (event) { post({ type: 'rate', rate: event.data }); },
        onError: function (event) { post({ type: 'error', code: event.data }); }
      }
    });
  };
</script>
<script src="https://www.youtube.com/iframe_api"></script>
</body></html>`;

// YT.PlayerState: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued.
export const PLAYER_STATE = { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 };

const SongPlayer = forwardRef(({ videoId, startSeconds = 0, onReady, onTime, onStateChange, onRateChange, onError, style }, ref) => {
    const webViewRef = useRef(null);
    // The page is built once per video; later commands go through the ref.
    const source = useMemo(
        () => ({ html: playerHtml(videoId, startSeconds), baseUrl: PLAYER_ORIGIN }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [videoId]
    );

    const send = useCallback((command) => {
        webViewRef.current?.injectJavaScript(`window.noeulCommand(${JSON.stringify(command)}); true;`);
    }, []);

    useImperativeHandle(ref, () => ({
        play: () => send({ type: 'play' }),
        pause: () => send({ type: 'pause' }),
        seek: (time) => send({ type: 'seek', time: Math.max(0, Number(time) || 0) }),
        setRate: (rate) => send({ type: 'rate', rate }),
    }), [send]);

    const handleMessage = useCallback((event) => {
        let message;
        try {
            message = JSON.parse(event?.nativeEvent?.data || '{}');
        } catch (_error) {
            return;
        }
        if (message.type === 'time') onTime?.(Number(message.time) || 0);
        else if (message.type === 'ready') onReady?.(message);
        else if (message.type === 'state') onStateChange?.(message.state);
        else if (message.type === 'rate') onRateChange?.(message.rate);
        else if (message.type === 'error') onError?.(message.code);
    }, [onError, onRateChange, onReady, onStateChange, onTime]);

    return (
        <View style={[styles.frame, style]}>
            <WebView
                ref={webViewRef}
                source={source}
                originWhitelist={['*']}
                style={styles.webView}
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                allowsFullscreenVideo={false}
                scrollEnabled={false}
                bounces={false}
                onMessage={handleMessage}
                // Links in the player (the YouTube logo, the title) would load
                // youtube.com inside this small view; keep the player page.
                onShouldStartLoadWithRequest={(request) => (
                    request.url.startsWith(PLAYER_ORIGIN)
                    || request.url.startsWith('about:')
                    || request.url.includes('youtube.com/embed')
                    || !request.isTopFrame
                )}
            />
        </View>
    );
});
SongPlayer.displayName = 'SongPlayer';

const styles = StyleSheet.create({
    frame: {
        aspectRatio: 16 / 9,
        width: '100%',
        backgroundColor: '#000',
        overflow: 'hidden',
    },
    webView: {
        flex: 1,
        backgroundColor: '#000',
    },
});

export default memo(SongPlayer);
