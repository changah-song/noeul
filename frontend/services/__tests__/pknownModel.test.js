/**
 * Tests for the Phase 4.3 on-device P(known) scorer + registry
 * (services/pknownModel.js). Pure — no SQLite. These pin down that the JS scorer
 * evaluates the exported linear model exactly as the trainer's build_matrix
 * defines the columns (val:: / mask:: / cat::KEY=VALUE), and that the model
 * registry defaults to "no model" so serving falls back to the IRT baseline.
 */

import {
  clearActivePknownModel,
  getActivePknownModel,
  loadLinearPknownModel,
  setActivePknownModel,
} from '../pknownModel';
import { sigmoid } from '../abilityModel';

// A minimal feature record in the { value, present } shape assembleFeatures emits.
const record = {
  a: { value: 3, present: true, family: 'x' },
  b: { value: null, present: false, family: 'x' }, // absent → imputed 0, mask 0
  item_pos: { value: 'noun', present: true, family: 'item' },
};

const MODEL_JSON = {
  schema: 'pknown-linear/v1',
  version: 7,
  link: 'sigmoid',
  intercept: 0.1,
  weights: {
    'val::a': 2.0,
    'mask::a': 0.5,
    'val::b': 5.0, // b is absent → contributes 0 despite a big weight
    'mask::b': 5.0,
    'cat::item_pos=noun': 1.0,
    'cat::item_pos=verb': -3.0,
  },
  columns: ['val::a', 'mask::a', 'val::b', 'mask::b', 'cat::item_pos=noun', 'cat::item_pos=verb'],
};

afterEach(() => clearActivePknownModel());

describe('loadLinearPknownModel + score', () => {
  it('evaluates sigmoid(intercept + Σ w·col) with the trainer’s column semantics', () => {
    const model = loadLinearPknownModel(MODEL_JSON);
    // z = 0.1 + 2*3 (val::a) + 0.5*1 (mask::a) + 5*0 + 5*0 (b absent)
    //       + 1*1 (pos=noun) + (-3)*0 (pos=verb) = 7.6
    expect(model.score(record)).toBeCloseTo(sigmoid(7.6), 10);
    expect(model.version).toBe(7);
  });

  it('treats an absent feature as 0 (mask 0), never a fabricated value', () => {
    // b is absent; its big weights (5) must contribute nothing.
    const model = loadLinearPknownModel(MODEL_JSON);
    const z = 0.1 + 2 * 3 + 0.5 * 1 + 1 * 1; // no b term
    expect(model.score(record)).toBeCloseTo(sigmoid(z), 10);
  });

  it('one-hots the right category and zeroes the others', () => {
    const verbRecord = { ...record, item_pos: { value: 'verb', present: true, family: 'item' } };
    const model = loadLinearPknownModel(MODEL_JSON);
    // now pos=verb fires (-3), pos=noun is 0
    const z = 0.1 + 2 * 3 + 0.5 * 1 - 3;
    expect(model.score(verbRecord)).toBeCloseTo(sigmoid(z), 10);
  });

  it('always returns a probability strictly inside (0, 1)', () => {
    const model = loadLinearPknownModel(MODEL_JSON);
    const p = model.score(record);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('rejects malformed model JSON', () => {
    expect(() => loadLinearPknownModel({})).toThrow();
    expect(() => loadLinearPknownModel({ weights: {} })).toThrow(); // no columns
  });
});

describe('active model registry', () => {
  it('defaults to null (serving falls back to the IRT baseline)', () => {
    expect(getActivePknownModel()).toBeNull();
  });

  it('sets, reads, and clears the active model', () => {
    const model = loadLinearPknownModel(MODEL_JSON);
    setActivePknownModel(model);
    expect(getActivePknownModel()).toBe(model);
    clearActivePknownModel();
    expect(getActivePknownModel()).toBeNull();
  });
});
