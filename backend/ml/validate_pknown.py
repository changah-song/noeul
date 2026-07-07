"""Phase 5 — validation gate for the pooled P(known) model.

This is the GATE the whole downstream roadmap hangs on (plan §Phase 5, design doc
§6–§7): before ANY behavior-changing consumer ships (heatmap, mining), we have to
be able to trust the number. Two tracks are kept explicitly separate — this file
is *only* track 7.1, "is P(known) correct?" Feature-effectiveness (does surfacing
it help) is a different question with a different design (randomized holdout, A/B)
and is not evaluated here.

WHAT THIS ADDS OVER train_pknown.py's inline check. The trainer already reports a
held-out Brier + a small calibration curve as its acceptance gate. Phase 5 turns
that into the full §7.1 diagnostic suite and runs it on BOTH the model and the
baseline over the *identical* held-out rows:

  5.1  Brier, calibration table, ROC-AUC, PR-AUC, Spearman rank correlation
  5.2  every metric segmented — cold (no history) vs. warm, and by
       morphological transfer (high hanja/root overlap vs. none), so cold-start and
       transfer accuracy are reported honestly, never blended into one flattering
       aggregate (plan §5.2, design doc §7.1 last bullet)
  5.3  first-review analysis — the COLD segment IS the clean, ground-truth-adjacent
       test (design doc §6): the prediction is made from pre-card state (feature
       assembly with vocab:null, §4.2) and compared to the first graded outcome, so
       nothing the model did could have changed the label.

NO TRAIN/SERVE SKEW. It reuses train_pknown.build_matrix / split_indices /
build_model, so "the model we validate" is fitted on the same held-out-by-user
split with the same estimator the trainer ships (and whose coefficients the device
serves, verified to 1e-9 by the coef-parity test). The baseline scored here is the
exact Phase 3 form, sigmoid(theta − difficulty), read straight from each row.

LABEL CHOICE (grounded deviation from the plan wording). Plan §5.1 also lists
"ROC/PR using lookup-triggered as the binary label, to tune the heatmap threshold."
That needs a NEGATIVE class of words that were *seen but not looked up* — i.e.
per-word exposure logging (the `dwell` channel), which was deliberately deferred to
Phase 6 (plan §1.4). Until that exists there is no honest negative class, so ROC/PR
here uses the unconfounded review-recall label (recalled = 1). Tuning the heatmap's
lookup threshold is revisited in Phase 6 once exposure events are logged.

GATE STATUS. On synthetic data this proves the harness end-to-end, but synthetic
numbers can never *pass* the gate — passing requires real pooled review outcomes,
which are still ~zero. The report says so plainly.

Pure metrics (brier / calibration_table / roc / pr / spearman / segment_metrics) so
they're unit-testable without fitting anything. Usage:
    venv/bin/python ml/validate_pknown.py --synthetic [--n-users 80] [--seed 42]
    venv/bin/python ml/validate_pknown.py --input dataset.json   # real export
"""

from __future__ import annotations

import argparse

import numpy as np
from scipy.stats import spearmanr
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score

import train_pknown as t

# The morphological-transfer feature (design doc §3) whose presence/strength §5.2
# segments on. Written by the JS feature assembler as item_cross_hanja_overlap.
OVERLAP_KEY = "item_cross_hanja_overlap"

# Gate thresholds. A calibration bin only counts toward the "well-calibrated"
# judgment once it holds enough samples to be meaningful; a bin's |empirical −
# predicted| gap above CALIB_GAP_TOL is a miscalibration flag.
CALIB_MIN_BIN_FRAC = 0.05   # bins with ≥5% of the segment's samples ...
CALIB_MIN_BIN_COUNT = 10    # ... or ≥10 rows, whichever is larger
CALIB_GAP_TOL = 0.10        # 10 percentage points


# ── pure metrics (design doc §7.1) ────────────────────────────────────────────
def brier(y: np.ndarray, p: np.ndarray):
    """Mean squared error of the probabilistic predictions (0 = perfect)."""
    if len(y) == 0:
        return None
    return float(brier_score_loss(y, p)) if len(np.unique(y)) > 1 else float(np.mean((p - y) ** 2))


def roc_auc(y: np.ndarray, p: np.ndarray):
    """Area under the ROC curve. Undefined (→ None) without both classes."""
    if len(y) == 0 or len(np.unique(y)) < 2:
        return None
    return float(roc_auc_score(y, p))


def pr_auc(y: np.ndarray, p: np.ndarray):
    """Average precision (area under precision-recall). Needs both classes."""
    if len(y) == 0 or len(np.unique(y)) < 2:
        return None
    return float(average_precision_score(y, p))


def spearman(y: np.ndarray, p: np.ndarray):
    """Rank correlation between prediction and outcome — does the ordering hold
    even where absolute calibration is off (matters for the heatmap, §7.1)? Needs
    variance on both sides."""
    if len(y) < 2 or len(np.unique(y)) < 2 or len(np.unique(p)) < 2:
        return None
    rho = spearmanr(p, y).correlation
    return None if rho is None or np.isnan(rho) else float(rho)


def calibration_table(y: np.ndarray, p: np.ndarray, bins: int = 10):
    """Equal-width probability bins; per bin, does the predicted rate match the
    empirical rate? THE key diagnostic (design doc §7.1): does the ~0.7 bucket
    resolve ~0.7 of the time? Empty bins report None, not a fake 0.

    Returns list of {bin_low, bin_high, count, mean_predicted, empirical, gap}.
    """
    edges = np.linspace(0.0, 1.0, bins + 1)
    out = []
    # Clamp so a prediction of exactly 1.0 lands in the last bin.
    idx = np.minimum(bins - 1, np.maximum(0, np.floor(np.asarray(p) * bins).astype(int))) if len(p) else np.array([], dtype=int)
    for b in range(bins):
        sel = idx == b
        n = int(sel.sum())
        mean_pred = float(np.mean(p[sel])) if n else None
        empirical = float(np.mean(y[sel])) if n else None
        out.append({
            "bin_low": float(edges[b]),
            "bin_high": float(edges[b + 1]),
            "count": n,
            "mean_predicted": mean_pred,
            "empirical": empirical,
            "gap": (empirical - mean_pred) if n else None,
        })
    return out


def segment_metrics(y: np.ndarray, p: np.ndarray, bins: int = 10) -> dict:
    """The full §7.1 suite for one slice of (y, p)."""
    y = np.asarray(y)
    p = np.asarray(p)
    return {
        "n": int(len(y)),
        "base_rate": float(y.mean()) if len(y) else None,
        "brier": brier(y, p),
        "roc_auc": roc_auc(y, p),
        "pr_auc": pr_auc(y, p),
        "spearman": spearman(y, p),
        "calibration": calibration_table(y, p, bins),
    }


# ── gate judgment ─────────────────────────────────────────────────────────────
def calibration_gap(seg: dict):
    """Worst |empirical − predicted| gap among well-populated bins (or None if no
    bin is populated enough to judge)."""
    n = seg["n"]
    threshold = max(CALIB_MIN_BIN_COUNT, CALIB_MIN_BIN_FRAC * n)
    gaps = [abs(b["gap"]) for b in seg["calibration"]
            if b["count"] >= threshold and b["gap"] is not None]
    return max(gaps) if gaps else None


def gate_status(full: dict, base: dict) -> dict:
    """The go/no-go summary for the OVERALL segment. 'beats baseline' AND
    'well-calibrated' are necessary but NOT sufficient to pass on synthetic data —
    the caller still prints the real-data caveat."""
    beats = full["brier"] is not None and base["brier"] is not None and full["brier"] < base["brier"]
    worst_gap = calibration_gap(full)
    well_calibrated = worst_gap is not None and worst_gap <= CALIB_GAP_TOL
    return {
        "beats_baseline": bool(beats),
        "full_brier": full["brier"],
        "baseline_brier": base["brier"],
        "improvement": (base["brier"] - full["brier"]) if (full["brier"] is not None and base["brier"] is not None) else None,
        "worst_calibration_gap": worst_gap,
        "well_calibrated": bool(well_calibrated),
    }


# ── segmentation ──────────────────────────────────────────────────────────────
def _overlap_of(row: dict):
    """Morphological-transfer overlap for a row: its value only when the feature
    was actually PRESENT (mask 1). Absent → None so we don't bucket a missing
    feature as 'no overlap'."""
    present = bool(row.get("mask", {}).get(OVERLAP_KEY))
    if not present:
        return None
    v = row.get("vector", {}).get(OVERLAP_KEY)
    return float(v) if v is not None else None


def _segments(y: np.ndarray, cold: np.ndarray, overlap: np.ndarray):
    """Boolean masks for each reported slice. HIGH/NO-overlap only cover rows where
    the overlap feature is present (NaN excluded from both), so their n's need not
    sum to the overall n — that coverage gap is itself reported."""
    has_overlap = ~np.isnan(overlap)
    return {
        "OVERALL": np.ones(len(y), dtype=bool),
        "COLD (first-review §5.3)": cold,
        "WARM (previously seen)": ~cold,
        "HIGH transfer (hanja overlap > 0)": has_overlap & (overlap > 0),
        "NO transfer (overlap = 0)": has_overlap & (overlap == 0),
    }


# ── top-level evaluation ──────────────────────────────────────────────────────
def evaluate(dataset: dict, seed: int = 42, bins: int = 10) -> dict:
    """Fit the model on a held-out-by-user split, then score the full model and the
    IRT baseline on the SAME test rows and compute the segmented §7.1 suite for
    each."""
    X, y, groups, baseline_p, columns = t.build_matrix(dataset)
    if len(np.unique(y)) < 2:
        raise SystemExit(
            "Validation data has only one outcome class — need both recalled (1) and "
            "lapsed (0) reviews. (Got %d rows, all label=%d.)" % (len(y), int(y[0]))
        )

    train_idx, test_idx = t.split_indices(X, y, groups, seed)
    model = t.build_model(seed)
    model.fit(X[train_idx], y[train_idx])

    y_test = y[test_idx]
    p_full = model.predict_proba(X[test_idx])[:, 1]
    p_base = baseline_p[test_idx]

    # Per-test-row segmentation flags, pulled from the ORIGINAL rows (build_matrix
    # preserves row order, so test_idx indexes dataset["rows"] 1:1).
    rows = dataset["rows"]
    cold = np.array([bool(rows[i].get("cold")) for i in test_idx])
    overlap = np.array([_overlap_of(rows[i]) if _overlap_of(rows[i]) is not None else np.nan
                        for i in test_idx], dtype=float)

    segments = _segments(y_test, cold, overlap)
    report = {"segments": {}}
    for name, mask in segments.items():
        report["segments"][name] = {
            "full": segment_metrics(y_test[mask], p_full[mask], bins),
            "baseline": segment_metrics(y_test[mask], p_base[mask], bins),
        }

    overall = report["segments"]["OVERALL"]
    report["meta"] = {
        "source": dataset.get("meta", {}).get("source"),
        "n_users": int(len(set(groups))),
        "n_train": int(len(train_idx)),
        "n_test": int(len(test_idx)),
        "n_features": len(columns),
        "overlap_coverage": float(np.mean(~np.isnan(overlap))) if len(overlap) else 0.0,
        "bins": bins,
    }
    report["gate"] = gate_status(overall["full"], overall["baseline"])
    return report


# ── reporting ─────────────────────────────────────────────────────────────────
def _f(v, d=4):
    return "  —   " if v is None else f"{v:.{d}f}"


def _pct(v):
    return "  —  " if v is None else f"{v * 100:5.1f}%"


def _format_calibration(rows) -> str:
    lines = ["    bin        n    pred   actual   gap"]
    any_row = False
    for r in rows:
        if not r["count"]:
            continue
        any_row = True
        label = f"{r['bin_low']:.1f}-{r['bin_high']:.1f}".ljust(9)
        gap = r["gap"]
        sign = "+" if (gap is not None and gap >= 0) else ""
        lines.append(
            f"    {label} {r['count']:4d}  {_f(r['mean_predicted'], 3)}  "
            f"{_f(r['empirical'], 3)}  {sign}{_f(gap, 3)}"
        )
    if not any_row:
        lines.append("    (no samples)")
    return "\n".join(lines)


def _format_pair(name: str, pair: dict) -> str:
    full, base = pair["full"], pair["baseline"]
    head = (
        f"── {name}  (n={full['n']}, base rate={_pct(full['base_rate'])})\n"
        f"            Brier   ROC-AUC  PR-AUC  Spearman\n"
        f"   full   {_f(full['brier'])}  {_f(full['roc_auc'])}  {_f(full['pr_auc'])}  {_f(full['spearman'])}\n"
        f"   base   {_f(base['brier'])}  {_f(base['roc_auc'])}  {_f(base['pr_auc'])}  {_f(base['spearman'])}"
    )
    return f"{head}\n  full-model calibration:\n{_format_calibration(full['calibration'])}"


def format_report(report: dict) -> str:
    m = report["meta"]
    g = report["gate"]
    lines = [
        "══════════════════════════════════════════════════════════════",
        " Phase 5 — P(known) validation gate  (track 7.1: is it correct?)",
        "══════════════════════════════════════════════════════════════",
        f" source: {m['source']}   held-out users: {m['n_users']}   "
        f"train/test rows: {m['n_train']}/{m['n_test']}",
        f" features: {m['n_features']}   morphological-transfer coverage: {_pct(m['overlap_coverage'])}",
        "",
        " Lower Brier is better; ROC/PR/Spearman higher is better.",
        " 'base' = IRT baseline sigmoid(theta − difficulty); 'full' = pooled model.",
        "",
    ]
    for name, pair in report["segments"].items():
        lines.append(_format_pair(name, pair))
        lines.append("")

    verdict = "BEATS baseline" if g["beats_baseline"] else "does NOT beat baseline"
    calib = "within tolerance" if g["well_calibrated"] else "OUTSIDE tolerance / too few samples"
    lines += [
        "──────────────────────────────────────────────────────────────",
        " GATE (overall segment)",
        f"   full Brier {_f(g['full_brier'])} vs baseline {_f(g['baseline_brier'])}"
        f"  →  {verdict} ({_f(g['improvement'])})",
        f"   worst calibration gap: {_f(g['worst_calibration_gap'], 3)}  →  {calib}",
        "",
        " NOTE: passing this gate for real requires real pooled review outcomes.",
        " Synthetic runs prove the harness only — they cannot certify trust.",
        " Do not build a behavior-changing consumer (Phase 6+) on a synthetic pass.",
        "══════════════════════════════════════════════════════════════",
    ]
    return "\n".join(lines)


# ── data loading + CLI ────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser(description="Validate the pooled P(known) model (Phase 5).")
    ap.add_argument("--input", help="dataset JSON from exportFeatureDataset.js")
    ap.add_argument("--synthetic", action="store_true", help="use the seeded synthetic generator")
    ap.add_argument("--n-users", type=int, default=80)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--bins", type=int, default=10)
    args = ap.parse_args()

    if args.input:
        dataset = t.load_dataset(args.input)
    elif args.synthetic:
        dataset = t.synthetic_dataset(n_users=args.n_users, seed=args.seed)
    else:
        ap.error("provide --input <dataset.json> or --synthetic")

    report = evaluate(dataset, seed=args.seed, bins=args.bins)
    print(format_report(report))


if __name__ == "__main__":
    main()
