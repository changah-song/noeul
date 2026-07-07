"""Tests for the Phase 4.2 training pipeline (backend/ml/train_pknown.py).

The acceptance check from the plan is the headline test here: a versioned model
artifact is produced AND its calibration beats the Phase 3 IRT baseline on a
held-out slice. The rest pin down the plumbing — matrix construction with
explicit missingness masks, artifact versioning, and rollback.
"""

import json

import numpy as np
import pytest

import train_pknown as t


def test_synthetic_model_beats_baseline_and_versions_artifact(tmp_path):
    ds = t.synthetic_dataset(n_users=60, seed=42)
    meta = t.train(ds, str(tmp_path), seed=42)

    # Acceptance: the full model beats the IRT baseline on held-out data.
    assert meta["metrics"]["full_brier"] < meta["metrics"]["baseline_brier"]
    assert meta["metrics"]["improvement"] > 0

    # A versioned artifact + meta + current pointer were written.
    assert (tmp_path / "model_v1.joblib").exists()
    assert (tmp_path / "model_v1.meta.json").exists()
    current = json.loads((tmp_path / "current.json").read_text())
    assert current["version"] == 1
    assert current["model"] == "model_v1.joblib"


def test_versions_increment_and_rollback_repoints_current(tmp_path):
    ds = t.synthetic_dataset(n_users=40, seed=1)
    t.train(ds, str(tmp_path), seed=1)          # v1
    t.train(ds, str(tmp_path), seed=2)          # v2
    current = json.loads((tmp_path / "current.json").read_text())
    assert current["version"] == 2              # newest run is current

    t.rollback(str(tmp_path), 1)                # roll back to v1
    current = json.loads((tmp_path / "current.json").read_text())
    assert current["version"] == 1
    # Both artifacts still exist (rollback repoints, never deletes).
    assert (tmp_path / "model_v1.joblib").exists()
    assert (tmp_path / "model_v2.joblib").exists()


def test_rollback_to_missing_version_errors(tmp_path):
    t.train(t.synthetic_dataset(n_users=20, seed=3), str(tmp_path), seed=3)
    with pytest.raises(SystemExit):
        t.rollback(str(tmp_path), 99)


def test_build_matrix_keeps_mask_columns_and_computes_baseline():
    dataset = {
        "meta": {"featureKeys": ["user_theta", "kb_difficulty", "item_cross_hanja_overlap"],
                 "categoricalKeys": ["item_pos"]},
        "rows": [
            {"label": 1, "owner": "a",
             "vector": {"user_theta": 1.0, "kb_difficulty": -1.0, "item_cross_hanja_overlap": 0.5},
             "mask": {"user_theta": 1, "kb_difficulty": 1, "item_cross_hanja_overlap": 1},
             "categorical": {"item_pos": "noun"}},
            {"label": 0, "owner": "b",
             "vector": {"user_theta": -1.0, "kb_difficulty": 1.0, "item_cross_hanja_overlap": 0.0},
             "mask": {"user_theta": 1, "kb_difficulty": 1, "item_cross_hanja_overlap": 0},
             "categorical": {"item_pos": "verb"}},
        ],
    }
    X, y, groups, baseline_p, columns = t.build_matrix(dataset)

    assert list(y) == [1, 0]
    assert set(groups) == {"a", "b"}
    # Baseline P = sigmoid(theta - difficulty); row0 theta 1, diff -1 → sigmoid(2).
    assert baseline_p[0] == pytest.approx(1 / (1 + np.exp(-2.0)))
    # A one-hot categorical column exists; the always-1 masks were dropped as
    # zero-variance, but the varying overlap mask is retained.
    assert any(c.startswith("cat::item_pos=") for c in columns)
    assert "mask::item_cross_hanja_overlap" in columns


def test_exported_coefficients_reproduce_predict_proba():
    """The device (JS) evaluates sigmoid(intercept + Σ W·x_raw) on RAW features.
    That must equal the fitted StandardScaler+LogisticRegression predict_proba, or
    the served scores would silently diverge from the validated ones."""
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    rng = np.random.default_rng(0)
    X = rng.normal(size=(200, 4)) * np.array([1.0, 5.0, 0.2, 3.0])  # varied scales
    y = (X[:, 0] - 0.5 * X[:, 1] + X[:, 3] + rng.normal(0, 0.3, 200) > 0).astype(int)
    columns = ["val::a", "val::b", "val::c", "val::d"]

    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
    model.fit(X, y)

    coef = t.export_linear_model(model, columns, version=1)
    W = np.array([coef["weights"][c] for c in columns])
    B = coef["intercept"]

    manual = 1.0 / (1.0 + np.exp(-(X @ W + B)))
    sklearn_p = model.predict_proba(X)[:, 1]
    # Fold is exact up to float error.
    assert np.allclose(manual, sklearn_p, atol=1e-9)


def test_single_class_data_raises_a_clear_error(tmp_path):
    ds = {
        "meta": {"featureKeys": ["user_theta", "kb_difficulty"], "categoricalKeys": []},
        "rows": [
            {"label": 1, "owner": f"u{i}",
             "vector": {"user_theta": 0.1 * i, "kb_difficulty": 0.0},
             "mask": {"user_theta": 1, "kb_difficulty": 1}, "categorical": {}}
            for i in range(12)
        ],
    }
    with pytest.raises(SystemExit):
        t.train(ds, str(tmp_path))
