// The stack's geometry helpers: the scrubber uses them to open the card
// beside its handle without measuring every row.
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }), { virtual: true });

const { getStackOffsets, findStackIndexAt } = require('../Learn/WordStack');

// Two days: three cards, then two.
const ITEMS = [
  { key: 'a', showWhen: true },
  { key: 'b', showWhen: false },
  { key: 'c', showWhen: false },
  { key: 'd', showWhen: true },
  { key: 'e', showWhen: false },
];

describe('WordStack geometry', () => {
  const offsets = getStackOffsets(ITEMS);

  it('spaces cards evenly within a day and leaves a gap before a new day', () => {
    const step = offsets[1] - offsets[0];
    expect(step).toBeGreaterThan(0);
    expect(offsets[2] - offsets[1]).toBe(step);
    expect(offsets[4] - offsets[3]).toBe(step);
    expect(offsets[3] - offsets[2]).toBeGreaterThan(step);
  });

  it('finds the card at a point, clamping above and below the stack', () => {
    expect(findStackIndexAt(offsets, -50)).toBe(0);
    expect(findStackIndexAt(offsets, offsets[1] + 1)).toBe(1);
    expect(findStackIndexAt(offsets, offsets[3] + 1)).toBe(3);
    expect(findStackIndexAt(offsets, 99999)).toBe(4);
    expect(findStackIndexAt([], 10)).toBe(-1);
  });

  it('allows for the open card pushing the ones below it down', () => {
    const step = offsets[1] - offsets[0];
    // Card b is open: a point just past its strip is still card b…
    expect(findStackIndexAt(offsets, offsets[1] + step + 10, 1)).toBe(1);
    // …and card c now starts far lower than its closed offset.
    expect(findStackIndexAt(offsets, offsets[2] + 10, 1)).toBe(1);
    expect(findStackIndexAt(offsets, offsets[2] + 400, 1)).toBeGreaterThan(1);
  });
});
