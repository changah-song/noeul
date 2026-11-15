import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Render test for the reader's contents list: a long list folds (a Bible's
// books, with the chapters of the one being read open), a shut entry opens on
// a tap and goes to its page on the next, and a short list stays fully open.

jest.mock('@expo/vector-icons', () => {
  const icon = () => null;
  return { Feather: icon, MaterialIcons: icon, MaterialCommunityIcons: icon };
}, { virtual: true });
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));
jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => ({ interfaceLanguage: 'en', isDarkMode: false }),
}));

jest.setTimeout(30000);
const TocDrawer = require('../Read/TocDrawer').default;

// `books` books of `chapters` chapters each, one file per entry.
const bible = (books, chapters) => {
  const toc = [];
  let spineIndex = 0;
  for (let book = 1; book <= books; book += 1) {
    toc.push({ id: `b${book}`, title: `Book ${book}`, spineIndex, depth: 0 });
    spineIndex += 1;
    for (let chapter = 1; chapter <= chapters; chapter += 1) {
      toc.push({ id: `b${book}c${chapter}`, title: `Book ${book} ${chapter}`, spineIndex, depth: 1 });
      spineIndex += 1;
    }
  }
  return toc;
};

const { Text } = require('react-native');
const isRow = (node) => (
  typeof node.type !== 'string'
  && node.props.accessibilityRole === 'button'
  && node.props.accessibilityState
  && 'selected' in node.props.accessibilityState
);
const titleOf = (node) => node.findAllByType(Text)[0]?.props.children;
// A pressable shows up once per wrapper layer: each title is counted once.
const rowTitles = (tree) => [...new Set(tree.root.findAll(isRow).map(titleOf).filter(Boolean))];

const rowFor = (tree, title) => tree.root.findAll((node) => isRow(node) && titleOf(node) === title)[0];

const mount = (props) => {
  let tree;
  act(() => {
    tree = renderer.create(
      <TocDrawer visible totalSpineItems={100} onClose={() => {}} onSelect={() => {}} {...props} />
    );
  });
  return tree;
};

describe('TocDrawer', () => {
  it('folds a long list to its top level, with the branch being read open', () => {
    const toc = bible(10, 5);
    // Reading Book 2, chapter 3 (spine 6 + 1 + 3 - 1 = 9).
    const tree = mount({ toc, currentSpineIndex: 9 });
    const titles = rowTitles(tree);
    expect(titles).toContain('Book 1');
    expect(titles).toContain('Book 10');
    expect(titles).toContain('Book 2 3');
    expect(titles).not.toContain('Book 1 1');
    expect(titles).toHaveLength(10 + 5);
    expect(rowFor(tree, 'Book 2 3').props.accessibilityState.selected).toBe(true);
  });

  it('opens a shut entry on the first tap and goes to it on the second', () => {
    const onSelect = jest.fn();
    const tree = mount({ toc: bible(10, 5), currentSpineIndex: 9, onSelect });

    act(() => rowFor(tree, 'Book 4').props.onPress());
    expect(onSelect).not.toHaveBeenCalled();
    expect(rowTitles(tree)).toContain('Book 4 1');

    act(() => rowFor(tree, 'Book 4 2').props.onPress());
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b4c2' }));

    act(() => rowFor(tree, 'Book 4').props.onPress());
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b4' }));
  });

  it('keeps a short list fully open', () => {
    const tree = mount({ toc: bible(3, 4), currentSpineIndex: 0 });
    expect(rowTitles(tree)).toHaveLength(3 + 12);
  });
});
