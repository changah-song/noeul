jest.mock('@expo/vector-icons', () => ({ Feather: () => null }), { virtual: true });
jest.mock('../../contexts/AppContext', () => ({ useAppContext: () => ({}) }));
jest.mock('../../contexts/LocalOwnerContext', () => ({ useLocalOwner: () => ({ activeOwnerId: 'owner-1' }) }));
jest.mock('../../services/Database', () => ({
  getProfileAbility: jest.fn(),
  setProfileAbilityFromVocab: jest.fn(),
}));

const { tierIndexForTheta } = require('../shared/VocabLevelModal');

const tiers = [{ theta: -3 }, { theta: -2 }, { theta: -1 }, { theta: 0 }, { theta: 1 }, { theta: 2 }, { theta: 3 }];

describe('tierIndexForTheta', () => {
  it('is the hardest tier at or below the ability', () => {
    expect(tierIndexForTheta(tiers, 0)).toBe(3);
    expect(tierIndexForTheta(tiers, 0.6)).toBe(3);
    expect(tierIndexForTheta(tiers, 3)).toBe(6);
  });

  it('floors at the first tier and is null without an ability', () => {
    expect(tierIndexForTheta(tiers, -5)).toBe(0);
    expect(tierIndexForTheta(tiers, undefined)).toBeNull();
    expect(tierIndexForTheta([], 1)).toBeNull();
  });
});
