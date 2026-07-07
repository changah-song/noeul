import { sigmoid } from './abilityModel';
import { toNumericVector } from './featureAssembly';

// ─── Full-model P(known) scorer + registry (Phase 4.3 serving) ────────────────
//
// The pooled model is trained offline in Python (backend/ml/train_pknown.py) but
// served ON-DEVICE: the trainer exports the linear model's coefficients
// (model_v{N}.coef.json) and this module evaluates P = sigmoid(W·x + b) locally,
// so scoring stays local-first with no read-time round trip (design doc §4).
// Because the exported weights already fold in the StandardScaler, the device
// evaluates on RAW feature values — the exact function the trainer validated.
//
// MODEL-AGNOSTIC INTERFACE (plan §4.3): a "model" is any object with
//   score(featureRecord) → number in (0, 1)
// The serving path calls only that. Swapping in a Phase 9 sequence model means
// registering a different object with the same shape — no pipeline change.

/**
 * Resolve one export column ("val::KEY" | "mask::KEY" | "cat::KEY=VALUE") against
 * a numeric-vector view of a feature record. Mirrors build_matrix in the trainer
 * exactly, so a column means the same thing on both sides. Unknown columns and
 * absent features contribute 0 (the imputation the trainer also used).
 */
const columnValue = (column, { vector, mask, categorical }) => {
  if (column.startsWith('val::')) {
    const key = column.slice(5);
    const v = vector[key];
    return Number.isFinite(v) ? v : 0;
  }
  if (column.startsWith('mask::')) {
    const key = column.slice(6);
    return mask[key] ? 1 : 0;
  }
  if (column.startsWith('cat::')) {
    const eq = column.indexOf('=');
    if (eq === -1) return 0;
    const key = column.slice(5, eq);
    const value = column.slice(eq + 1);
    return String(categorical[key]) === value ? 1 : 0;
  }
  return 0;
};

/**
 * loadLinearPknownModel — turn an exported coefficient JSON into a scorer object.
 * @param {object} json  { schema, version, intercept, weights, columns }
 * @returns {{ type:'linear', version:number, columns:string[], score:(f)=>number }}
 */
export const loadLinearPknownModel = (json) => {
  if (!json || typeof json !== 'object' || !json.weights || !Array.isArray(json.columns)) {
    throw new Error('[pknownModel] invalid linear model JSON (need weights + columns).');
  }
  const intercept = Number(json.intercept) || 0;
  const weights = json.weights;
  const columns = json.columns;
  const version = json.version ?? null;

  const score = (featureRecord) => {
    const view = toNumericVector(featureRecord);
    let z = intercept;
    for (const col of columns) {
      const w = weights[col];
      if (w) z += w * columnValue(col, view);
    }
    return sigmoid(z);
  };

  return { type: 'linear', version, columns, score };
};

// Module-level active model. Null → serving falls back to the IRT baseline. A real
// deployment registers a model by loading a bundled/fetched coef JSON once at
// startup; nothing registers one by default, so behavior is unchanged until then.
let activeModel = null;

export const setActivePknownModel = (model) => { activeModel = model ?? null; };
export const getActivePknownModel = () => activeModel;
export const clearActivePknownModel = () => { activeModel = null; };
