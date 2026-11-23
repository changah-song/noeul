import { memo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

// A song's cover on the shelf: the still of the song's YouTube video, cut to a
// square. Most songs are matched to the "Topic" (audio) upload, whose picture
// is the album cover in the middle of a 16:9 frame, so the square is the album
// art. YouTube's hqdefault still is 480×360 with the 16:9 picture letterboxed
// in it (480×270), so the image is drawn larger than the square and centred.
// Until the song has a video (it's looked up the first time the song is
// opened), or if the still fails to load, `fallback` is shown instead.

export const songCoverUrl = (song) => (
    typeof song?.video?.id === 'string' && song.video.id
        ? `https://i.ytimg.com/vi/${encodeURIComponent(song.video.id)}/hqdefault.jpg`
        : null
);

const SongCover = ({ song, size = 48, radius = 10, style, fallback = null }) => {
    const uri = songCoverUrl(song);
    const [failedUri, setFailedUri] = useState(null);
    if (!uri || failedUri === uri) return fallback;

    const width = (size * 16) / 9;
    const height = (size * 4) / 3;
    return (
        <View style={[styles.frame, { width: size, height: size, borderRadius: radius }, style]}>
            <Image
                source={{ uri }}
                style={{
                    width,
                    height,
                    marginLeft: -(width - size) / 2,
                    marginTop: -(height - size) / 2,
                }}
                onError={() => setFailedUri(uri)}
                accessibilityIgnoresInvertColors
            />
        </View>
    );
};

const styles = StyleSheet.create({
    frame: {
        overflow: 'hidden',
        backgroundColor: '#000',
    },
});

export default memo(SongCover);
