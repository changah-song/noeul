"""Tests for the Phase 5 validation gate (backend/ml/validate_pknown.py).

Two things to pin down: (1) the pure §7.1 metrics are correct and degrade to None
(never a fabricated number) when a metric is undefined; (2) the end-to-end
acceptance — on the seeded synthetic stream the full model beats the baseline on
the segmented suite, and specifically its advantage concentrates in the
morphological-transfer segment the baseline is blind to (design doc §6).
"""

import numpy as np
import pytest

import train_pknown as t
import validate_pknown as v


# ── pure metrics ──────────────────────────────────────────────────────────────
def test_perfect_predictions_score_perfectly():
    y = np.array([0, 0, 1, 1])
    p = np.array([0.0, 0.0, 1.0, 1.0])
    assert v.brier(y, p) == pytest.approx(0.0)
    assert v.roc_auc(y, p) == pytest.approx(1.0)
    assert v.pr_auc(y, p) == pytest.approx(1.0)
    assert v.spearman(y, p) == pytest.approx(1.0)


def test_metrics_are_none_when_undefined_not_fabricated():
    # Single-class outcome → ROC/PR/Spearman are undefined; must be None, not 0/NaN.
    y = np.ones(5, dtype=int)
    p = np.array([0.2, 0.4, 0.5, 0.6, 0.9])
    assert v.roc_auc(y, p) is None
    assert v.pr_auc(y, p) is None
    assert v.spearman(y, p) is None
    # Brier still defined for one class (mean squared error vs the constant label).
    assert v.brier(y, p) == pytest.approx(np.mean((p - 1) ** 2))
    # Empty slice → everything None, no crash.
    empty = v.segment_metrics(np.array([]), np.array([]))
    assert empty["n"] == 0 and empty["brier"] is None and empty["roc_auc"] is None


def test_spearman_none_when_predictions_have_no_variance():
    y = np.array([0, 1, 0, 1])
    p = np.array([0.5, 0.5, 0.5, 0.5])
    assert v.spearman(y, p) is None


def test_calibration_table_bins_and_reports_empty_as_none():
    # All predictions land in the 0.7-0.8 bin; that bin's empirical rate is 1/2.
    y = np.array([1, 0])
    p = np.array([0.72, 0.78])
    table = v.calibration_table(y, p, bins=10)
    assert len(table) == 10
    hot = table[7]
    assert hot["count"] == 2
    assert hot["mean_predicted"] == pytest.approx(0.75)
    assert hot["empirical"] == pytest.approx(0.5)
    assert hot["gap"] == pytest.approx(0.5 - 0.75)
    # A bin with no samples reports None, not a fake 0.
    assert table[0]["count"] == 0 and table[0]["empirical"] is None and table[0]["gap"] is None


def test_calibration_prediction_of_one_lands_in_last_bin():
    table = v.calibration_table(np.array([1]), np.array([1.0]), bins=10)
    assert table[9]["count"] == 1  # not dropped off the top edge


def test_calibration_gap_ignores_underpopulated_bins():
    # One huge well-calibrated bin + one tiny wildly-off bin. The tiny bin is below
    # the min-count threshold, so it must not drive the reported worst gap.
    seg = {
        "n": 1000,
        "calibration": [
            {"count": 990, "gap": 0.02},
            {"count": 3, "gap": 0.9},   # underpopulated → ignored
        ],
    }
    assert v.calibration_gap(seg) == pytest.approx(0.02)


# ── overlap segmentation helper ───────────────────────────────────────────────
def test_overlap_only_counts_present_feature():
    present = {"vector": {v.OVERLAP_KEY: 0.5}, "mask": {v.OVERLAP_KEY: 1}}
    absent = {"vector": {v.OVERLAP_KEY: 0.0}, "mask": {v.OVERLAP_KEY: 0}}
    missing = {"vector": {}, "mask": {}}
    assert v._overlap_of(present) == pytest.approx(0.5)
    # A masked-out (imputed) feature is NOT bucketed as "no overlap".
    assert v._overlap_of(absent) is None
    assert v._overlap_of(missing) is None


# ── end-to-end acceptance ─────────────────────────────────────────────────────
def test_synthetic_full_model_beats_baseline_and_gate_reports_honestly():
    ds = t.synthetic_dataset(n_users=80, seed=42)
    report = v.evaluate(ds, seed=42)

    overall = report["segments"]["OVERALL"]
    # Full model beats the IRT baseline on every headline metric.
    assert overall["full"]["brier"] < overall["baseline"]["brier"]
    assert overall["full"]["roc_auc"] > overall["baseline"]["roc_auc"]
    assert overall["full"]["spearman"] > overall["baseline"]["spearman"]

    gate = report["gate"]
    assert gate["beats_baseline"] is True
    assert gate["improvement"] > 0
    # The gate still surfaces a concrete calibration gap number to judge trust by.
    assert gate["worst_calibration_gap"] is not None


def test_cold_and_warm_segments_are_both_populated():
    ds = t.synthetic_dataset(n_users=80, seed=42)
    report = v.evaluate(ds, seed=42)
    cold = report["segments"]["COLD (first-review §5.3)"]["full"]
    warm = report["segments"]["WARM (previously seen)"]["full"]
    # Recurring vocabulary → both first-review and repeat rows exist in the held-out set.
    assert cold["n"] > 0 and warm["n"] > 0
    assert cold["n"] + warm["n"] == report["segments"]["OVERALL"]["full"]["n"]


def test_transfer_advantage_concentrates_in_high_overlap_segment():
    """The hidden signal is BETA*overlap, invisible to the baseline. So the full
    model's Brier improvement over baseline should be LARGER where transfer is high
    than where there is none — the design-doc §6 morphological-transfer test."""
    ds = t.synthetic_dataset(n_users=80, seed=42)
    report = v.evaluate(ds, seed=42)
    high = report["segments"]["HIGH transfer (hanja overlap > 0)"]
    none = report["segments"]["NO transfer (overlap = 0)"]
    gain_high = high["baseline"]["brier"] - high["full"]["brier"]
    gain_none = none["baseline"]["brier"] - none["full"]["brier"]
    assert gain_high > gain_none


def test_single_class_dataset_raises_clear_error():
    ds = {
        "meta": {"featureKeys": ["user_theta", "kb_difficulty"], "categoricalKeys": []},
        "rows": [
            {"label": 1, "owner": f"u{i}", "cold": False,
             "vector": {"user_theta": 0.1 * i, "kb_difficulty": 0.0},
             "mask": {"user_theta": 1, "kb_difficulty": 1}, "categorical": {}}
            for i in range(12)
        ],
    }
    with pytest.raises(SystemExit):
        v.evaluate(ds)
