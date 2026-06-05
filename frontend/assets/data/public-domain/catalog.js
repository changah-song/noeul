const SOURCE = '공유마당';
const PREVIEW_SOURCE = '공유마당 (gongu.copyright.or.kr)';
const ATTRIBUTION_CATEGORY = '기증저작물, CC BY 4.0';

const PUBLIC_DOMAIN_COVER_COLORS = [
  '#7c4d8a',
  '#2f6f7e',
  '#a94f55',
  '#57723b',
  '#405f9e',
  '#ad6a2e',
  '#6b5aa9',
  '#2f7a67',
  '#a24c7c',
  '#866b2d',
  '#465c3b',
  '#884a37',
  '#3f5b7d',
  '#8b5570',
  '#4f6f8f',
  '#9a5c2d',
];

const PUBLIC_DOMAIN_TITLE_TRANSLATIONS = {
  'b-sagam-and-love-letter': 'Miss B and the Love Letter',
  'snow-queen': 'The Snow Queen',
  'ugly-duckling': 'The Ugly Duckling',
  'little-match-girl': 'The Little Match Girl',
  thumbelina: 'Thumbelina',
  'little-mermaid': 'The Little Mermaid',
  'gwangyeom-sonata': 'Crimson Flame Sonata',
  wings: 'Wings',
  'city-and-ghost': 'The City and Its Ghosts',
  'camellia-flower': 'Camellia',
  'when-buckwheat-flowers-bloom': 'When Buckwheat Blooms',
  'mister-bang': 'Mr. Bang',
  'spring-spring': 'Spring, Spring',
  'a-lucky-day': 'A Lucky Day',
  'crime-and-punishment-lee-muyeong': 'Sin and Punishment',
  taepyeongcheonha: 'Peaceful World',
};

const PUBLIC_DOMAIN_AUTHOR_TRANSLATIONS = {
  'b-sagam-and-love-letter': 'Hyeon Jin-geon',
  'snow-queen': 'Kim Seonhui, tr. / H.C. Andersen',
  'ugly-duckling': 'Kim Seonhui, tr. / H.C. Andersen',
  'little-match-girl': 'Kim Seonhui, tr. / H.C. Andersen',
  thumbelina: 'Kim Seonhui, tr. / H.C. Andersen',
  'little-mermaid': 'Kim Seonhui, tr. / H.C. Andersen',
  'gwangyeom-sonata': 'Kim Dong-in',
  wings: 'Yi Sang / Kim Hae-gyeong',
  'city-and-ghost': 'Yi Hyo-seok',
  'camellia-flower': 'Kim Yu-jeong',
  'when-buckwheat-flowers-bloom': 'Yi Hyo-seok',
  'mister-bang': 'Chae Man-sik',
  'spring-spring': 'Kim Yu-jeong',
  'a-lucky-day': 'Hyeon Jin-geon',
  'crime-and-punishment-lee-muyeong': 'Yi Mu-yeong',
  taepyeongcheonha: 'Chae Man-sik',
};

const PUBLIC_DOMAIN_PREVIEW_METADATA = {
  'b-sagam-and-love-letter': {
    genre: 'Ironic comedy / Character study',
    attribution: 'B사감과 러브레터, 기증 현진건, 공유마당, CC BY 4.0',
    snippet: [
      `Miss B is the strictest dormitory supervisor at C Girls' School. She despises love letters. When they arrive for her students she interrogates the girls for hours, weeping with fury, praying on the floor. She has dedicated her life to stamping out romance entirely.`,
      `Late one night, three students follow a strange sound to its source - and find something that reframes everything they thought they knew about Miss B. A perfectly constructed short story about loneliness, repression, and the secret lives of the people who terrify us.`,
    ].join('\n\n'),
  },
  'snow-queen': {
    genre: 'Fantasy / Adventure fairy tale',
    attribution: '눈의 여왕, 기증 김선희, 공유마당, CC BY 4.0',
    snippet: [
      `A devil's mirror shatters and scatters across the world. One splinter lands in a boy's eye. Another finds his heart. Now he can only see the ugliness in everything - and he doesn't even notice the change.`,
      `His best friend Gerda sets out alone to find him, crossing enchanted gardens, kingdoms, and frozen wastelands to reach the Snow Queen's palace at the ends of the earth. Andersen's longest and most ambitious fairy tale is a story about what love actually costs - and whether it's ever enough.`,
    ].join('\n\n'),
  },
  'ugly-duckling': {
    genre: 'Classic fairy tale / Coming-of-age',
    attribution: '미운 아기 오리, 기증 김선희, 공유마당, CC BY 4.0',
    snippet: [
      `Born too big, too strange, and unmistakably wrong for every place he ends up, the ugly duckling is driven out of the farmyard, hunted in the marshes, and turned away at every door through a long, brutal winter.`,
      `Andersen wrote this as autobiography. The cruelty in it is real, and so is what comes after - a story about surviving the years before you become what you were always going to be, even when no one around you can see it yet.`,
    ].join('\n\n'),
  },
  'little-match-girl': {
    genre: 'Classic fairy tale / Tragedy',
    attribution: '성냥팔이 소녀, 기증 김선희, 공유마당, CC BY 4.0',
    snippet: [
      `New Year's Eve. A barefoot girl who has not sold a single match all day cannot go home empty-handed. So she sits in the cold between two buildings and strikes one match to warm her fingers - and for one brief, brilliant moment, the world becomes everything she has never had.`,
      `The shortest story on this list and perhaps the most concentrated. Andersen wrote it in 1845 and it has not stopped being true since. A story about poverty, imagination, and what it costs to be invisible in a warm world.`,
    ].join('\n\n'),
  },
  thumbelina: {
    genre: 'Classic fairy tale / Adventure',
    attribution: '엄지 공주, 기증 김선희, 공유마당, CC BY 4.0',
    snippet: [
      `She is no bigger than a thumb, born from a flower, kidnapped by a toad on her first night, and betrothed against her will to a mole who has never seen the sun. Every creature that claims to care for her wants to keep her underground.`,
      `Andersen's Thumbelina spends the entire story escaping one captivity only to land in another - a fairy tale about autonomy, belonging, and the exhausting business of finding a world that fits you.`,
    ].join('\n\n'),
  },
  'little-mermaid': {
    genre: 'Classic fairy tale / Romance / Tragedy',
    attribution: '인어 공주, 기증 김선희, 공유마당, CC BY 4.0',
    snippet: [
      `The youngest princess of the sea kingdom has spent her whole life looking upward. When she finally reaches the surface and saves a drowning prince, she trades her voice - and eventually more than that - for the chance to live in his world.`,
      `Forget the Disney version. Andersen's original is a story about longing so profound it reshapes a person, about the gap between loving someone and being known by them, and about what we sacrifice for beauty we can barely touch.`,
    ].join('\n\n'),
  },
  'gwangyeom-sonata': {
    genre: 'Psychological fiction / Dark literary',
    attribution: '광염 소나타, 기증 김동인, 공유마당, CC BY 4.0',
    snippet: [
      `What if genius and madness are the same thing - and only opportunity separates a great artist from a monster?`,
      `Baek Seong-su could have been the greatest composer of his generation. Instead, the night he discovered he could create his most transcendent music while watching things burn, he became something else entirely. This is the story of what talent looks like when it has no conscience - told by the man who knew him best, to the one person who might understand why it happened.`,
      `A chilling portrait of artistic obsession, colonial-era Korea, and the question of whether beauty can justify horror.`,
    ].join('\n\n'),
  },
  wings: {
    genre: 'Modernist / Stream of consciousness',
    attribution: '날개, 기증 김해경, 공유마당, CC BY 4.0',
    snippet: [
      `He calls himself "a genius taxidermied alive." He sleeps all day in a single room while his wife works. He has stopped wanting things. He has stopped asking questions. This is what peace feels like, he thinks - until the day he walks out into the streets of 1930s Gyeongseong and realizes he has forgotten how to be a person.`,
      `Written in 1936 by Korea's most daring modernist, 날개 reads like a fever dream - part absurdist comedy, part suffocating tragedy. It asks what remains of a self when everything that defined it has been quietly surrendered.`,
    ].join('\n\n'),
  },
  'city-and-ghost': {
    genre: 'Social realism / Ghost story',
    attribution: '도시와 유령, 기증 이효석, 공유마당, CC BY 4.0',
    snippet: [
      `Everyone knows ghosts haunt lonely mountain passes and rotting old mills. Our narrator has never seen one there. But working as a day laborer on a Seoul construction site, sleeping on the streets, drinking away the day's wages - he sees two ghosts in the city that shake him more than any folklore creature ever could.`,
      `A rare story about colonial-era Seoul's urban poor, told from the inside, with dark humor and a twist that reframes everything you've read.`,
    ].join('\n\n'),
  },
  'camellia-flower': {
    genre: 'Rural comedy / Coming-of-age romance',
    attribution: '동백꽃, 기증 김유정, 공유마당, CC BY 4.0',
    snippet: [
      `Jeomsuni keeps setting her rooster on his. She shoved potatoes at him last week and he refused them. Now she won't leave him alone - or maybe it's the other way around. Our narrator, a teenage farmhand in 1930s rural Korea, has absolutely no idea what any of this means.`,
      `Kim Yu-jeong wrote comedies about people who barely get by, and 동백꽃 is his most beloved: a story told from the most oblivious point of view in Korean literature, with a last scene so perfectly timed it still makes readers laugh out loud.`,
    ].join('\n\n'),
  },
  'when-buckwheat-flowers-bloom': {
    genre: 'Lyrical fiction / Road story',
    attribution: '메밀꽃 필 무렵, 기증 이효석, 공유마당, CC BY 4.0',
    snippet: [
      `Two aging peddlers pack up a failed market and walk through the night to the next town. The buckwheat fields are in bloom. The moon is out. And Heo Saengwon, pockmarked and left-handed and utterly alone, begins telling a story about a woman he loved once, decades ago, in a field that looked just like this one.`,
      `Called the most beautiful prose in modern Korean literature, this short story travels about twelve kilometers - and about forty years - in the span of a single night.`,
    ].join('\n\n'),
  },
  'mister-bang': {
    genre: 'Satire / Colonial-era social comedy',
    attribution: '미스터 방, 기증 채만식, 공유마당, CC BY 4.0',
    snippet: [
      `Mr. Bang speaks three languages badly, was once a lowly errand boy, and has now - in the chaos of liberation from Japanese rule in 1945 - somehow become indispensable to an American military officer who can't tell him apart from anyone else. He is insufferable. He is also winning.`,
      `Chae Man-sik's sharp satirical eye turns on the opportunists who thrived in the power vacuum of Korea's liberation - a comedy about status, class, and who gets to reinvent themselves when the old order collapses overnight.`,
    ].join('\n\n'),
  },
  'spring-spring': {
    genre: 'Rural comedy / Farce',
    attribution: '봄봄, 기증 김유정, 공유마당, CC BY 4.0',
    snippet: [
      `He has worked for his future father-in-law for three years and seven months without a single coin in wages. The deal was simple: work until my daughter is tall enough to marry. The problem is she has stopped growing. Or maybe she never started. Either way, the wedding keeps not happening, and spring keeps arriving, and he keeps planting the old man's rice.`,
      `Korea's funniest short story, told by a narrator too sincere to be in on the joke - a farce about labor, patience, and being cheerfully, completely outmaneuvered.`,
    ].join('\n\n'),
  },
  'a-lucky-day': {
    genre: 'Social realism / Tragedy',
    attribution: '운수 좋은 날, 기증 현진건, 공유마당, CC BY 4.0',
    snippet: [
      `For the first time in ten days, rickshaw man Kim Cheom-ji is having a lucky day. Fare after fare, coins actually landing in his palm - enough to buy his sick wife the beef broth soup she's been begging for. He knows he should go home. Something keeps stopping him.`,
      `The most taught short story in Korean schools, 운수 좋은 날 is a masterclass in dramatic irony - the reader sees the tragedy coming long before Kim Cheom-ji does, which makes it all the more devastating. Set in Japanese-occupied Seoul, it is three thousand words that hit like a fist.`,
    ].join('\n\n'),
  },
  'crime-and-punishment-lee-muyeong': {
    genre: 'Literary fiction / Moral drama',
    attribution: '죄와 벌, 기증 이무영, 공유마당, CC BY 4.0',
    snippet: [
      `A man leaves a screening of Hitchcock's "I Confess" - a film about a priest who cannot reveal a killer's confession without betraying God - and finds the film has not yet ended for him. He is wearing a priest's costume. He carries a secret of his own.`,
      `Named after Dostoevsky but in conversation with Hollywood, 이무영's novel explores guilt, vocation, and the impossible geometry of keeping faith when honesty would cost everything.`,
    ].join('\n\n'),
  },
  taepyeongcheonha: {
    genre: 'Satirical novel / Family saga',
    attribution: '태평천하, 기증 채만식, 공유마당, CC BY 4.0',
    snippet: [
      `Elder Yun Jik-won weighs 28 kan, owns half a neighborhood, and believes - genuinely, sincerely - that Japanese colonial rule is the best thing that ever happened to Korea, because it protects his property. His family is collapsing around him. He notices none of it.`,
      `Chae Man-sik's longest and most celebrated novel is a savage comedy about a man so consumed by wealth and self-satisfaction that he has become a walking caricature of collaboration - told in a theatrical, almost vaudeville style that makes the satire land even harder.`,
    ].join('\n\n'),
  },
};

const PUBLIC_DOMAIN_TEXTS_BASE = [
  {
    id: 'b-sagam-and-love-letter',
    title: 'B사감과 러브레터',
    author: '현진건',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/B사감과 러브레터 - 현진건.txt'),
  },
  {
    id: 'snow-queen',
    title: '눈의 여왕',
    author: '김선희',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/눈의 여왕 - 김선희.txt'),
  },
  {
    id: 'ugly-duckling',
    title: '미운 아기 오리',
    author: '김선희',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/미운 아기 오리 - 김선희.txt'),
  },
  {
    id: 'little-match-girl',
    title: '성냥팔이 소녀',
    author: '김선희',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/성냥팔이 소녀 - 김선희.txt'),
  },
  {
    id: 'thumbelina',
    title: '엄지 공주',
    author: '김선희',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/엄지 공주 - 김선희.txt'),
  },
  {
    id: 'little-mermaid',
    title: '인어 공주',
    author: '김선희',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/인어 공주 - 김선희.txt'),
  },
  {
    id: 'gwangyeom-sonata',
    title: '광염 소나타',
    author: '김동인',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/광염 소나타 - 김동인.txt'),
  },
  {
    id: 'wings',
    title: '날개',
    author: '김해경',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/날개 - 김해경.txt'),
  },
  {
    id: 'city-and-ghost',
    title: '도시와 유령(幽靈)',
    author: '이효석',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/도시와 유령(幽靈) - 이효석.txt'),
  },
  {
    id: 'camellia-flower',
    title: '동백꽃',
    author: '김유정',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/동백꽃 - 김유정.txt'),
  },
  {
    id: 'when-buckwheat-flowers-bloom',
    title: '모밀꽃 필 무렵',
    author: '이효석',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/모밀꽃 필 무렵 - 이효석.txt'),
  },
  {
    id: 'mister-bang',
    title: '미스터 방(方)',
    author: '채만식',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/미스터 방(方) - 채만식.txt'),
  },
  {
    id: 'spring-spring',
    title: '봄 봄',
    author: '김유정',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/봄 봄 - 김유정.txt'),
  },
  {
    id: 'a-lucky-day',
    title: '운수 좋은 날',
    author: '현진건',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/운수 좋은 날 - 현진건.txt'),
  },
  {
    id: 'crime-and-punishment-lee-muyeong',
    title: '죄와벌',
    author: '이무영',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/죄와벌 - 이무영.txt'),
  },
  {
    id: 'taepyeongcheonha',
    title: '태평천하',
    author: '채만식',
    language: 'ko',
    source: SOURCE,
    textAsset: require('./books/태평천하 - 채만식.txt'),
  },
];

export const PUBLIC_DOMAIN_TEXTS = PUBLIC_DOMAIN_TEXTS_BASE.map((book, index) => ({
  ...book,
  previewSource: PREVIEW_SOURCE,
  attributionCategory: ATTRIBUTION_CATEGORY,
  titleTranslation: PUBLIC_DOMAIN_TITLE_TRANSLATIONS[book.id],
  authorTranslation: PUBLIC_DOMAIN_AUTHOR_TRANSLATIONS[book.id],
  coverColor: PUBLIC_DOMAIN_COVER_COLORS[index % PUBLIC_DOMAIN_COVER_COLORS.length],
  ...PUBLIC_DOMAIN_PREVIEW_METADATA[book.id],
}));
