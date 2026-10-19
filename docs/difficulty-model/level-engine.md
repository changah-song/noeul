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

## Tuning knobs

All in `levelEngine.js`: `BAND_WEIGHT` (level vs frequency), `LOANWORD_EASE`,
`ITEM_VARIANCE`, `DRIFT_PER_DAY`, `WORD_PRIOR_VARIANCE`, `FAMILY_SHARE`,
`CHARACTER_SHARE`, `SIGNAL_WEIGHTS`, and `repeatWeight`. Change one, rerun the
evaluator on the pulled database, and compare the AUC and log loss.
