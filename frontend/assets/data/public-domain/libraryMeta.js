// The English public library's books (Supabase public_library, keyed by id):
// a small cover (from each book's EPUB, so the shelf shows it before the book
// is downloaded), a genre and a short description, in the same style as the
// bundled books' catalog (catalog.js). A database row's own values win.

/* eslint-disable global-require */
export const LIBRARY_META = {
  'c823f7be-3337-48c6-b6e8-ef27cf401f29': {
    cover: require('./library-covers/c823f7be-3337-48c6-b6e8-ef27cf401f29.jpg'),
    genre: 'Classic novella / Christmas ghost story',
    snippet: 'On Christmas Eve the mean old businessman Ebenezer Scrooge is visited by the ghost of his dead partner and then by three spirits, who show him his past, his present and a future he does not want.\n\nA short, warm and often funny story about whether a hard heart can change in one night.',
  },
  'fd0b98b5-b5a0-4d11-872d-a019cb2d9f33': {
    cover: require('./library-covers/fd0b98b5-b5a0-4d11-872d-a019cb2d9f33.jpg'),
    genre: 'Classic novel / Historical fiction',
    snippet: 'London and Paris before and during the French Revolution: a doctor freed after years in prison, his loyal daughter, and two very different men who love her are pulled into the storm.\n\nDickens builds a story of sacrifice and second chances that ends with one of the most famous lines in English.',
  },
  'a88de2fb-e26a-49e4-8b2b-af927884a0b4': {
    cover: require('./library-covers/a88de2fb-e26a-49e4-8b2b-af927884a0b4.jpg'),
    genre: 'Fables / Short stories',
    snippet: 'Hundreds of very short tales in which foxes, lions, mice and crows act like people, each ending with a lesson: the fox and the grapes, the tortoise and the hare, the boy who cried wolf.\n\nEach fable takes a minute or two to read, which makes this a good book to read a little every day.',
  },
  '39f271f7-0b01-4264-8f06-5cc49d6a7f91': {
    cover: require('./library-covers/39f271f7-0b01-4264-8f06-5cc49d6a7f91.jpg'),
    genre: 'Children’s classic / Fantasy',
    snippet: 'Bored on a summer afternoon, Alice follows a white rabbit down a hole into Wonderland, where she grows and shrinks, argues with a caterpillar and plays croquet with the Queen of Hearts.\n\nFull of word games, nonsense poems and characters who never answer a question the way you expect.',
  },
  '8bf49a16-0a10-4094-8af9-4ad37ca43ee3': {
    cover: require('./library-covers/8bf49a16-0a10-4094-8af9-4ad37ca43ee3.jpg'),
    genre: 'Classic novel / Family and society',
    snippet: 'In Russian high society, Anna Karenina leaves a cold marriage for a passionate love, while the landowner Levin searches for meaning in work, faith and family life in the country.\n\nTolstoy’s long novel follows both lives side by side, with great attention to everyday feelings.',
  },
  '1688c985-d48d-447e-86c1-ff1d762fb3dd': {
    cover: require('./library-covers/1688c985-d48d-447e-86c1-ff1d762fb3dd.jpg'),
    genre: 'Children’s classic / Coming of age',
    snippet: 'An elderly brother and sister on Prince Edward Island ask for an orphan boy to help on their farm, but they get Anne Shirley: red-haired, talkative and full of imagination.\n\nA funny, kind story of a girl growing up and making a home.',
  },
  'c9daf231-91e4-40ec-a486-e23cd60f7d8a': {
    cover: require('./library-covers/c9daf231-91e4-40ec-a486-e23cd60f7d8a.jpg'),
    genre: 'Animal story / Nature',
    snippet: 'A young deer grows up in the forest, learning from his mother about the meadow, the seasons and the danger called Man.\n\nA quiet, often sad story told through the eyes of the animals, in short, simple chapters.',
  },
  'b8389225-b7d8-4ce0-abd8-6e6fc1d25536': {
    cover: require('./library-covers/b8389225-b7d8-4ce0-abd8-6e6fc1d25536.jpg'),
    genre: 'Classic novel / Psychological crime',
    snippet: 'Raskolnikov, a poor former student in St Petersburg, convinces himself that a crime can be justified, and then cannot escape what it does to his mind.\n\nMore a story about guilt and conscience than about solving a crime.',
  },
  '6a30cc6a-1fb1-47fb-9134-df0390399e95': {
    cover: require('./library-covers/6a30cc6a-1fb1-47fb-9134-df0390399e95.jpg'),
    genre: 'Classic novel / Gothic horror',
    snippet: 'The young scientist Victor Frankenstein builds a living being and then runs from what he has made. Alone and rejected, the creature learns to speak, to read, and to want revenge.\n\nThe first great science-fiction story asks who the real monster is.',
  },
  'a923eb9a-39a1-438f-a5f1-91737a3f4d73': {
    cover: require('./library-covers/a923eb9a-39a1-438f-a5f1-91737a3f4d73.jpg'),
    genre: 'Classic novella / Colonial journey',
    snippet: 'On a boat on the Thames, the sailor Marlow tells of his journey up a river in Africa to find Kurtz, an ivory trader rumoured to have become something terrible.\n\nShort but dense, with long sentences and a dark view of colonial greed.',
  },
  '83abcec7-15e8-4951-a240-561f25280225': {
    cover: require('./library-covers/83abcec7-15e8-4951-a240-561f25280225.jpg'),
    genre: 'Classic novel / Romance',
    snippet: 'Orphaned and mistreated as a child, Jane Eyre becomes a governess at Thornfield Hall, where she falls in love with its mysterious owner, Mr Rochester, and discovers the secret of the house.\n\nTold by Jane herself, honest and independent from the first page.',
  },
  '63c8fef9-915a-460f-9cbc-3297bf41ac82': {
    cover: require('./library-covers/63c8fef9-915a-460f-9cbc-3297bf41ac82.jpg'),
    genre: 'Classic novel / Historical fiction',
    snippet: 'Jean Valjean, released after nineteen years in prison for stealing bread, tries to start an honest life while the policeman Javert hunts him across France.\n\nA very long novel about mercy, poverty and revolution, with many side stories along the way.',
  },
  '8751d13a-a276-4daf-af3f-31fcbd8386ae': {
    cover: require('./library-covers/8751d13a-a276-4daf-af3f-31fcbd8386ae.jpg'),
    genre: 'Classic novel / Family',
    snippet: 'Four sisters, Meg, Jo, Beth and Amy, grow up in a small American town while their father is away at war, sharing little money and a lot of love.\n\nWarm everyday scenes about family, ambition and growing up.',
  },
  'fee9a36f-68ce-4440-85ef-846d6c2f8455': {
    cover: require('./library-covers/fee9a36f-68ce-4440-85ef-846d6c2f8455.jpg'),
    genre: 'Classic novel / Sea adventure',
    snippet: '“Call me Ishmael.” A sailor joins the whaling ship Pequod, whose Captain Ahab will chase the great white whale that took his leg, whatever the cost.\n\nAn adventure mixed with long chapters about whales and the sea; one of the hardest books in the library.',
  },
  '7a995b55-51f0-4924-bafd-315362bce492': {
    cover: require('./library-covers/7a995b55-51f0-4924-bafd-315362bce492.jpg'),
    genre: 'Children’s classic / Fantasy adventure',
    snippet: 'Peter Pan, the boy who never grows up, flies into the Darling children’s bedroom and takes Wendy and her brothers to Neverland, home of fairies, mermaids and Captain Hook.\n\nPlayful and sometimes surprisingly sad about growing older.',
  },
  'a85cf9af-1488-4a8c-9549-62cc3b2b0a41': {
    cover: require('./library-covers/a85cf9af-1488-4a8c-9549-62cc3b2b0a41.jpg'),
    genre: 'Classic novel / Romance',
    snippet: 'Elizabeth Bennet is clever and quick to judge; Mr Darcy is rich and proud. When they meet, each dislikes the other at once.\n\nA witty comedy about first impressions, marriage and money in English country society.',
  },
  '68d4b7ce-69ba-4585-985a-7fd5560f5540': {
    cover: require('./library-covers/68d4b7ce-69ba-4585-985a-7fd5560f5540.jpg'),
    genre: 'Classic novel / Adventure',
    snippet: 'Huck runs away from his violent father and floats down the Mississippi River on a raft with Jim, a man escaping slavery.\n\nTold in Huck’s own spoken American English, full of dialect and spelling as people talked.',
  },
  'a093aca5-5fe4-4190-be40-5b5419210e0d': {
    cover: require('./library-covers/a093aca5-5fe4-4190-be40-5b5419210e0d.jpg'),
    genre: 'Detective stories',
    snippet: 'Twelve cases for the detective Sherlock Holmes and his friend Dr Watson in Victorian London: a stolen photograph, a red-headed league, a speckled band.\n\nEach story is complete in itself, so you can read one at a time.',
  },
  '5f5e5d4d-ccd8-4b9d-9ec1-5ffb184bed7a': {
    cover: require('./library-covers/5f5e5d4d-ccd8-4b9d-9ec1-5ffb184bed7a.jpg'),
    genre: 'Classic nonfiction / Strategy',
    snippet: 'A short ancient Chinese book on how to plan, when to fight and when not to, and why the best victory needs no battle.\n\nThis translation adds many notes and commentaries around the thirteen short chapters.',
  },
  '2eaf8a67-c7c7-44e9-9ff2-92271686ac3c': {
    cover: require('./library-covers/2eaf8a67-c7c7-44e9-9ff2-92271686ac3c.jpg'),
    genre: 'Classic novel / Philosophical drama',
    snippet: 'Three very different brothers, passionate Dmitri, thoughtful Ivan and gentle Alyosha, and their selfish father, until a murder brings everything to court.\n\nLong conversations about faith, doubt and freedom; Dostoevsky’s last novel.',
  },
  '7316af04-52df-4c12-897a-eafa3e0db384': {
    cover: require('./library-covers/7316af04-52df-4c12-897a-eafa3e0db384.jpg'),
    genre: 'Adventure / Animal story',
    snippet: 'Buck, a big house dog in California, is stolen and sold as a sled dog during the Klondike gold rush, and must learn the hard law of the cold north.\n\nShort and fast-moving, told from the dog’s point of view.',
  },
  'f944d572-c517-40a8-9ac9-6dbe468b9773': {
    cover: require('./library-covers/f944d572-c517-40a8-9ac9-6dbe468b9773.jpg'),
    genre: 'Classic novel / Adventure and revenge',
    snippet: 'Betrayed on his wedding day and locked in an island prison, the young sailor Edmond Dantès escapes years later with a hidden treasure and a plan.\n\nA long, exciting story of disguise and revenge.',
  },
  '3d10f9b1-60d0-49cc-a6df-f0254138438d': {
    cover: require('./library-covers/3d10f9b1-60d0-49cc-a6df-f0254138438d.jpg'),
    genre: 'Play / Comedy',
    snippet: 'Two young gentlemen invent false identities to escape their duties, and both end up claiming the name Ernest to win the women they love.\n\nA short comedy in three acts, written almost entirely in quick, clever dialogue.',
  },
  '2293b630-3c92-4c5b-9222-f31790503a14': {
    cover: require('./library-covers/2293b630-3c92-4c5b-9222-f31790503a14.jpg'),
    genre: 'Epic / Ancient Greek myth',
    snippet: 'After the Trojan War, Odysseus spends ten years trying to sail home, meeting a one-eyed giant, a witch and singing sirens, while suitors fill his house and his son goes looking for him.\n\nAn old prose translation of Homer’s epic.',
  },
  '349d5bab-66b2-418d-a537-0ea8577320bc': {
    cover: require('./library-covers/349d5bab-66b2-418d-a537-0ea8577320bc.jpg'),
    genre: 'Classic novel / Gothic',
    snippet: 'A beautiful young man wishes that his portrait would grow old instead of him. The wish comes true, and Dorian lives as he likes while the painting shows what he becomes.\n\nWilde’s only novel, full of sharp, quotable lines.',
  },
  'd194c99e-ecb0-4f9c-aa42-001ab9903225': {
    cover: require('./library-covers/d194c99e-ecb0-4f9c-aa42-001ab9903225.jpg'),
    genre: 'Children’s classic',
    snippet: 'Lonely, spoiled Mary Lennox is sent to her uncle’s great house in Yorkshire, where she finds a locked garden, a robin, and a boy hidden away in a room.\n\nA gentle story about friendship and things coming back to life.',
  },
  'd0005a28-4eac-46e1-89f7-d540e532f298': {
    genre: 'Classic novella / Gothic mystery',
    snippet: 'In foggy London, the lawyer Utterson wonders why his respected friend Dr Jekyll is linked to the cruel and frightening Mr Hyde.\n\nShort and suspenseful; the answer comes at the end.',
  },
  'cd2aa35a-f340-47a5-a057-20f00d513b68': {
    cover: require('./library-covers/cd2aa35a-f340-47a5-a057-20f00d513b68.jpg'),
    genre: 'Children’s classic / Fantasy',
    snippet: 'A cyclone carries Dorothy and her dog Toto from Kansas to the Land of Oz. To get home she follows the yellow brick road with a Scarecrow, a Tin Woodman and a Cowardly Lion.\n\nSimple, clear English and short chapters.',
  },
  'b49d21d5-305c-4d91-8886-a30d8f21880e': {
    cover: require('./library-covers/b49d21d5-305c-4d91-8886-a30d8f21880e.jpg'),
    genre: 'Children’s classic / Stories',
    snippet: 'Winnie-the-Pooh, a bear of very little brain, and his friends Piglet, Eeyore, Owl and Rabbit have small adventures in the Hundred Acre Wood with Christopher Robin.\n\nGentle, funny chapters that each tell one adventure.',
  },
  '2ea64ae3-c4c3-4ed3-bed6-42b7e0961895': {
    cover: require('./library-covers/2ea64ae3-c4c3-4ed3-bed6-42b7e0961895.jpg'),
    genre: 'Picture book / Animal story',
    snippet: 'Peter Rabbit does not listen to his mother and goes into Mr McGregor’s garden, where he eats too much and is nearly caught.\n\nA very short picture book with simple sentences; a good first book.',
  },
  '32664538-146e-4b17-a259-0bf796d92736': {
    cover: require('./library-covers/32664538-146e-4b17-a259-0bf796d92736.jpg'),
    genre: 'Picture book / Animal story',
    snippet: 'Peter’s cousin Benjamin takes him back into Mr McGregor’s garden to get his lost clothes, and they meet the cat.\n\nA very short picture book, a sequel to The Tale of Peter Rabbit.',
  },
  '9ac26bf1-76e0-4e2d-a954-072a318c6000': {
    cover: require('./library-covers/9ac26bf1-76e0-4e2d-a954-072a318c6000.jpg'),
    genre: 'Picture book / Animal story',
    snippet: 'Jemima Puddle-Duck wants to hatch her own eggs in a quiet place, and a polite gentleman with a bushy tail offers to help.\n\nA very short picture book with a gentle lesson.',
  },
  '2d0049fc-a65c-436f-9876-45894fc88dfc': {
    cover: require('./library-covers/2d0049fc-a65c-436f-9876-45894fc88dfc.jpg'),
    genre: 'Reader / First stories',
    snippet: 'A school reader from 1906 for children’s first year of reading: short rhymes and stories about animals, games and the seasons, with many repeated words.\n\nThe easiest book in the English library.',
  },
  '76f8ec37-c69c-4272-95da-9e16d75aaad7': {
    cover: require('./library-covers/76f8ec37-c69c-4272-95da-9e16d75aaad7.jpg'),
    genre: 'Fables / Folk tales',
    snippet: 'Old stories from India about animals: a clever monkey, a foolish crocodile, a quail who outwits a hunter. Each tale teaches something about kindness or good sense.\n\nShort tales retold in simple English for young readers.',
  },
};
