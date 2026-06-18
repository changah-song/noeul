import { DEFAULT_TARGET_LANGUAGE, normalizeBookLanguage } from './languages';

export const PROFICIENCY_LEVEL_OPTIONS = {
  ko: [
    {
      rank: 1,
      value: 'beginner',
      label: '초급',
      shortLabel: '초급',
      description: 'Beginner Korean vocabulary',
      system: 'NIKL',
    },
    {
      rank: 2,
      value: 'intermediate',
      label: '중급',
      shortLabel: '중급',
      description: 'Intermediate Korean vocabulary',
      system: 'NIKL',
    },
    {
      rank: 3,
      value: 'advanced',
      label: '고급',
      shortLabel: '고급',
      description: 'Advanced Korean vocabulary',
      system: 'NIKL',
    },
  ],
  zh: [
    {
      rank: 1,
      value: 'HSK1',
      label: 'HSK 1',
      shortLabel: 'HSK 1',
      description: 'Complete beginner',
      system: 'HSK',
    },
    {
      rank: 2,
      value: 'HSK2',
      label: 'HSK 2',
      shortLabel: 'HSK 2',
      description: 'Beginner',
      system: 'HSK',
    },
    {
      rank: 3,
      value: 'HSK3',
      label: 'HSK 3',
      shortLabel: 'HSK 3',
      description: 'Lower intermediate',
      system: 'HSK',
    },
    {
      rank: 4,
      value: 'HSK4',
      label: 'HSK 4',
      shortLabel: 'HSK 4',
      description: 'Intermediate',
      system: 'HSK',
    },
    {
      rank: 5,
      value: 'HSK5',
      label: 'HSK 5',
      shortLabel: 'HSK 5',
      description: 'Upper intermediate',
      system: 'HSK',
    },
    {
      rank: 6,
      value: 'HSK6',
      label: 'HSK 6',
      shortLabel: 'HSK 6',
      description: 'Advanced',
      system: 'HSK',
    },
    {
      rank: 7,
      value: 'HSK7',
      label: 'HSK 7',
      shortLabel: 'HSK 7',
      description: 'Advanced learner',
      system: 'HSK',
    },
  ],
  en: [
    {
      rank: 1,
      value: 'A1',
      label: 'A1',
      shortLabel: 'A1',
      description: 'Complete beginner',
      system: 'CEFR',
    },
    {
      rank: 2,
      value: 'A2',
      label: 'A2',
      shortLabel: 'A2',
      description: 'Beginner',
      system: 'CEFR',
    },
    {
      rank: 3,
      value: 'B1',
      label: 'B1',
      shortLabel: 'B1',
      description: 'Intermediate',
      system: 'CEFR',
    },
    {
      rank: 4,
      value: 'B2',
      label: 'B2',
      shortLabel: 'B2',
      description: 'Upper intermediate',
      system: 'CEFR',
    },
    {
      rank: 5,
      value: 'C1',
      label: 'C1',
      shortLabel: 'C1',
      description: 'Advanced',
      system: 'CEFR',
    },
    {
      rank: 6,
      value: 'C2',
      label: 'C2',
      shortLabel: 'C2',
      description: 'Near-native',
      system: 'CEFR',
    },
  ],
};

export const DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE = {
  ko: 1,
  zh: 1,
  en: 1,
};

const LEVEL_ALIASES = {
  ko: {
    '1': 1,
    beginner: 1,
    'complete beginner': 1,
    '초급': 1,
    'topik 1': 1,
    'topik 1 level 1': 1,
    '2': 2,
    intermediate: 2,
    '중급': 2,
    'topik 2': 2,
    '3': 3,
    advanced: 3,
    'advanced learner': 3,
    '고급': 3,
    'topik 3': 3,
  },
  zh: {
    hsk1: 1,
    'hsk 1': 1,
    hsk2: 2,
    'hsk 2': 2,
    hsk3: 3,
    'hsk 3': 3,
    hsk4: 4,
    'hsk 4': 4,
    hsk5: 5,
    'hsk 5': 5,
    hsk6: 6,
    'hsk 6': 6,
    hsk7: 7,
    'hsk 7': 7,
  },
  en: {
    a1: 1,
    a2: 2,
    b1: 3,
    b2: 4,
    c1: 5,
    c2: 6,
  },
};

export const getProficiencyLevelOptions = (language = DEFAULT_TARGET_LANGUAGE) => (
  PROFICIENCY_LEVEL_OPTIONS[normalizeBookLanguage(language)] ?? PROFICIENCY_LEVEL_OPTIONS[DEFAULT_TARGET_LANGUAGE]
);

export const normalizeProficiencyRank = (language = DEFAULT_TARGET_LANGUAGE, value = null) => {
  const normalizedLanguage = normalizeBookLanguage(language);
  const options = getProficiencyLevelOptions(normalizedLanguage);
  const fallback = DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE[normalizedLanguage]
    ?? DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE[DEFAULT_TARGET_LANGUAGE];

  if (value == null || value === '') {
    return fallback;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    const rank = Math.round(numeric);
    return options.some((option) => option.rank === rank) ? rank : fallback;
  }

  const raw = String(value).trim();
  const normalized = raw.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const compact = normalized.replace(/\s+/g, '');
  const aliasRank = LEVEL_ALIASES[normalizedLanguage]?.[normalized]
    ?? LEVEL_ALIASES[normalizedLanguage]?.[compact];

  if (Number.isFinite(aliasRank)) {
    return aliasRank;
  }

  const matchedOption = options.find((option) => (
    option.value.toLowerCase() === raw.toLowerCase()
    || option.label.toLowerCase() === raw.toLowerCase()
    || option.shortLabel.toLowerCase() === raw.toLowerCase()
  ));

  return matchedOption?.rank ?? fallback;
};

export const normalizeProficiencyLevelsByLanguage = (levels = {}) => {
  const source = levels && typeof levels === 'object' ? levels : {};

  return Object.keys(PROFICIENCY_LEVEL_OPTIONS).reduce((normalized, language) => ({
    ...normalized,
    [language]: normalizeProficiencyRank(
      language,
      source[language]
        ?? source[language.toUpperCase()]
        ?? DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE[language]
    ),
  }), {});
};

export const getProficiencyLevelForLanguage = (
  language = DEFAULT_TARGET_LANGUAGE,
  levelsByLanguage = DEFAULT_PROFICIENCY_LEVELS_BY_LANGUAGE
) => {
  const normalizedLanguage = normalizeBookLanguage(language);
  const rank = normalizeProficiencyRank(
    normalizedLanguage,
    levelsByLanguage?.[normalizedLanguage]
  );

  return getProficiencyLevelOptions(normalizedLanguage).find((option) => option.rank === rank)
    ?? getProficiencyLevelOptions(normalizedLanguage)[0];
};

export const formatProficiencyLevelLabel = (level) => (
  level ? `${level.label} · ${level.description}` : ''
);
