// Controls the first-book tutorial lights that live deep inside other
// components (the lookup panel's save button), so their refs need not be
// threaded through every layer. A component attaches `tutorialTargetRef(id)`
// as a ref; the tutorial measures it with `measureTutorialTarget(id)`.
const nodes = new Map();
const refs = new Map();

export const tutorialTargetRef = (id) => {
    if (!refs.has(id)) {
        let mine = null;
        refs.set(id, (node) => {
            if (node) {
                mine = node;
                nodes.set(id, node);
            } else if (nodes.get(id) === mine) {
                nodes.delete(id);
                mine = null;
            }
        });
    }
    return refs.get(id);
};

// The rect of a view in window dp ({ x, y, width, height }), or null.
export const measureInWindow = (node) => new Promise((resolve) => {
    if (!node?.measureInWindow) {
        resolve(null);
        return;
    }
    node.measureInWindow((x, y, width, height) => {
        resolve(Number.isFinite(x) && width > 0 && height > 0 ? { x, y, width, height } : null);
    });
});

export const measureTutorialTarget = (id) => measureInWindow(nodes.get(id));
