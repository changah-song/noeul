# Level engine (difficulty model v2)

*2026-10-19. Code: `frontend/services/levelEngine.js`. Follows
[phase1-baseline.md](phase1-baseline.md).*

## What changed

| | Before | Now |
|---|---|---|
| Reader's level | one number, fixed step sizes | a belief: level ± uncertainty; early signals move it a lot, later ones little; uncertainty grows slowly between sessions |
| Lookups and words read past | fixed −0.1 / +0.01 nudges | one model: P(look up) = 0.03·P(known) + habit·(1 − P(known)), with the reader's own lookup habit learned |
| Word difficulty | level band (or Korean percentile) | band blended 50/50 with how common the word is (Zipf); Korean loanwords 0.8 easier |
| One word's knowledge | evidence counts on a fixed scale | its own offset from the level, replayed from its history with forgetting; shares with its Korean word family (공부 ↔ 공부하다) or, for Chinese, its least-known character |
| Ground truth | none | the word check: ~28 real words picked around the level + 8 made-up words |
| Why the level moved | not recorded | `ability_log`: one row per change, uploaded for the admin dashboard |

## How a signal moves the level

Every signal is a yes/no observation with its own error rates:

| Signal | Observed | P(yes \| known) | P(yes \| unknown) |
|---|---|---|---|
| lookup / word read past | looked it up | 0.03 | the reader's lookup habit |
| word check | said "I know it" | 0.97 | guess rate (made-up words claimed) |
| review | recalled | 0.9 | 0.35 |

The level's belief is updated exactly on a 61-point grid and matched back to a
mean and variance. Each word's listed difficulty is treated as approximate
(`ITEM_VARIANCE` 0.6), which flattens the curve the level is learned through.

**The lookup habit.** From reading alone, "rarely looks words up" can mean
"knows more" or "taps less". A single running estimate locked in its early
guess and dragged the level with it. So the engine keeps 18 level beliefs, one
per habit from 7.5% to 92.5%, updates all of them, and weighs each by how well
it predicted the reader. Word checks and reviews don't depend on the habit, so
they settle it.

**Repeats.** A word the reader has already looked up or read past counts less
toward the overall level (`1 / (1 + n/3)`), so the same common word on every
page doesn't outvote the rest. The word's own knowledge still updates fully.
Words read past are credited once a day, all of them (not the first 5 per page),
and not while listen mode reads aloud.

## Simulation results

`node scripts/levelEngineEval.js --demo`: three simulated readers, 2,500 events
each, with known true level and lookup habit; every model predicts before each
event.

| | previous | engine |
|---|---|---|
| Reading: AUC of "will look it up" | 0.743 | 0.785 |
| Word check: AUC of "knows it" | 0.855 | 0.899 |

Recovered level (true → estimated): 0.8 → 0.68, 0.2 → 0.18, −1.4 → −1.60.
Recovered habit: 0.80 → 0.85, 0.25 → 0.24, 0.50 → 0.48.

Over 8 random runs per reader type (reading only, word difficulty noisy by ±1.2),
the error is 0.1–0.4 on the −3…+3 scale, and the true level falls within ±2
reported standard deviations in 47 of 48 runs. The hard case is a strong reader
who rarely taps: reading alone leaves them about ±0.4 uncertain, and ~30 word-check
answers fix it.

## Checking it on real data

1. Pull the phone database (debug build swap, `run-as … cat files/SQLite/fluentfable.db`).
2. `node scripts/levelEngineEval.js --sqlite <db>`: the same comparison on real
   events. Word-check answers are the clean labels; take the word check in each
   language first.
3. The admin dashboard's **Level model** page (`dashboard/level.html`) shows the
   uploaded `ability_log`: level over time, what moved it, every change with its
   word, and the calibration check across readers. Apply
   `supabase/user_ability_log.sql` once to enable it.

## Fixes from real data (2026-11-03)

The first long real log (one Chinese reader, 2,906 level changes over two
weeks, uploaded `ability_log`) showed the level falling from about HSK 4.6 to
HSK 1.6 while the reader said "know" to all 28 word-check words. Four causes:

| Problem | Fix |
|---|---|
| The word check widened only the mixed summary of the level, not the 18 habit beliefs the signals update (each was at variance ≈ 0.05). 28 "know" answers moved the level +0.55 and every word asked was HSK 1. | `widenState` widens every habit; a check starts at `CHECK_START_VARIANCE` = 2.0. |
| Words read past are logged only for underlined words, but lookups for every word. The easiest words (的, 了, 我们) looked "always looked up": 120 such lookups cost −12.6. | `lookupCountsForLevel`: a lookup moves the level only when the word would be underlined (P(known) < 0.85). It still teaches the word's own knowledge. Lifted once every word read past is logged. |
| The same word tapped again within minutes counted every time (150 repeats). | A word's lookup counts once a day, like words read past. |
| Re-weighing the habits moved the mixed level against the signal: 780 words read past lowered it. | The part of the shift that goes against the signal is undone. |

`LOOKUP_GIVEN_KNOWN` also rose from 0.03 to 0.10: readers tap known words for
the pinyin, the audio or the sentence translation. On this log 0.15 scored
better still; the right value differs by reader, so it should be learned.

**Replay on real logs.** `node scripts/levelReplay.js --log reader.json
--engine old.js --engine services/levelEngine.js --app` scores engine versions
on the same uploaded log (the Level model page's `admin_level_model` data):
predictions before each lookup, word read past, check answer and review, plus
each check answer predicted from the level just before the check (from
reading alone). On the log above:

| | before | after |
|---|---|---|
| Check answers predicted from reading alone (all were "know") | 0.41 | 0.71 |
| Their log loss | 0.91 | 0.35 |
| Level at the end | −2.48 (HSK 1.5) | +0.48 (HSK 4.5) |

Reading AUC stays near 0.5 on this log: among underlined words, listed
difficulty barely predicts what this reader taps. That is the next thing to
fix (word difficulty, and logging every word read past).

## Measuring it (2026-11-03)

**Every word read past is observable.** The reader only reports words read
past for words it is given, and it was given the underlined ones. Now a fixed
25% of words (`services/levelSample.js`, by a hash of the dictionary form)
are also sent as *exposure-only* terms when they aren't underlined: native
matches them separately from the level underlines, never draws them, never
makes them tappable as marks, and only adds them to `onExposure`. Their
lookups count toward the level too (`lookupCountsForLevel`), so for these
words both outcomes are logged and P(look up | known) can be measured. Words
that are underlined but not shown (marks off, or below the marks threshold)
are sent as exposure-only as well. Underlined and exposure-only words are
capped separately per unit (40 each).

**Each level-log row names its engine.** `ability_log.details.engine` =
`LEVEL_ENGINE_VERSION` (2.1 from this change).

**What a tap was for.** `lookup_detail` events: `value_num` = seconds the
word card stayed open, `grade` = flags (1 = saved). Recorded only for now; the
engine will use them to tell a glance (pinyin, sentence translation) from a
real lookup.

**Replay.** `scripts/levelReplay.js --sampled` replays a log recorded with
the sample on, so sampled words' lookups count as they do in the app. Older
logs (before 2.1) must be replayed without it.

## Batch refit (engine 2.2)

`services/levelRefit.js` sets the level from the whole recent log (180 days)
at once, after each reading session and when the app opens
(`levelRefitScheduler.js`; at most every 30 minutes, every 2 after a session).
The online updates carry on from its result in between.

    P(known)   = sigmoid(ITEM_SLOPE · (θ − difficulty))
    P(look up) = h · P(known) + r · (1 − P(known))
    word check, reviews: as in the online engine

Learned per reader: θ, r (taps on unknown words) and h (taps on known words,
prior mean 0.1). Each signal is weighted by age (half-life 90 days), repeats
(`repeatWeight`) and session (one day's reading of one book counts at most 40
signals). θ, r and h are fitted by EM; the level's uncertainty is read off its
posterior on a grid, **averaged over r**: from reading alone, a strong reader
who rarely taps and a weaker one who taps more explain the same log almost
equally well, and fixing r at its best fit reported such readers far too sure.
The level is never reported surer than sd 0.25.

**Which lookups count.** A lookup counts only when reading past the same word
was being logged then. The reader now records that on each lookup
(`interaction_events.grade`: 1 underlined, 2 sampled known word, 0 neither,
from `levelMarkFor` in Read.js), and the online engine uses it too. Older
lookups lack it; they count when the word has been seen read past at all
(biased upward, since a hard word tapped every time never is, but every
level-based rule was worse on real data). They fade with age.

**Simulated readers** (20 days of 150 signals, known θ, r, h): 34 of 36 within
2 reported standard deviations; r and h recovered to ±0.1 / ±0.07 when the
level is identifiable. ~80 ms per fit (signals are grouped by kind, outcome
and difficulty to 0.05).

**On the real Chinese log** (`levelReplay.js --engine refit`, refit before each
day from the days before):

| | 2.0 shipped | 2.1 online | 2.2 refit |
|---|---|---|---|
| Check answers predicted from reading alone (all "know") | 0.41 | 0.71 | 0.93 |
| Their log loss | 0.91 | 0.35 | 0.08 |
| Level at the end | −2.48 ± 0.21 | +0.48 ± 0.34 | +1.82 ± 0.72 |
| Learned tap rates (unknown / known) | – | – | 0.21 / 0.07 |

On words logged both ways, reading AUC is about 0.5 for every version: listed
difficulty barely predicts which words this reader taps, so reading alone
cannot place them closely. The refit says so (±0.72); better word difficulty
is what tightens it.

## Word difficulty and translations (engine 2.3)

**Words shown with a translation aren't evidence.** On the real Chinese log,
among underlined words the reader tapped 16–23% at every HSK level from 3 to 7
and for unlisted words alike: listed difficulty predicted nothing (AUC 0.50).
The reader shows a short translation under every underlined word (the default
for new readers, `glossAnnotations`). With the meaning printed under it,
reading past a word doesn't mean it was known, and tapping it means "more than
the translation", not "unknown". Such words are no longer credited as read
past (`selectExposureCredits` `glossed`), and their lookups carry level mark 3
(`levelSample.LEVEL_MARK.glossed`), which neither the online update nor the
refit counts. The sampled known words (not underlined, so not translated) and
untranslated underlined words still are. Pinyin alone doesn't exclude a word.

**Chinese compounds from their parts** (`compoundDifficulty`, used by
`getWordDifficulties` and the underline snapshot alike): verb + complement
(吃掉, 塞进, 铐起来) is its head + 0.2; a three-character compound (面包店,
野孩子) is its harder part + 0.4. Four-character words (mostly idioms) are left
alone, a compound is never made harder, and a word with its own difficulty is
lowered by at most 1.5 (想开 "get over it" is not think + open). On the log
this changed 710 of 2,892 signals' difficulties (捕到 3.00 → 1.71, 卖掉
0.82 → −0.68).

**HSK 7–9 by frequency.** HSK 3.0 levels 7–9 are one band of 9,085 words,
which the scale put at +3. Within it the band position now follows frequency,
from +2 (Zipf ≥ 5, the HSK 6 position) to +3 (Zipf ≤ 3), before the usual
50/50 blend with frequency.

**Not yet validated.** Replayed on the log, the new difficulties change
nothing measurable (reading AUC 0.513 → 0.511), as expected: almost all of it
was read with translations shown. Logs recorded from 2.3 on, where reading
past and tapping mean what the model assumes, are what will show whether
these help; the penalties (0.2, 0.4, 1.5) are first guesses to tune then.

## Tuning knobs

All in `levelEngine.js`: `BAND_WEIGHT` (level vs frequency), `LOANWORD_EASE`,
`ITEM_VARIANCE`, `DRIFT_PER_DAY`, `WORD_PRIOR_VARIANCE`, `FAMILY_SHARE`,
`CHARACTER_SHARE`, `SIGNAL_WEIGHTS`, and `repeatWeight`. Change one, rerun the
evaluator on the pulled database, and compare the AUC and log loss.
