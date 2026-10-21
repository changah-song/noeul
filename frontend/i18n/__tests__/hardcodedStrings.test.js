// Regression guard: user-visible text in screens/ and components/ must go
// through t(). Scans the source for hard-coded Latin-script strings in the
// places that reach the screen: JSX text, text-bearing props, string literals
// rendered as JSX children, and Alert / ToastAndroid / Share arguments.
//
// A string that is the same in every language (a brand, an acronym) goes in
// ALLOWED_TEXT below — explicitly, so every exception is reviewed.
const fs = require('fs');
const path = require('path');
const { parse } = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['screens', 'components'];

// Same in every interface language: brand and product names, acronyms.
const ALLOWED_TEXT = new Set([
  'Noeul',
  'PDF',
  'EPUB',
  'OCR',
  'TOPIK',
  'HSK',
  'KRDICT',
  'AI',
]);

// Props whose value is shown to the user or read by a screen reader.
const TEXT_PROPS = new Set([
  'accessibilityHint',
  'accessibilityLabel',
  'actionLabel',
  'body',
  'buttonLabel',
  'caption',
  'cancelLabel',
  'confirmLabel',
  'ctaLabel',
  'description',
  'emptyText',
  'errorText',
  'header',
  'heading',
  'helperText',
  'hint',
  'label',
  'message',
  'note',
  'placeholder',
  'primaryLabel',
  'secondaryLabel',
  'subtitle',
  'text',
  'title',
  'tooltip',
]);

const LATIN_WORD = /[A-Za-z]{2,}/;

const listSourceFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const fullPath = path.join(dir, entry.name);
  if (entry.isDirectory()) {
    return entry.name === '__tests__' ? [] : listSourceFiles(fullPath);
  }
  return entry.name.endsWith('.js') ? [fullPath] : [];
});

const isUserText = (value) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return LATIN_WORD.test(text) && !ALLOWED_TEXT.has(text);
};

// String pieces an expression renders directly: a literal, the static parts
// of a template, or either branch of `cond ? a : b` / `a || b` / `a ?? b`.
const renderedStrings = (node) => {
  if (!node) return [];
  switch (node.type) {
    case 'StringLiteral':
      return [{ node, text: node.value }];
    case 'TemplateLiteral':
      return node.quasis.map((quasi) => ({ node: quasi, text: quasi.value.cooked }));
    case 'ConditionalExpression':
      return [...renderedStrings(node.consequent), ...renderedStrings(node.alternate)];
    case 'LogicalExpression':
      return node.operator === '&&' ? renderedStrings(node.right) : [...renderedStrings(node.left), ...renderedStrings(node.right)];
    default:
      return [];
  }
};

const findHardCodedStrings = (file) => {
  const source = fs.readFileSync(file, 'utf8');
  const ast = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const relative = path.relative(ROOT, file);
  const found = [];
  const report = (node, text) => {
    if (isUserText(text)) {
      found.push(`${relative}:${node.loc.start.line} ${JSON.stringify(text.trim())}`);
    }
  };

  traverse(ast, {
    JSXText(nodePath) {
      report(nodePath.node, nodePath.node.value);
    },
    JSXAttribute(nodePath) {
      const { name, value } = nodePath.node;
      if (!TEXT_PROPS.has(name.name) || !value) return;
      const expression = value.type === 'JSXExpressionContainer' ? value.expression : value;
      renderedStrings(expression).forEach(({ node, text }) => report(node, text));
    },
    JSXExpressionContainer(nodePath) {
      if (nodePath.parent.type !== 'JSXElement' && nodePath.parent.type !== 'JSXFragment') return;
      renderedStrings(nodePath.node.expression).forEach(({ node, text }) => report(node, text));
    },
    CallExpression(nodePath) {
      const { callee, arguments: args } = nodePath.node;
      if (callee.type !== 'MemberExpression') return;
      const target = `${callee.object.name}.${callee.property.name}`;
      if (target === 'Alert.alert') {
        args.slice(0, 2).forEach((arg) => renderedStrings(arg).forEach(({ node, text }) => report(node, text)));
        const buttons = args[2];
        if (buttons?.type === 'ArrayExpression') {
          buttons.elements.forEach((button) => {
            (button?.properties ?? [])
              .filter((property) => property.key?.name === 'text')
              .forEach((property) => renderedStrings(property.value).forEach(({ node, text }) => report(node, text)));
          });
        }
      } else if (target === 'ToastAndroid.show') {
        renderedStrings(args[0]).forEach(({ node, text }) => report(node, text));
      } else if (target === 'Share.share' && args[0]?.type === 'ObjectExpression') {
        args[0].properties
          .filter((property) => ['message', 'title'].includes(property.key?.name))
          .forEach((property) => renderedStrings(property.value).forEach(({ node, text }) => report(node, text)));
      }
    },
  });

  return found;
};

describe('hard-coded user-facing strings', () => {
  const files = SCAN_DIRS.flatMap((dir) => listSourceFiles(path.join(ROOT, dir)));

  it('finds the source files to scan', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('routes every visible string in screens/ and components/ through t()', () => {
    const found = files.flatMap(findHardCodedStrings);
    expect(found).toEqual([]);
  });

  it('catches the patterns it is meant to catch', () => {
    const tmp = path.join(ROOT, 'i18n', '__tests__', '__hardcodedFixture.tmp.js');
    fs.writeFileSync(tmp, [
      "const A = () => <Text>Hello there</Text>;",
      "const B = () => <TextInput placeholder=\"Type here\" accessibilityLabel={ok ? 'Open' : t('x')} />;",
      "const C = () => <Text>{busy ? 'Saving' : t('save')}</Text>;",
      "Alert.alert('Oops', t('body'), [{ text: 'OK' }]);",
      "const D = () => <Text>Noeul</Text>;",
      "const E = () => <Icon name=\"chevron-left\" />;",
    ].join('\n'));
    try {
      const found = findHardCodedStrings(tmp).map((line) => line.replace(/^.*?:\d+ /, ''));
      expect(found).toEqual(['"Hello there"', '"Type here"', '"Open"', '"Saving"', '"Oops"', '"OK"']);
    } finally {
      fs.unlinkSync(tmp);
    }
  });
});
