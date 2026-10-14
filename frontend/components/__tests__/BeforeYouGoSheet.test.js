import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { TextInput, TouchableOpacity } from 'react-native';

// The note sheet must stay open (keeping the typed note) when saving fails,
// and must not save twice on a double tap.

jest.mock('../../hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key) => key }),
}));

const BeforeYouGoSheet = require('../Read/BeforeYouGoSheet').default;

const colors = new Proxy({}, { get: () => '#000000' });

const render = async (props) => {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <BeforeYouGoSheet visible colors={colors} insets={{ bottom: 0 }} {...props} />
    );
  });
  return tree;
};

const typeNote = async (tree, text) => {
  await act(async () => { tree.root.findByType(TextInput).props.onChangeText(text); });
};

const saveButton = (tree) => tree.root.findAllByType(TouchableOpacity)
  .find((node) => node.findAll((n) => n.props.children === 'common.save').length > 0);

const hasText = (tree, text) => tree.root.findAll((n) => n.props.children === text).length > 0;

describe('BeforeYouGoSheet', () => {
  it('closes after a successful save', async () => {
    const onSaveNote = jest.fn(() => Promise.resolve({ id: 'n1' }));
    const onClose = jest.fn();
    const tree = await render({ onSaveNote, onClose });
    await typeNote(tree, '  remember this  ');
    await act(async () => { await saveButton(tree).props.onPress(); });
    expect(onSaveNote).toHaveBeenCalledWith('remember this');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays open with the note and shows an error when saving fails', async () => {
    const onSaveNote = jest.fn(() => Promise.resolve(null));
    const onClose = jest.fn();
    const tree = await render({ onSaveNote, onClose });
    await typeNote(tree, 'keep me');
    await act(async () => { await saveButton(tree).props.onPress(); });
    expect(onClose).not.toHaveBeenCalled();
    expect(tree.root.findByType(TextInput).props.value).toBe('keep me');
    expect(hasText(tree, 'lookup.saveFailed')).toBe(true);
  });

  it('treats a thrown save as a failure', async () => {
    const onSaveNote = jest.fn(() => Promise.reject(new Error('db')));
    const onClose = jest.fn();
    const tree = await render({ onSaveNote, onClose });
    await typeNote(tree, 'keep me');
    await act(async () => { await saveButton(tree).props.onPress(); });
    expect(onClose).not.toHaveBeenCalled();
    expect(hasText(tree, 'lookup.saveFailed')).toBe(true);
  });

  it('ignores a second tap while saving', async () => {
    let resolveSave;
    const onSaveNote = jest.fn(() => new Promise((resolve) => { resolveSave = resolve; }));
    const onClose = jest.fn();
    const tree = await render({ onSaveNote, onClose });
    await typeNote(tree, 'once');
    const { onPress } = saveButton(tree).props;
    let first;
    await act(async () => {
      first = onPress();
      onPress();
    });
    expect(onSaveNote).toHaveBeenCalledTimes(1);
    expect(saveButton(tree).props.disabled).toBe(true);
    await act(async () => { resolveSave({ id: 'n1' }); await first; });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
