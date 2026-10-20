import React from 'react';
import renderer, { act } from 'react-test-renderer';

// Render test for the reader settings bottom sheet: the tab strip switches the
// rows on show, toggles report changes with the reader's setting keys, scope
// rows only appear under an enabled parent, and per-tab reset calls the right
// handler. Mocking style follows SongReader.test.js.

jest.mock('@expo/vector-icons', () => {
  const icon = () => null;
  return { Feather: icon, MaterialIcons: icon, MaterialCommunityIcons: icon };
}, { virtual: true });
jest.mock('react-native-elements', () => ({ Slider: () => null }), { virtual: true });
jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => ({ interfaceLanguage: 'en', isDarkMode: false }),
}));

require('react-native').Platform.OS = 'android';

// The first render of the sheet compiles the whole component tree through
// Babel; on a loaded CI runner that alone can pass Jest's 5 s default.
jest.setTimeout(30000);
const ReaderSettingsSheet = require('../Read/ReaderSettingsSheet').default;
const { createTheme } = require('../../theme/tokens');

const colors = createTheme(false);
const insets = { top: 24, bottom: 16, left: 0, right: 0 };

const baseSettings = {
  fontSize: 18,
  lineSpacing: 2.05,
  brightness: 0.62,
  readingMode: 'paged',
  levelMarkStyle: 'underline',
  pinyinAnnotations: false,
  glossAnnotations: false,
  pinyinScope: 'underlined',
  glossScope: 'underlined',
  focusSwipe: false,
  focusSpan: 1,
};

const findByLabel = (tree, label) => tree.root.findAll(
  (node) => node.props.accessibilityLabel === label && typeof node.props.onPress === 'function'
);
const press = (tree, label) => act(async () => {
  findByLabel(tree, label)[0].props.onPress();
});
const pressTab = (tree, tab) => act(async () => {
  tree.root.findByProps({ testID: `reader-settings-tab-${tab}` }).props.onPress();
});
const text = (tree) => JSON.stringify(tree.toJSON());

const renderSheet = async (overrides = {}) => {
  const props = {
    visible: true,
    onClose: jest.fn(),
    colors,
    insets,
    title: 'Book settings',
    language: 'zh',
    settings: baseSettings,
    onSettingChange: jest.fn(),
    onResetTextSettings: jest.fn(),
    onResetWordSettings: jest.fn(),
    onResetFocusSettings: jest.fn(),
    actions: [{ key: 'checkpoints', label: 'Checkpoints', icon: null, onPress: jest.fn() }],
    ...overrides,
  };
  let tree;
  await act(async () => {
    tree = renderer.create(<ReaderSettingsSheet {...props} />);
  });
  return { tree, props };
};

describe('ReaderSettingsSheet', () => {
  it('opens on the Text tab with the actions row above the tabs', async () => {
    const { tree, props } = await renderSheet();
    const json = text(tree);
    expect(json).toContain('Book settings');
    expect(json).toContain('Checkpoints');
    expect(json).toContain('Font size');
    expect(json).toContain('Page turns');
    expect(json).toContain('Line spacing');
    expect(json).not.toContain('Difficulty underlines');
    expect(json).not.toContain('Move between sentences');

    await press(tree, 'Checkpoints');
    expect(props.actions[0].onPress).toHaveBeenCalled();
    await act(async () => tree.unmount());
  });

  it('switches tabs and shows each tab\'s rows', async () => {
    const { tree } = await renderSheet();

    await pressTab(tree, 'words');
    let json = text(tree);
    expect(json).toContain('Difficulty underlines');
    expect(json).toContain('Underline almost-known words too');
    expect(json).not.toContain('Fade marks');
    expect(json).toContain('Pinyin');
    expect(json).toContain('Translation under words');
    expect(json).not.toContain('Font size');
    expect(tree.root.findByProps({ testID: 'reader-settings-tab-words' }).props.accessibilityState).toEqual({ selected: true });

    await pressTab(tree, 'focus');
    json = text(tree);
    expect(json).toContain('Move between sentences');
    expect(json).toContain('Sentences at a time');
    expect(json).toContain('Swipe');
    expect(json).not.toContain('Difficulty underlines');
    await act(async () => tree.unmount());
  });

  it('reports toggles and steppers through onSettingChange with the reader keys', async () => {
    const { tree, props } = await renderSheet();

    await press(tree, 'Increase font size');
    expect(props.onSettingChange).toHaveBeenCalledWith('fontSize', 19);

    // Line spacing is a three-way segmented control.
    await press(tree, 'Tight');
    expect(props.onSettingChange).toHaveBeenCalledWith('lineSpacing', 1.65);
    await press(tree, 'Vertical');
    expect(props.onSettingChange).toHaveBeenCalledWith('readingMode', 'scroll');

    await pressTab(tree, 'words');
    const glossSwitch = findByLabel(tree, 'Translation under words')[0];
    expect(glossSwitch.props.accessibilityRole).toBe('switch');
    expect(glossSwitch.props.accessibilityState).toEqual({ checked: false });
    await press(tree, 'Translation under words');
    expect(props.onSettingChange).toHaveBeenCalledWith('glossAnnotations', true);

    await press(tree, 'Pinyin');
    expect(props.onSettingChange).toHaveBeenCalledWith('pinyinAnnotations', true);

    // The difficulty underline switch maps onto levelMarkStyle.
    const marksSwitch = findByLabel(tree, 'Difficulty underlines')[0];
    expect(marksSwitch.props.accessibilityState).toEqual({ checked: true });
    await press(tree, 'Difficulty underlines');
    expect(props.onSettingChange).toHaveBeenCalledWith('levelMarkStyle', 'off');

    await pressTab(tree, 'focus');
    await press(tree, 'Swipe');
    expect(props.onSettingChange).toHaveBeenCalledWith('focusSwipe', true);
    await press(tree, 'Longer focus span');
    expect(props.onSettingChange).toHaveBeenCalledWith('focusSpan', 2);
    await act(async () => tree.unmount());
  });

  it('shows the scope row only under an enabled annotation', async () => {
    const { tree } = await renderSheet({
      settings: { ...baseSettings, glossAnnotations: true, glossScope: 'all' },
    });
    await pressTab(tree, 'words');
    const scopeGroups = tree.root.findAll((node) => node.type === 'View' && node.props.accessibilityRole === 'radiogroup'
      && String(node.props.accessibilityLabel).endsWith('Show on'));
    expect(scopeGroups).toHaveLength(1);
    expect(scopeGroups[0].props.accessibilityLabel).toBe('Translation under words · Show on');
    expect(text(tree)).toContain('All words');
    await act(async () => tree.unmount());
  });

  it('hides pinyin for non-Chinese books and honours feature flags', async () => {
    const { tree } = await renderSheet({
      language: 'ko',
      features: { glossAnnotations: false },
    });
    await pressTab(tree, 'words');
    const json = text(tree);
    expect(json).toContain('Difficulty underlines');
    expect(json).not.toContain('Pinyin');
    expect(json).not.toContain('Translation under words');
    await act(async () => tree.unmount());
  });

  it('resets the active tab only', async () => {
    const { tree, props } = await renderSheet();
    await press(tree, 'Reset to default');
    expect(props.onResetTextSettings).toHaveBeenCalledTimes(1);
    expect(props.onResetWordSettings).not.toHaveBeenCalled();

    await pressTab(tree, 'words');
    await press(tree, 'Reset to default');
    expect(props.onResetWordSettings).toHaveBeenCalledTimes(1);

    await pressTab(tree, 'focus');
    await press(tree, 'Reset to default');
    expect(props.onResetFocusSettings).toHaveBeenCalledTimes(1);
    await act(async () => tree.unmount());
  });

  it('closes from the close button and renders nothing once hidden', async () => {
    const { tree, props } = await renderSheet();
    await press(tree, 'Close');
    expect(props.onClose).toHaveBeenCalled();

    await act(async () => {
      tree.update(<ReaderSettingsSheet {...props} visible={false} />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    expect(tree.toJSON()).toBeNull();
    await act(async () => tree.unmount());
  });
});
