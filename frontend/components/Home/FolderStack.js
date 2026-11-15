import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

// A folder on the shelf, drawn as its books in a pile: the newest cover in
// front at the bottom-left, up to two more behind it, each stepped up and to
// the right so its top and side edge show.
//
// `renderCover(book, width, height)` draws one cover, so the pile uses the same
// covers as the rest of the shelf. An empty folder shows a dashed outline.

const MAX_COVERS = 3;
// Each cover behind the front one moves this much of the tile, per layer.
const STEP = 0.1;

const FolderStack = ({ books = [], width, height, renderCover, edgeColor, emptyColor }) => {
    const shown = books.slice(0, MAX_COVERS);

    if (shown.length === 0) {
        return (
            <View style={[styles.empty, { width, height, borderColor: emptyColor }]}>
                <Feather name="folder" size={Math.max(14, Math.round(width * 0.28))} color={emptyColor} />
            </View>
        );
    }

    // The covers always leave room for a full pile, so a folder keeps its size
    // as books are added.
    const inset = STEP * (MAX_COVERS - 1);
    const coverWidth = Math.round(width * (1 - inset));
    const coverHeight = Math.round(height * (1 - inset));
    const stepX = (width - coverWidth) / (MAX_COVERS - 1);
    const stepY = (height - coverHeight) / (MAX_COVERS - 1);

    return (
        <View style={{ width, height }}>
            {shown
                .map((book, layer) => ({ book, layer }))
                // Back covers first, so the front one is drawn on top.
                .reverse()
                .map(({ book, layer }) => (
                    <View
                        key={book.uri || book.id || `${book.title}-${layer}`}
                        style={[
                            styles.cover,
                            {
                                left: Math.round(layer * stepX),
                                top: Math.round(height - coverHeight - (layer * stepY)),
                                width: coverWidth,
                                height: coverHeight,
                                // A hairline in the page colour keeps one cover's
                                // edge apart from the cover behind it.
                                borderColor: edgeColor,
                            },
                        ]}
                    >
                        {renderCover(book, coverWidth, coverHeight)}
                    </View>
                ))}
        </View>
    );
};

const styles = StyleSheet.create({
    cover: {
        position: 'absolute',
        borderRadius: 2,
        borderRightWidth: StyleSheet.hairlineWidth,
        borderTopWidth: StyleSheet.hairlineWidth,
        overflow: 'hidden',
    },
    empty: {
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderStyle: 'dashed',
        borderRadius: 3,
    },
});

export default FolderStack;
