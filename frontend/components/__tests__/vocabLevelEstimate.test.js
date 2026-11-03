jest.mock('@expo/vector-icons', () => ({ Feather: () => null }), { virtual: true });
jest.mock('../../contexts/AppContext', () => ({ useAppContext: () => ({}) }));
jest.mock('../../contexts/LocalOwnerContext', () => ({ useLocalOwner: () => ({ activeOwnerId: 'owner-1' }) }));
jest.mock('../../services/Database', () => ({
  getProfileAbility: jest.fn(),
  setProfileAbilityFromVocab: jest.fn(),
}));

const { tierIndexFor } = require('../shared/VocabLevelModal');
const { getVocabTiers, thetaForTier } = require('../../services/vocabSizeLevels');

const tiers = getVocabTiers('zh');

describe('tierIndexFor', () => {
  it('is the tier the level reaches, the one a pick of it seeds', () => {
    tiers.forEach((tier, i) => {
      expect(tierIndexFor('zh', tiers, thetaForTier('zh', tier.threshold))).toBe(i);
    });
  });

  it('floors at the first tier and is null without an ability', () => {
    expect(tierIndexFor('zh', tiers, -4)).toBe(0);
    expect(tierIndexFor('zh', tiers, undefined)).toBeNull();
    expect(tierIndexFor('zh', [], 1)).toBeNull();
  });
});
