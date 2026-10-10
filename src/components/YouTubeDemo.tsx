import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import {
  YOUTUBE_PLAYER_BASE_URL,
  buildYouTubePlayerHtml,
  parseYouTubePlayerMessage,
  type YouTubePlayerFailure,
} from '@/domain/youtubePlayer';

type YouTubeDemoProps = {
  videoId: string;
  onReady: () => void;
  onFailure: (failure: YouTubePlayerFailure) => void;
};

/**
 * On-demand inline YouTube playback. The detail screen mounts this only after
 * an explicit tap, so opening an exercise makes no YouTube request. The page is
 * served with an https base URL so YouTube sees a real embedder origin; the app
 * has no video download/cache path.
 */
export default function YouTubeDemo({ videoId, onReady, onFailure }: YouTubeDemoProps) {
  return (
    <WebView
      style={styles.player}
      source={{ html: buildYouTubePlayerHtml(videoId), baseUrl: YOUTUBE_PLAYER_BASE_URL }}
      originWhitelist={['https://*', 'about:blank']}
      javaScriptEnabled
      allowsInlineMediaPlayback
      allowsFullscreenVideo
      mediaPlaybackRequiresUserAction
      setSupportMultipleWindows={false}
      scrollEnabled={false}
      onShouldStartLoadWithRequest={(request) =>
        request.isTopFrame === false ||
        request.url === 'about:blank' ||
        request.url.startsWith(YOUTUBE_PLAYER_BASE_URL)
      }
      onMessage={(event) => {
        const message = parseYouTubePlayerMessage(event.nativeEvent.data);
        if (message?.kind === 'ready') onReady();
        else if (message?.kind === 'failed') onFailure(message.failure);
      }}
      onError={(event) =>
        onFailure({ cause: 'webview-error', detail: event.nativeEvent.description })
      }
      onHttpError={(event) =>
        onFailure({ cause: 'webview-error', detail: `HTTP ${event.nativeEvent.statusCode}` })
      }
    />
  );
}

const styles = StyleSheet.create({
  player: {
    flex: 1,
    backgroundColor: '#000000',
  },
});
