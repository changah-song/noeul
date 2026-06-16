import { colors } from '../theme';

export const MOCK_WRITING_ENTRY_ID = 'mock-writing-entry-today-concerns';

export const MOCK_WRITING_ENTRY_BODY =
  '요즘 현대 사회인들은 스트레스를 해소하기 위해서 다양한 취미 활동을 이용하고 있습니다. 하지만 제 생각에는, 진정한 휴식이라는 것은 단순히 시간을 보내는 것이 아니라 자기 내면의 voice를 귀를 기울이는 과정이라고 간주합니다. 저는 지난주부터 명상을 시작했는데, 마음에 가득 찬 걱정들을 버리려고 노력하는 중입니다. 처음에는 잡생각이 자꾸 떠올라서 되게 frustrated했지만, 매일 꾸준히 하니까 정신이 맑아지는 것을 느껴졌습니다. 여러분도 바쁜 일상 속에서 잠시 멈추고 자신을 감싸안는 시간을 가지는 것을 추천을 드립니다.';

export const MOCK_WRITING_ASSESSMENT = {
  annotations: [
    {
      id: '1',
      type: 'DICTION',
      original: '사회인들은',
      explanation: "'사회인' technically means 'member of society / working adult' and is understandable, but the intended meaning of 'people in modern society' is more naturally expressed without it.",
      suggestions: ['현대인들은', '현대 사회의 사람들은'],
      suggestion_notes: [
        "'현대인' is the standard compressed term for 'modern-day people / people of the modern age' - dropping '사회' avoids redundancy with '현대'.",
        "'현대 사회의 사람들' is more explicit and also natural, though slightly longer.",
      ],
    },
    {
      id: '2',
      type: 'DICTION',
      original: '취미 활동을 이용하고 있습니다',
      explanation: "'이용하다' means 'to make use of / utilize' and collocates with services, facilities, or tools - not hobbies. Hobbies are things you 'engage in' or 'enjoy', not 'utilize'.",
      suggestions: ['취미 활동을 즐기고 있습니다', '취미 활동에 참여하고 있습니다'],
      suggestion_notes: [
        "'즐기다' is the most natural verb for hobbies - 'to enjoy'.",
        "'참여하다' means 'to participate in' and is natural for activities, though slightly more formal.",
      ],
    },
    {
      id: '3',
      type: 'NATIVE_INSERT',
      original: 'voice를',
      explanation: "The English word 'voice' was inserted, likely because the Korean equivalent wasn't certain. Several natural Korean expressions exist for this concept.",
      suggestions: ['내면의 목소리를', '내면의 소리를', '자신의 본심에'],
      suggestion_notes: [
        "'내면의 목소리' is the direct and most common Korean equivalent of 'inner voice'.",
        "'내면의 소리' is slightly more poetic - 'the sound within'.",
        "'자신의 본심' shifts the nuance slightly to 'one's true feelings/heart', which may better fit the context of genuine rest.",
      ],
    },
    {
      id: '4',
      type: 'GRAMMAR',
      original: '귀를 기울이는',
      explanation: "The verb '귀를 기울이다' (to lend an ear / listen attentively) requires the subject doing the listening. As written, the sentence says 'the process of listening to the inner voice's ears', which is structurally broken. The preceding noun '자기 내면의 목소리' should be the object, marked with '에', and '귀를 기울이는' should describe the act of listening to it.",
      suggestions: ['자기 내면의 목소리에 귀를 기울이는 과정', '자기 내면의 소리를 듣는 과정'],
      suggestion_notes: [
        "'~에 귀를 기울이다' is the correct collocation - the particle '에' marks what is being listened to.",
        "'소리를 듣다' is a simpler, equally natural alternative if the idiom feels complex.",
      ],
    },
    {
      id: '5',
      type: 'UNNATURAL',
      original: '간주합니다',
      explanation: "'간주하다' means 'to regard/consider (officially or formally)' and is used in academic, legal, or analytical contexts - e.g. '법적으로 간주됩니다'. Used here to express a personal opinion in a diary, it sounds stiff and overly formal. The sentence also creates a double-expression issue: '제 생각에는 ... 간주합니다' is redundant (both say 'I think/consider').",
      suggestions: ['제 생각에는, 진정한 휴식이란 ... 과정입니다', '저는 진정한 휴식이란 ... 과정이라고 생각합니다'],
      suggestion_notes: [
        "Drop '간주합니다' and end with '과정입니다' after '제 생각에는' - the opener already signals it's your view.",
        "Use '생각합니다' and drop '제 생각에는' at the start - clean and natural for diary writing.",
      ],
    },
    {
      id: '6',
      type: 'NATIVE_INSERT',
      original: 'frustrated했지만',
      explanation: "The English adjective 'frustrated' was mixed into a Korean sentence. Several Korean equivalents express this well.",
      suggestions: ['답답했지만', '짜증이 났지만', '좌절스러웠지만'],
      suggestion_notes: [
        "'답답하다' is the most culturally resonant equivalent - it expresses a stifled, blocked feeling and is the go-to word Koreans use in this exact context (can't clear your mind, feel stuck).",
        "'짜증이 나다' is slightly stronger - closer to 'annoyed/irritated'.",
        "'좌절스럽다' is a closer semantic match to 'frustrated' in the sense of feeling thwarted, but is less commonly used in everyday speech.",
      ],
    },
    {
      id: '7',
      type: 'GRAMMAR',
      original: '느껴졌습니다',
      explanation: "'느껴지다' is the passive form of '느끼다' - it means 'to be felt (by something)' and implies the sensation comes to you from outside. When you consciously notice or feel something yourself, the active form '느끼다' is correct. '느껴지다' is only natural when something makes itself felt, e.g. '바람이 느껴졌다 (the wind was felt)'.",
      suggestions: ['느낄 수 있었습니다', '느꼈습니다'],
      suggestion_notes: [
        "'느낄 수 있었습니다' - 'I was able to feel' - is the most natural way to express consciously noticing an internal change.",
        "'느꼈습니다' - simply 'I felt' - is also correct and more concise.",
      ],
    },
    {
      id: '8',
      type: 'GRAMMAR',
      original: '추천을 드립니다',
      explanation: "'추천을 드리다' is a common error caused by over-applying the honorific '드리다'. '추천하다' is a verb and should not be split into noun + '드리다' in this context. The natural humble/polite form is '추천드립니다' (written as one word) or simply '추천합니다'.",
      suggestions: ['추천드립니다', '권해 드립니다'],
      suggestion_notes: [
        "'추천드립니다' (one word, no '을') is the standard polite form of '추천하다' - very commonly used.",
        "'권해 드립니다' uses '권하다' (to recommend/suggest) with the humble auxiliary '드리다' - slightly softer and also natural.",
      ],
    },
  ],
  summary: {
    patterns: [
      "Code-switching into English (voice, frustrated): At an advanced level, reaching for Korean-specific emotional vocabulary like '답답하다' or '내면의 목소리' will make the writing significantly more authentic.",
      "Active vs. passive verb confusion: '느껴졌습니다' should be '느꼈습니다' - the passive form '~어/아지다' is used when a state changes of its own accord, not when the subject consciously experiences something.",
      "Verb-noun collocation mismatches: '취미를 이용하다' and '추천을 드리다' reflect a tendency to over-nominalize or use overly formal/utilitarian verbs where simpler, more natural collocations exist.",
    ],
    strengths: [
      'Cohesive use of formal polite register (-습니다/ㅂ니다) throughout the entire entry - this is maintained consistently and appropriately for an essay-style diary.',
      'Natural use of connective endings (-는데, -지만, -니까) to build multi-clause sentences shows strong grammatical fluency with clause-chaining.',
    ],
    vocab_items: [
      {
        word: '잡념 (雜念)',
        meaning: 'Distracting or cluttered thoughts; wandering mind',
        example: '명상 중에 잡념이 사라지는 느낌이 들었다.',
      },
      {
        word: '답답하다',
        meaning: "To feel frustrated, stifled, or mentally blocked (the Korean cultural equivalent of 'frustrated')",
        example: '생각이 정리가 안 되니까 너무 답답했다.',
      },
      {
        word: '~는 데 도움이 되다',
        meaning: "Grammar pattern: 'to be helpful in doing ~'",
        example: '명상은 마음을 정리하는 데 도움이 됩니다.',
      },
      {
        word: '마음을 다스리다',
        meaning: "To manage / calm / master one's mind or emotions",
        example: '꾸준한 명상이 마음을 다스리는 데 효과적이다.',
      },
      {
        word: '일상에서 벗어나다',
        meaning: "To break away from / escape one's daily routine",
        example: '바쁜 일상에서 벗어나 자신을 돌아보는 시간이 필요하다.',
      },
    ],
  },
};

export const ANNOTATION_LEGEND = [
  { type: 'GRAMMAR', label: 'Grammar', color: colors.inkSlate },
  { type: 'DICTION', label: 'Word choice', color: colors.textMuted },
  { type: 'NATIVE_INSERT', label: 'Translation', color: colors.textTertiary },
  { type: 'UNNATURAL', label: 'Unnatural', color: colors.textSubtle },
];

export const ANNOTATION_COLORS = ANNOTATION_LEGEND.reduce((acc, item) => {
  acc[item.type] = item.color;
  return acc;
}, {});

export const createMockWritingEntry = () => ({
  id: MOCK_WRITING_ENTRY_ID,
  title: '진정한 휴식의 의미',
  body: MOCK_WRITING_ENTRY_BODY,
  prompt: 'What does true rest mean in modern life?',
  date: '2026-04-20T09:00:00.000+09:00',
  createdAt: '2026-04-20T09:00:00.000+09:00',
  updatedAt: '2026-04-20T09:00:00.000+09:00',
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
