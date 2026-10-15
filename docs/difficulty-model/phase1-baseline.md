# Word-difficulty personalization — phase 1: measure the baseline

*2026-10-15. Numbers from one real device (the developer's Galaxy S25), exported
with `node scripts/baselineMetric.js --sqlite <fluentfable.db>`.*

## What decides an underline today

One number per user (`theta`, ability on a −3…3 scale) against one number per
word (its NIKL / HSK band, spread evenly on the same scale):
`P(known) = sigmoid(theta − band)`. A word is underlined when P is below 0.85,
shaded darker towards P = 0.15. Nothing else reaches the underline: not whether
the word was saved, looked up, reviewed, or how often it appears.

`theta` moves on: flashcard review (±0.3), dictionary lookup (−0.1), "read past
without tapping" exposure (+0.01), the calibration quiz (±0.5, but no screen
opens it). New profiles start at 0.

## What the device's data shows

| | ko | zh |
|---|---|---|
| exposures (read past, not tapped) | 33 | 344 |
| lookups | 106 | 40 |
| saves | 3 | 1 |
| graded reviews | 1 | 0 |
| theta now | −0.35 | +0.59 |

**There is no labelled ground truth yet.** One review in 528 events, so the
Brier / calibration section of the report (built for reviews) is empty.

### Bug: lookups never updated ability

Lookups were logged with the tapped surface as the stem (공동묘지로, 그가,
활극이…), but ability updates and the evaluation match words by their
dictionary stem (공동묘지, 그, 활극). **93 of 146 lookups (64%) matched nothing**,
so they neither moved `theta` nor count in any evaluation. Exposures use the
underline surfaces, which are stems, and all 377 matched.

Fixed in this phase: the lookup event and the ability update now carry the stem
the lookup resolved (`services/dictionaryLookup.js`). From here on lookups are
usable signal.

### Behavioural separation (new metric)

Reviews are rare; lookups and exposures are not. A model that cannot at least
rank looked-up words below read-past words is not working, so the evaluator
now scores that ranking with ROC-AUC, predicting each event before folding it
in (and folding exposures the way the device does, which the replay did not).

```
BEHAVIOR — lookups (0) vs exposures (1), graded words: n=405 (lookups=28, exposures=377; ungraded skipped: 118)
  AUC=0.256   (0.5 = chance, 1 = every lookup ranked below every exposure)
  mean P(known): lookups=0.678  exposures=0.408
  confident misses (looked up with P ≥ 0.85, i.e. not underlined): 15
```

**The baseline ranks the words the reader looked up as more known than the
words they read past.** Two reasons, both informative:

1. Exposures are only credited for underlined words (P between 0.15 and 0.85,
   nearest 0.5 first), so their mean P is ~0.4 by construction. This biases
   the AUC downwards; it is still the right direction to watch.
2. Of the lookups that matched a graded word, most were easy-band words (了,
   그…): the hard content words were the unmatched 64%, and the easy ones are
   often tapped out of curiosity rather than ignorance. 15 lookups were on
   words the model was confident enough about to leave unmarked.

With the stem fix in place the lookup class will fill with the hard words, and
this metric becomes meaningful. Re-run after a week of reading.

## What phase 2 should change (in order of expected effect)

1. **Per-word evidence in the underline.** Blend `theta` with the word's own
   history: looked up recently → darker; reviewed well → known; saved → the
   learner is working on it. Today a word looked up five times is shaded
   exactly like its band-mates.
2. **Underline ungraded words.** The design treats a word outside the graded
   lists as hardest, but the SQL pre-filter requires a band, so the rarest
   words — the ones a learner most needs marked — get nothing.
3. **Use the fine-grained percentile** (`difficulty_percentile`) instead of the
   band: bands are wildly uneven (514 words in Korean band 1 vs 8,216 in band
   6) but spaced evenly on the scale.
4. **Cold start:** wire the vocabulary-size grid into profile creation so a
   new reader does not start as "average" (`theta = 0`).
5. **Then** a real model: once lookups and reviews accumulate, train the
   existing logistic pipeline on them and gate it on beating this baseline's
   AUC and Brier.

## How to re-run

```bash
# pull the device database (debug build; the release build is not debuggable)
adb -s <serial> shell run-as com.noeulapp.Noeul cat files/SQLite/fluentfable.db > /tmp/fluentfable.db
cd frontend && node scripts/baselineMetric.js --sqlite /tmp/fluentfable.db
```

`@babel/register` is now a dev dependency so the script runs without extra setup.


---

# Phases 2 and 3 (2026-10-16)

## Phase 2 — per-word evidence, ungraded words, percentile difficulty

Shipped in PR #77. The underline now uses:

- the word's **difficulty percentile** when known (bands are very uneven);
- **ungraded words** (outside NIKL/HSK) as the hardest band instead of never;
- **per-word evidence** (`services/wordEvidence.js`): recent lookups (30-day
  half-life, diminishing repeats, floor −2.4 logits), read-past exposures
  (+0.12 each, cap +1.2), graded reviews (±0.8 each, cap ±2.5), saves (−0.4).

Measured with the evaluator's new `--evidence` replay on the same device
log (now 494 graded behaviour samples):

| | baseline | + evidence |
|---|---|---|
| AUC (lookups vs exposures) | 0.261 | **0.305** |
| mean P(known) of looked-up words | 0.678 | 0.643 |
| mean P(known) of read-past words | 0.418 | 0.454 |
| confident misses (looked up, P ≥ 0.85) | 15 | **11** |

Still below chance for the sampling reasons in phase 1 (exposures are only
credited for underlined words; the hard lookups were unmatched before the
stem fix), but every number moved the right way. Re-run after a week of
reading with the stem fix in place:

```bash
cd frontend
node scripts/baselineMetric.js --sqlite /tmp/fluentfable.db            # baseline
node scripts/baselineMetric.js --sqlite /tmp/fluentfable.db --evidence # phase 2
```

## Phase 3 — cold start

Also in PR #77: the vocabulary-size grids are regenerated on the current
6-band Korean scale and added for Chinese (HSK 1–7), the picker is reachable
from Profile → Learning language → Vocabulary level, and it is offered once on
the first book open for a profile with no history.

## Phase 4 — a trained model (not started)

Blocked on data: one graded review on the only device. With lookups now
logged by stem, a week of reading gives a few hundred usable lookup/exposure
pairs; reviews need the flashcard flow to be used. Then: export with
`scripts/exportFeatureDataset.js`, train with `backend/ml/train_pknown.py`,
bundle the coefficient JSON and register it with `setActivePknownModel` at
startup, gated on beating the phase-2 numbers above.
