export const MOCK_WRITING_ENTRY_ID = 'mock-writing-entry-today-concerns';

export const MOCK_WRITING_ENTRY_BODY =
  '오늘은 좀 많이 힘든 하루였습니다. 많은 고민들 속에 아무렇지도 않은 듯이 계속 살아가고있고 지칠 때도 있습니다. 내가 과연 하고 싶은게 뭔지 어떻게 하면 행복하고 만족한 삶을 이어나갈 수 있을지가 다 고민이 되네요. 현실과 세상은 미쳐가고 정부 리더들은 욕심만 부리고 망해가는 우리 행성과 인류를 그냥 망하게 두는 모습도 보기 힘듭니다. 이게 자본주의에 문제인지 그냥 근본적인 인간에 문젠지는 모르겠지만 아쉽다. 인간들은 좋은 것을 이룰 수 있는 능력과 지능이 있는데 그것 같고 남 도울 생각은 안 하나봐.';

export const MOCK_WRITING_ASSESSMENT = {
  annotations: [
    {
      id: '1',
      type: 'GRAMMAR',
      original: '살아가고있고',
      explanation:
        "There should be a space before '있고'. In Korean, the auxiliary verb construction '-고 있다' is written with a space between the main verb ending and '있다'.",
      suggestions: ['살아가고 있고'],
      suggestion_notes: ["Standard spacing rule: '-고 있다' always takes a space before '있다'."],
    },
    {
      id: '2',
      type: 'GRAMMAR',
      original: '만족한 삶',
      explanation:
        "'만족한' is grammatically formed but '만족스러운' is the correct adjectival form when describing a noun as 'satisfying' or 'fulfilling'. '만족한' more literally means 'satisfied (having been satisfied)', used for people, not abstract nouns like 삶.",
      suggestions: ['만족스러운 삶', '보람 있는 삶'],
      suggestion_notes: [
        "'만족스러운' is the natural adjectival form meaning 'fulfilling/satisfying'.",
        "'보람 있는' means 'rewarding/worthwhile' - a slightly different but very common way to describe a meaningful life.",
      ],
    },
    {
      id: '3',
      type: 'GRAMMAR',
      original: '이게 자본주의에 문제인지',
      explanation:
        "The particle '에' is incorrect here. When identifying something as the source or possessor of a problem, the possessive particle '의' is used: '자본주의의 문제'. '에' marks location or direction, not possession/attribution.",
      suggestions: ['이게 자본주의의 문제인지', '이게 자본주의 때문인지'],
      suggestion_notes: [
        "'자본주의의 문제' - use '의' to express 'a problem of capitalism'.",
        "'자본주의 때문인지' - 'because of capitalism', slightly more causal in nuance.",
      ],
    },
    {
      id: '4',
      type: 'GRAMMAR',
      original: '근본적인 인간에 문젠지는',
      explanation:
        "Same particle error as above. '인간에 문제' should be '인간의 문제' - '의' marks attribution/possession. Also '문젠지는' is a spoken contraction of '문제인지는'; in written diary entries either form is acceptable, but consistency with the rest of the entry is preferable.",
      suggestions: ['근본적인 인간의 문제인지는', '근본적인 인간 본성의 문제인지는'],
      suggestion_notes: [
        "'인간의 문제' is the grammatically correct form.",
        "'인간 본성의 문제' adds '본성 (nature)' which more precisely captures the idea of it being an inherent human flaw.",
      ],
    },
    {
      id: '5',
      type: 'GRAMMAR',
      original: '그것 같고',
      explanation:
        "'그것 같고' appears to be a truncated or mistaken form. The intended meaning seems to be '그런 능력을 갖고도' (even having such ability) or '그런 능력이 있으면서도'. As written, '그것 같고' is grammatically incomplete and unclear in meaning.",
      suggestions: ['그런 능력이 있으면서도', '그런 능력을 갖고도'],
      suggestion_notes: [
        "'있으면서도' means 'even while having' - emphasizes the contrast with not using it.",
        "'갖고도' means 'even possessing' - slightly more concise, common in spoken and written Korean.",
      ],
    },
    {
      id: '6',
      type: 'DICTION',
      original: '미쳐가고',
      explanation:
        "'미쳐가다' means 'going crazy' and is understandable here, but to describe the world and reality deteriorating or becoming chaotic, more precise alternatives exist.",
      suggestions: ['무너져가고', '혼란스러워지고', '망가져가고'],
      suggestion_notes: [
        "'무너져가다' - 'crumbling/collapsing', evokes structural breakdown of society.",
        "'혼란스러워지다' - 'becoming chaotic/turbulent', more measured and precise.",
        "'망가져가다' - 'falling apart/breaking down', similar in tone to the original but more commonly used for systems or institutions.",
      ],
    },
    {
      id: '7',
      type: 'DICTION',
      original: '욕심만 부리고',
      explanation:
        "'욕심을 부리다' is natural and correct. For political leaders specifically, stronger or more precise collocations are also common.",
      suggestions: ['사리사욕만 채우고', '탐욕만 부리고'],
      suggestion_notes: [
        "'사리사욕을 채우다' - 'to fill one's own private greed', a set phrase specifically implying self-interest at others' expense; very fitting for political criticism.",
        "'탐욕을 부리다' - 'to act with greed/avarice', slightly stronger and more literary than '욕심을 부리다'.",
      ],
    },
    {
      id: '8',
      type: 'UNNATURAL',
      original: '아쉽다',
      explanation:
        "The entry is written in formal polite style (-습니다, -네요) throughout, but '아쉽다' is a plain/informal ending. This register inconsistency breaks the flow. Even in a diary, maintaining consistent register throughout a single entry reads more naturally.",
      suggestions: ['아쉽네요', '아쉽습니다', '참 아쉬운 일이다'],
      suggestion_notes: [
        "'아쉽네요' - matches the softer formal register used elsewhere in the entry.",
        "'아쉽습니다' - matches the more formal register used in the opening sentences.",
        "'참 아쉬운 일이다' - if you want to shift to plain style intentionally for the whole entry, this is a natural plain-style expression. But mixing styles mid-entry is what reads unnaturally.",
      ],
    },
    {
      id: '9',
      type: 'UNNATURAL',
      original: '남 도울 생각은 안 하나봐',
      explanation:
        "Like '아쉽다', '안 하나봐' is informal/plain style, inconsistent with the rest of the entry. Additionally, '남 도울 생각' is slightly clipped; '남을 도울 생각' with the object particle '을' is more complete in written form.",
      suggestions: ['남을 도울 생각은 안 하나 봐요', '남을 도우려는 생각은 없나 봅니다'],
      suggestion_notes: [
        "'안 하나 봐요' - adds politeness and also note the space before '봐요'; '나 보다' is written as two words.",
        "'없나 봅니다' - more formal and complete; '~으려는 생각이 없다' is a natural construction for 'has no intention of doing'.",
      ],
    },
  ],
  summary: {
    patterns: [
      "Particle confusion between '에' and '의': '에' is being used in attribution contexts where '의' is required (자본주의에 문제 -> 자본주의의 문제, 인간에 문제 -> 인간의 문제).",
      'Register inconsistency: The entry mixes formal polite endings (-습니다, -네요, -봐요) with plain/informal endings (-아쉽다, -하나봐), which disrupts the cohesion of the writing.',
      'Adjectival form errors: Using noun-based or people-oriented adjective forms (만족한) where the proper descriptive adjective form is needed (만족스러운).',
    ],
    strengths: [
      'Complex sentence structures involving indirect questions (-인지, -을지) and conjunctions are used accurately and naturally throughout.',
      "Vocabulary range is strong for an advanced learner - words like '근본적인', '인류', '자본주의', and '이어나가다' are used appropriately and demonstrate solid command of abstract and formal vocabulary.",
    ],
    vocab_items: [
      {
        word: '자괴감 (自愧感)',
        meaning:
          'A feeling of self-reproach or existential frustration with oneself or the world; stronger than 고민',
        example: '세상이 이렇게 돌아가는 걸 보면 자괴감이 든다.',
      },
      {
        word: '무력감 (無力感)',
        meaning: 'A sense of helplessness or powerlessness',
        example: '아무것도 바꿀 수 없을 것 같아서 무력감을 느낀다.',
      },
      {
        word: '씁쓸하다',
        meaning:
          'To feel bitter, dejected, or disheartened (often about the state of the world); more expressive than 아쉽다',
        example: '현실을 보면 볼수록 씁쓸해진다.',
      },
      {
        word: '~(으)면서도',
        meaning:
          "Grammar pattern: 'even while / despite having ~'; used to highlight a contrast or irony",
        example: '능력이 있으면서도 아무것도 하지 않는 사람들이 있다.',
      },
      {
        word: '공동체 의식',
        meaning: 'A sense of community / collective responsibility',
        example: '공동체 의식이 있다면 서로 더 잘 도울 수 있을 텐데.',
      },
    ],
  },
};

export const ANNOTATION_LEGEND = [
  { type: 'GRAMMAR', label: 'Grammar', color: '#FF4444' },
  { type: 'DICTION', label: 'Word choice', color: '#F5A623' },
  { type: 'NATIVE_INSERT', label: 'Translation', color: '#4CAF50' },
  { type: 'UNNATURAL', label: 'Unnatural', color: '#2196F3' },
];

export const ANNOTATION_COLORS = ANNOTATION_LEGEND.reduce((acc, item) => {
  acc[item.type] = item.color;
  return acc;
}, {});

export const createMockWritingEntry = () => ({
  id: MOCK_WRITING_ENTRY_ID,
  title: '오늘의 고민',
  body: MOCK_WRITING_ENTRY_BODY,
  prompt: '',
  date: '2026-06-03T09:00:00.000+09:00',
  createdAt: '2026-06-03T09:00:00.000+09:00',
  updatedAt: '2026-06-03T09:00:00.000+09:00',
  status: 'reviewed',
  assessment: MOCK_WRITING_ASSESSMENT,
});

const rangesOverlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

const findNextNonOverlappingIndex = (text, search, startIndex, positioned) => {
  let index = text.indexOf(search, startIndex);

  while (index !== -1) {
    const end = index + search.length;
    const overlaps = positioned.some((item) =>
      rangesOverlap(index, end, item.index, item.end)
    );

    if (!overlaps) {
      return index;
    }

    index = text.indexOf(search, index + search.length);
  }

  return -1;
};

export const buildAnnotatedSpans = (originalText, annotations = []) => {
  const positioned = [];
  let searchCursor = 0;

  annotations.forEach((annotation) => {
    if (!annotation?.original) {
      return;
    }

    let index = findNextNonOverlappingIndex(
      originalText,
      annotation.original,
      searchCursor,
      positioned
    );

    if (index === -1) {
      index = findNextNonOverlappingIndex(originalText, annotation.original, 0, positioned);
    }

    if (index === -1) {
      return;
    }

    const end = index + annotation.original.length;
    positioned.push({
      ...annotation,
      index,
      end,
    });
    searchCursor = Math.max(searchCursor, end);
  });

  const spans = [];
  let cursor = 0;

  positioned
    .sort((a, b) => a.index - b.index)
    .forEach((annotation) => {
      if (annotation.index < cursor) {
        return;
      }

      if (annotation.index > cursor) {
        spans.push({
          type: 'plain',
          text: originalText.slice(cursor, annotation.index),
        });
      }

      spans.push({
        type: 'annotated',
        text: originalText.slice(annotation.index, annotation.end),
        annotation,
      });
      cursor = annotation.end;
    });

  if (cursor < originalText.length) {
    spans.push({
      type: 'plain',
      text: originalText.slice(cursor),
    });
  }

  return spans;
};
