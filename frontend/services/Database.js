import * as SQLite from './legacySqlite';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { normalizeBookLanguage, normalizeInterfaceLanguageCode } from '../constants/languages';
import { initializeHanjaDatabase } from './hanjaDatabase';
import { GUEST_OWNER_ID } from './localDataScope';
import { getActiveOwnerId } from './localOwnerCoordinator';
import {
  DEFAULT_ACTIVE_PROFILE_ID,
  getDefaultProfileIdForLanguage,
  getRuntimeActiveProfileId,
  isPlaceholderProfileId,
} from './profileScope';
import {
  ABILITY_THETA_MAX,
  ABILITY_THETA_MIN,
  OOV_DIFFICULTY,
  LOOKUP_LEARNING_RATE,
  pKnown,
  seedThetaFromRank,
} from './abilityModel';
import { assembleFeatures } from './featureAssembly';
import {
  bookEaseFromDistribution,
  bookEaseFromLevel,
  isLegacyKoreanStats,
  normalizeLegacyKoreanStats,
  remapLegacyKoreanRank,
} from './bookEase';
import { getActivePknownModel } from './pknownModel';
import { LEARNED_LEVEL, SAVED_WORD_FADE_GAP_MS, SAVED_WORD_FADE_STEPS } from './savedWordFade';
import {
  applySignal as applyLevelSignal,
  guessRateOf,
  lookupRateOf,
  readerState,
  repeatWeight,
  CHECK_START_VARIANCE,
  SEED_VARIANCE,
  seedState,
  serializeHypotheses,
  wordDifficulty,
} from './levelEngine';
import { initialFsrsFromPKnown, rankNominations } from './flashcardNomination';

// ─── Database Setup ───────────────────────────────────────────────────────────
// NOTE: Change the db filename here if you ever need to reset all tables by
// wiping the old database (e.g., rename to 'app_v2.db' to start fresh).
const db = SQLite.openDatabase('fluentfable.db');
const BOOK_INDEX_MIGRATION_KEY = 'book_index_migration_v2';
const DICTIONARY_CACHE_MIGRATION_KEY = 'dictionary_cache_migration_v1';
const DICTIONARY_CACHE_LANGUAGE_MIGRATION_KEY = 'dictionary_cache_language_migration_v1';
const DICTIONARY_CACHE_TARGET_LANGUAGE_MIGRATION_KEY = 'dictionary_cache_target_language_migration_v1';
const DICTIONARY_CACHE_GLOSS_MIGRATION_KEY = 'dictionary_cache_gloss_migration_v1';
const DICTIONARY_CACHE_WORD_PARTS_MIGRATION_KEY = 'dictionary_cache_word_parts_migration_v1';
const DICTIONARY_CACHE_AUDIO_MIGRATION_KEY = 'dictionary_cache_audio_migration_v1';
const DICTIONARY_CACHE_PROFICIENCY_MIGRATION_KEY = 'dictionary_cache_proficiency_migration_v1';
const DICTIONARY_CACHE_ROMANIZATION_MIGRATION_KEY = 'dictionary_cache_romanization_migration_v1';
const DICTIONARY_CACHE_DIFFICULTY_MIGRATION_KEY = 'dictionary_cache_difficulty_migration_v1';
const DICTIONARY_CACHE_ZH_SCRIPTS_MIGRATION_KEY = 'dictionary_cache_zh_scripts_migration_v1';
const DICTIONARY_CACHE_KO_LANGUAGE_PURGE_KEY = 'dictionary_cache_ko_language_purge_v1';
const LOCAL_OWNER_SQLITE_MIGRATION_KEY = 'local_owner_sqlite_migration_v1';
const PROFILE_SQLITE_MIGRATION_KEY = 'profile_sqlite_migration_v1';
const VOCAB_EMPTY_HANJA_MIGRATION_KEY = 'vocab_empty_hanja_migration_v1';
// 9: English names (also at the start of a sentence) come back as names and are
// no longer graded, so books analysed before that are analysed again.
// 10: English words with no dictionary equivalent get a machine gloss asked
// with their part of speech ("underneath" was "하면", now "아래에").
export const PREPROCESS_VERSION = 10;
const SQLITE_BIND_BATCH_SIZE = 450;
const DEFAULT_STABILITY = 1.0;
const DEFAULT_DIFFICULTY = 5.0;
const FSRS_PARAMS = {
  requestRetention: 0.9,
  maximumInterval: 365,
};

const normalizeIdentityText = (value) => {
  if (value == null) {
    return '';
  }

  return String(value).normalize('NFKC').replace(/\s+/g, ' ').trim();
};

const makeVocabDefinitionKey = (value) => {
  const normalized = normalizeIdentityText(value).toLowerCase();
  return normalized || null;
};

// "No hanja" is stored as NULL. Callers pass '' for it (`candidate.hanja || ''`)
// while the cloud round-trips it as null; storing both made the same word two
// rows. Lookups also compare with COALESCE(hanja, '') so legacy '' rows match.
const normalizeHanjaForStorage = (value) => {
  if (value == null) {
    return null;
  }

  const text = String(value);
  return text.trim() ? text : null;
};

const resolveOwnerId = (value) => {
  if (typeof value === 'string') {
    const ownerId = value.trim();
    return ownerId || GUEST_OWNER_ID;
  }

  const ownerId = typeof value?.ownerId === 'string' ? value.ownerId.trim() : '';
  return ownerId || GUEST_OWNER_ID;
};

const resolveProfileId = (value, language = 'ko') => {
  const fallbackProfileId = getRuntimeActiveProfileId() || getDefaultProfileIdForLanguage(language);

  if (typeof value === 'string') {
    const profileId = value.trim();
    return profileId || fallbackProfileId;
  }

  const profileId = typeof value?.profileId === 'string'
    ? value.profileId.trim()
    : (typeof value?.profile_id === 'string' ? value.profile_id.trim() : '');
  return profileId || fallbackProfileId;
};

const normalizeFsrsValue = (value, fallback, min = 0.01, max = Number.POSITIVE_INFINITY) => {
  if (value == null || value === '') {
    return fallback;
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.min(Math.max(number, min), max);
};

const normalizeDictionaryCacheScope = (scopeOrInterfaceLanguage = 'en', options = {}) => {
  if (typeof scopeOrInterfaceLanguage === 'object' && scopeOrInterfaceLanguage !== null) {
    return {
      language: normalizeBookLanguage(scopeOrInterfaceLanguage.language ?? scopeOrInterfaceLanguage.targetLanguage ?? 'ko'),
      interfaceLanguage: normalizeInterfaceLanguageCode(
        scopeOrInterfaceLanguage.interfaceLanguage
          ?? scopeOrInterfaceLanguage.interface_language
          ?? 'en'
      ),
    };
  }

  return {
    language: normalizeBookLanguage(options.language ?? options.targetLanguage ?? 'ko'),
    interfaceLanguage: normalizeInterfaceLanguageCode(
      options.interfaceLanguage
        ?? options.interface_language
        ?? scopeOrInterfaceLanguage
        ?? 'en'
    ),
  };
};

const sqlTextColumnOrNull = (columns, column) => (
  columns.includes(column) ? column : 'NULL'
);

const sqlNormalizedColumnOrDefault = (columns, column, fallback) => (
  columns.includes(column)
    ? `COALESCE(NULLIF(TRIM(${column}), ''), '${fallback}')`
    : `'${fallback}'`
);

const sqlBookLevelColumnOrNull = (columns, column) => (
  columns.includes(column) ? column : 'NULL'
);

const chunkValues = (values, size = SQLITE_BIND_BATCH_SIZE) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

const normalizeBookLevelForStorage = (bookLevel) => {
  if (!bookLevel || typeof bookLevel !== 'object') {
    return {
      level: null,
      rank: null,
      system: null,
      source: null,
      statsJson: null,
    };
  }

  const level = bookLevel.level ?? bookLevel.proficiency_level ?? null;
  const rawRank = bookLevel.level_rank ?? bookLevel.proficiency_rank ?? null;
  const rank = Number.isFinite(Number(rawRank)) ? Number(rawRank) : null;
  const system = bookLevel.proficiency_system ?? null;
  const source = bookLevel.level_source ?? bookLevel.basis ?? null;
  let statsJson = null;

  try {
    statsJson = JSON.stringify(bookLevel);
  } catch (_error) {
    statsJson = null;
  }

  return {
    level,
    rank,
    system,
    source,
    statsJson,
  };
};

const normalizeDictionaryLevelMetadata = (entry = {}) => {
  const rawRank = entry.level_rank
    ?? entry.proficiency_rank
    ?? entry.cefr_rank
    ?? entry.korean_rank
    ?? entry.hsk_rank
    ?? entry.hsk_level;
  const numericRank = Number(rawRank);
  const levelRank = Number.isFinite(numericRank) ? Math.round(numericRank) : null;
  const hskLevel = entry.hsk_level != null && entry.hsk_level !== ''
    ? `HSK ${entry.hsk_level}`
    : null;

  // Continuous difficulty (Korean): the dense difficulty_rank and its normalized
  // [0,1] percentile from korean_nikl_vocab, used by the P(known) model for a
  // within-band ordering. Null for languages/words without it.
  const numericDifficultyRank = Number(entry.difficulty_rank);
  const difficultyRank = Number.isFinite(numericDifficultyRank)
    ? Math.round(numericDifficultyRank)
    : null;
  const numericDifficultyPercentile = Number(entry.difficulty_percentile);
  const difficultyPercentile = Number.isFinite(numericDifficultyPercentile)
    ? numericDifficultyPercentile
    : null;

  // How common the word is (Zipf) and the Korean loanword flag, for the
  // level engine's word difficulty (services/levelEngine.js wordDifficulty).
  const numericZipf = entry.zipf == null || entry.zipf === '' ? NaN : Number(entry.zipf);
  const zipf = Number.isFinite(numericZipf) ? numericZipf : null;
  const loanword = entry.loanword == null ? null : (entry.loanword === true || Number(entry.loanword) === 1 ? 1 : 0);

  return {
    levelRank,
    difficultyRank,
    difficultyPercentile,
    zipf,
    loanword,
    levelLabel: entry.level_label
      ?? entry.level
      ?? entry.proficiency_level
      ?? entry.cefr_level
      ?? entry.korean_level
      ?? entry.nikl_grade
      ?? hskLevel
      ?? null,
    levelSystem: entry.level_system
      ?? entry.proficiency_system
      ?? entry.hsk_system
      ?? (entry.cefr_level || entry.cefr_rank ? 'CEFR' : null)
      ?? (entry.hsk_level || entry.hsk_rank ? 'HSK' : null)
      ?? (entry.korean_level || entry.nikl_grade || entry.korean_rank ? 'NIKL' : null),
    levelSource: entry.level_source
      ?? entry.source
      ?? entry.proficiency_source
      ?? null,
  };
};


// ─── Table Creation ───────────────────────────────────────────────────────────

/**
 * createTable
 * Creates the `vocab` table if it doesn't exist.
 * This stores words the user has explicitly saved (their personal word list).
 */
export const createTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS vocab (
          id    INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL DEFAULT 'guest',
          profile_id TEXT DEFAULT 'ko_default',
          word  TEXT,
          hanja TEXT,
          def   TEXT,
          def_key TEXT,
          level TEXT,
          related_known_words TEXT DEFAULT '[]',
          related_known_words_deleted TEXT DEFAULT '[]',
          stability REAL DEFAULT 1.0,
          difficulty REAL DEFAULT 5.0,
          p_known REAL,
          source TEXT,
          updated_at TEXT,
          deleted_at TEXT,
          language TEXT DEFAULT 'ko'
        )`,
        [],
        () => resolve(),
        (_, error) => {
          console.error("[Database] Error creating vocab table:", error);
          reject(error);
        }
      );
    });
  });
};

export const createVocabContextTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS vocab_contexts (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id          TEXT NOT NULL DEFAULT 'guest',
          profile_id        TEXT DEFAULT 'ko_default',
          vocab_id          INTEGER,
          word              TEXT NOT NULL,
          hanja             TEXT,
          def               TEXT,
          def_key           TEXT,
          source_book_uri   TEXT,
          source_book_title TEXT,
          sentence          TEXT NOT NULL,
          seen_at           TEXT DEFAULT CURRENT_TIMESTAMP,
          language          TEXT DEFAULT 'ko',
          updated_at        TEXT,
          deleted_at        TEXT
        )`,
        [],
        () => {
          tx.executeSql(
            `CREATE INDEX IF NOT EXISTS idx_vocab_contexts_vocab_seen
             ON vocab_contexts(vocab_id, seen_at DESC)`
          );
          tx.executeSql(
            `CREATE INDEX IF NOT EXISTS idx_vocab_contexts_word_seen
             ON vocab_contexts(word, seen_at DESC)`
          );
          resolve();
        },
        (_, error) => {
          console.error('[Database] Error creating vocab_contexts table:', error);
          reject(error);
        }
      );
    });
  });
};

export const migrateVocabContextTable = async () => {
  const columns = await getTableColumns('vocab_contexts');
  const alterations = [];

  if (!columns.includes('owner_id')) {
    alterations.push(`ALTER TABLE vocab_contexts ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
  }

  if (!columns.includes('profile_id')) {
    alterations.push(`ALTER TABLE vocab_contexts ADD COLUMN profile_id TEXT DEFAULT '${DEFAULT_ACTIVE_PROFILE_ID}'`);
  }

  if (!columns.includes('language')) {
    alterations.push(`ALTER TABLE vocab_contexts ADD COLUMN language TEXT DEFAULT 'ko'`);
  }

  if (!columns.includes('updated_at')) {
    alterations.push('ALTER TABLE vocab_contexts ADD COLUMN updated_at TEXT');
  }

  if (!columns.includes('deleted_at')) {
    alterations.push('ALTER TABLE vocab_contexts ADD COLUMN deleted_at TEXT');
  }

  if (!columns.includes('def_key')) {
    alterations.push('ALTER TABLE vocab_contexts ADD COLUMN def_key TEXT');
  }

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        alterations.forEach((statement) => tx.executeSql(statement));
        tx.executeSql(`UPDATE vocab_contexts SET owner_id = ? WHERE owner_id IS NULL OR TRIM(owner_id) = ''`, [GUEST_OWNER_ID]);
        tx.executeSql(`UPDATE vocab_contexts SET profile_id = ? WHERE profile_id IS NULL OR TRIM(profile_id) = ''`, [DEFAULT_ACTIVE_PROFILE_ID]);
        tx.executeSql(`UPDATE vocab_contexts SET language = 'ko' WHERE language IS NULL OR TRIM(language) = ''`);
        tx.executeSql(`UPDATE vocab_contexts SET seen_at = COALESCE(seen_at, CURRENT_TIMESTAMP)`);
        tx.executeSql(`UPDATE vocab_contexts SET updated_at = COALESCE(updated_at, seen_at, CURRENT_TIMESTAMP)`);
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_contexts_identity_key
           ON vocab_contexts(language, word, hanja, def_key, source_book_uri, sentence)`
        );
      },
      (error) => {
        console.error('[Database] Error migrating vocab_contexts table:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

// ─── Interaction Event Log (append-only) ──────────────────────────────────────
// Phase 1 of the personalized vocabulary model. Unlike `vocab` (which stores only
// *current* FSRS state and overwrites the past), this table is an append-only
// record of every (user, word, outcome, timestamp) interaction. Nothing here is
// ever UPDATEd except `synced_at` on push to Supabase and `deleted_at` for tombstones.
// See "personalization model implementation plan.md" Phase 1.
//
// BACKFILL NOTE (plan step 1.5): vocab rows that predate this log have NO event
// history — the old code only kept aggregate counts, which can't be reconstructed
// into individual timestamped events. Downstream models must treat such words as
// "warm but logless" (known to exist, but with an empty interaction history) and
// must NOT fabricate synthetic events to fill the gap.

const INTERACTION_EVENT_TYPES = new Set([
  'review',
  'lookup',
  'save',
  'unsave',
  'dwell',
  'reveal',
  'hanja_confirm',
  // A graded word was rendered on a page the reader dwelled on and then left
  // WITHOUT looking it up. Weak positive evidence ("probably knew it"), and the
  // only read-mode channel that can push theta up — every other reader signal is
  // a lookup, which only pushes down. `value_num` carries the dwell in seconds so
  // the offline trainer can check whether exposure actually predicts later review
  // outcomes rather than trusting the online rate we guessed.
  'exposure',
  // An answer in the word check (services/wordCheck.js): outcome 1 = "I know
  // it". check_pseudo is the same for a made-up word, which a reader should
  // never claim to know; it measures their guess rate.
  'check',
  'check_pseudo',
]);

// RN has no crypto.getRandomValues polyfill here, so the `uuid` package would throw.
// This id is generated once at insert time and reused for idempotent sync, so a
// timestamp + random suffix is collision-resistant enough for a per-device log.
const generateClientEventId = () => {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 12);
  const rand2 = Math.random().toString(36).slice(2, 8);
  return `evt_${time}_${rand}${rand2}`;
};

export const createInteractionEventsTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS interaction_events (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          client_event_id   TEXT NOT NULL UNIQUE,
          owner_id          TEXT NOT NULL DEFAULT 'guest',
          profile_id        TEXT DEFAULT 'ko_default',
          language          TEXT DEFAULT 'ko',
          word              TEXT,
          stem              TEXT,
          def_key           TEXT,
          hanja             TEXT,
          event_type        TEXT NOT NULL,
          grade             INTEGER,
          outcome           INTEGER,
          value_num         REAL,
          source_book_uri   TEXT,
          sentence          TEXT,
          vocab_id          INTEGER,
          created_at        TEXT DEFAULT CURRENT_TIMESTAMP,
          synced_at         TEXT,
          deleted_at        TEXT
        )`,
        [],
        () => {
          tx.executeSql(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_interaction_events_client_event_id
             ON interaction_events(client_event_id)`
          );
          tx.executeSql(
            `CREATE INDEX IF NOT EXISTS idx_interaction_events_owner_word_created
             ON interaction_events(owner_id, profile_id, language, word, created_at)`
          );
          // Push-only sync (1.3) scans for locally-unsynced rows.
          tx.executeSql(
            `CREATE INDEX IF NOT EXISTS idx_interaction_events_owner_synced
             ON interaction_events(owner_id, synced_at)`
          );
          resolve();
        },
        (_, error) => {
          console.error('[Database] Error creating interaction_events table:', error);
          reject(error);
        }
      );
    });
  });
};

export const migrateInteractionEventsTable = async () => {
  const columns = await getTableColumns('interaction_events');
  if (columns.length === 0) {
    // Table doesn't exist yet (createInteractionEventsTable not run); nothing to migrate.
    return;
  }

  const alterations = [];
  const ensureColumn = (name, ddl) => {
    if (!columns.includes(name)) {
      alterations.push(`ALTER TABLE interaction_events ADD COLUMN ${ddl}`);
    }
  };

  // Future-proofing: keep every column addition idempotent, matching the vocab pattern.
  ensureColumn('stem', 'stem TEXT');
  ensureColumn('def_key', 'def_key TEXT');
  ensureColumn('hanja', 'hanja TEXT');
  ensureColumn('grade', 'grade INTEGER');
  ensureColumn('outcome', 'outcome INTEGER');
  ensureColumn('value_num', 'value_num REAL');
  ensureColumn('source_book_uri', 'source_book_uri TEXT');
  ensureColumn('sentence', 'sentence TEXT');
  ensureColumn('vocab_id', 'vocab_id INTEGER');
  ensureColumn('synced_at', 'synced_at TEXT');
  ensureColumn('deleted_at', 'deleted_at TEXT');

  if (alterations.length === 0) {
    return;
  }

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        alterations.forEach((statement) => tx.executeSql(statement));
      },
      (error) => {
        console.error('[Database] Error migrating interaction_events table:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

/**
 * logInteractionEvent — pure append into the interaction_events log.
 *
 * NEVER updates an existing row. Idempotent: re-inserting the same
 * `client_event_id` is a no-op (INSERT OR IGNORE + unique index), which makes the
 * sync path safe to retry. Callers should log the event BEFORE mutating any derived
 * state (e.g. FSRS review state) so the historical outcome is preserved.
 *
 * @returns {Promise<{ clientEventId: string, inserted: boolean }>}
 */
export const logInteractionEvent = (event = {}) => {
  const {
    ownerId = GUEST_OWNER_ID,
    profileId = null,
    language = 'ko',
    word = null,
    stem = null,
    defKey = null,
    def = null,
    hanja = null,
    eventType,
    grade = null,
    outcome = null,
    valueNum = null,
    sourceBookUri = null,
    sentence = null,
    vocabId = null,
    createdAt = new Date().toISOString(),
    clientEventId = generateClientEventId(),
  } = event;

  if (!eventType || !INTERACTION_EVENT_TYPES.has(eventType)) {
    return Promise.reject(
      new Error(`[Database] logInteractionEvent: invalid event_type "${eventType}"`)
    );
  }

  const scopedOwnerId = resolveOwnerId(ownerId);
  const scopedProfileId = resolveProfileId(profileId ?? event.profile_id ?? event, language);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const normalizedOutcome = outcome == null ? null : (outcome ? 1 : 0);
  // Derive def_key from a raw definition when the caller didn't pass one, using
  // the same normalization as vocab rows so events can be joined back to them.
  const resolvedDefKey = defKey ?? makeVocabDefinitionKey(def);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `INSERT OR IGNORE INTO interaction_events (
          client_event_id, owner_id, profile_id, language, word, stem, def_key, hanja,
          event_type, grade, outcome, value_num, source_book_uri, sentence, vocab_id, created_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          clientEventId,
          scopedOwnerId,
          scopedProfileId,
          normalizedLanguage,
          word,
          stem,
          resolvedDefKey,
          hanja,
          eventType,
          grade == null ? null : Math.round(Number(grade)),
          normalizedOutcome,
          valueNum == null ? null : Number(valueNum),
          sourceBookUri,
          sentence,
          vocabId == null ? null : Number(vocabId),
          createdAt,
        ],
        (_, result) => resolve({ clientEventId, inserted: result.rowsAffected > 0 }),
        (_, error) => {
          console.error('[Database] Error logging interaction event:', error);
          reject(error);
        }
      );
    });
  });
};

/**
 * getUnsyncedInteractionEvents — read events not yet pushed to the cloud for an
 * owner, oldest first. Used by the push-only sync (interactionEventsCloudSync).
 */
export const getUnsyncedInteractionEvents = (ownerId, { limit = 500 } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT * FROM interaction_events
         WHERE owner_id = ? AND synced_at IS NULL AND deleted_at IS NULL
         ORDER BY created_at ASC, id ASC
         LIMIT ?`,
        [scopedOwnerId, limit],
        (_, result) => resolve(result.rows._array ?? []),
        (_, error) => {
          console.error('[Database] Error reading unsynced interaction events:', error);
          reject(error);
        }
      );
    });
  });
};

/**
 * markInteractionEventsSynced — stamp `synced_at` on the given events after a
 * successful cloud push. This is the ONLY column ever updated on an event row;
 * the log otherwise stays append-only (plan invariant #5).
 */
export const markInteractionEventsSynced = (clientEventIds, syncedAt = new Date().toISOString()) => {
  const ids = (Array.isArray(clientEventIds) ? clientEventIds : []).filter(Boolean);
  if (ids.length === 0) {
    return Promise.resolve(0);
  }

  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        // Chunk to stay under SQLite's bound-variable limit for large batches.
        for (let start = 0; start < ids.length; start += SQLITE_BIND_BATCH_SIZE) {
          const chunk = ids.slice(start, start + SQLITE_BIND_BATCH_SIZE);
          const placeholders = chunk.map(() => '?').join(', ');
          tx.executeSql(
            `UPDATE interaction_events SET synced_at = ?
             WHERE client_event_id IN (${placeholders})`,
            [syncedAt, ...chunk]
          );
        }
      },
      (error) => {
        console.error('[Database] Error marking interaction events synced:', error);
        reject(error);
      },
      () => resolve(ids.length)
    );
  });
};

// ─── Profile ability (Phase 2 of the personalized vocabulary model) ───────────
//
// One row per (owner, profile, language) holding the user's latent ability
// estimate `theta` — the number the baseline scorer reads as
// `P(known) = sigmoid(theta - difficulty_word)`. This is DEVICE-AUTHORITATIVE and
// local-first: the scorer reads it on every rendered page and Phase 3 will nudge
// it after every graded review, so it lives in SQLite (cheap frequent writes)
// rather than in the AsyncStorage settings blob or a remote Postgres column.
//
// `self_report_rank` records the onboarding seed so a re-seed after a level
// change is possible while still cold; `event_count` tracks how many behavioral
// events have been folded in (Phase 3 uses it to decay the self-report prior).
// `synced_at` is cleared on every write so the (mutable) row re-pushes to cloud.

export const createProfileAbilityTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS profile_ability (
          id                INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id          TEXT NOT NULL DEFAULT 'guest',
          profile_id        TEXT DEFAULT 'ko_default',
          language          TEXT DEFAULT 'ko',
          theta             REAL,
          self_report_rank  INTEGER,
          event_count       INTEGER DEFAULT 0,
          seeded_at         TEXT,
          updated_at        TEXT DEFAULT CURRENT_TIMESTAMP,
          synced_at         TEXT,
          theta_var         REAL,
          lookup_model      TEXT,
          guess_yes         REAL DEFAULT 0,
          guess_total       REAL DEFAULT 0,
          last_event_at     TEXT,
          UNIQUE(owner_id, profile_id, language)
        )`,
        [],
        () => {
          tx.executeSql(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_ability_scope
             ON profile_ability(owner_id, profile_id, language)`
          );
          tx.executeSql(
            `CREATE INDEX IF NOT EXISTS idx_profile_ability_owner_synced
             ON profile_ability(owner_id, synced_at)`
          );
          resolve();
        },
        (_, error) => {
          console.error('[Database] Error creating profile_ability table:', error);
          reject(error);
        }
      );
    });
  });
};

export const migrateProfileAbilityTable = async () => {
  const columns = await getTableColumns('profile_ability');
  if (columns.length === 0) {
    // Table doesn't exist yet (createProfileAbilityTable not run); nothing to migrate.
    return;
  }

  const alterations = [];
  const ensureColumn = (name, ddl) => {
    if (!columns.includes(name)) {
      alterations.push(`ALTER TABLE profile_ability ADD COLUMN ${ddl}`);
    }
  };

  ensureColumn('theta', 'theta REAL');
  ensureColumn('self_report_rank', 'self_report_rank INTEGER');
  ensureColumn('event_count', 'event_count INTEGER DEFAULT 0');
  ensureColumn('seeded_at', 'seeded_at TEXT');
  ensureColumn('updated_at', 'updated_at TEXT');
  ensureColumn('synced_at', 'synced_at TEXT');
  // Level engine (services/levelEngine.js): how sure the level is, the
  // lookup-habit hypotheses (JSON), the guess-rate counts, and when the last
  // signal came.
  ensureColumn('theta_var', 'theta_var REAL');
  ensureColumn('lookup_model', 'lookup_model TEXT');
  ensureColumn('guess_yes', 'guess_yes REAL DEFAULT 0');
  ensureColumn('guess_total', 'guess_total REAL DEFAULT 0');
  ensureColumn('last_event_at', 'last_event_at TEXT');

  if (alterations.length === 0) {
    return;
  }

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        alterations.forEach((statement) => tx.executeSql(statement));
      },
      (error) => {
        console.error('[Database] Error migrating profile_ability table:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

/**
 * getProfileAbility — read the ability row for one (owner, profile, language),
 * or null if none exists yet.
 */
export const getProfileAbility = ({ ownerId, profileId, language = 'ko' } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT * FROM profile_ability
         WHERE owner_id = ? AND profile_id = ? AND language = ?
         LIMIT 1`,
        [scopedOwnerId, scopedProfileId, normalizedLanguage],
        (_, result) => resolve(result.rows._array?.[0] ?? null),
        (_, error) => {
          console.error('[Database] Error reading profile ability:', error);
          reject(error);
        }
      );
    });
  });
};

// ─── Level engine persistence and the ability log ─────────────────────────────
//
// Every change to a profile's level goes through services/levelEngine.js and
// leaves one ability_log row saying what moved it (a lookup of 厮杀, a page read
// past, a word-check answer, the vocabulary picker) and by how much. The log is
// pushed to Supabase (user_ability_log) for the admin dashboard's Level model
// page. Rows are append-only.

export const createAbilityLogTable = () => new Promise((resolve, reject) => {
  db.transaction(tx => {
    tx.executeSql(
      `CREATE TABLE IF NOT EXISTS ability_log (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        client_log_id  TEXT NOT NULL UNIQUE,
        owner_id       TEXT NOT NULL DEFAULT 'guest',
        profile_id     TEXT,
        language       TEXT,
        signal         TEXT NOT NULL,
        word           TEXT,
        stem           TEXT,
        outcome        INTEGER,
        difficulty     REAL,
        p_known        REAL,
        p_observed     REAL,
        theta_before   REAL,
        theta_after    REAL,
        var_before     REAL,
        var_after      REAL,
        lookup_rate    REAL,
        guess_rate     REAL,
        source_book_uri TEXT,
        details        TEXT,
        created_at     TEXT NOT NULL,
        synced_at      TEXT
      )`,
      [],
      () => {
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_ability_log_owner_synced
           ON ability_log(owner_id, synced_at)`
        );
        resolve();
      },
      (_, error) => {
        console.error('[Database] Error creating ability_log table:', error);
        reject(error);
      }
    );
  });
});

const generateClientLogId = () => (
  `lvl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
);

const insertAbilityLogRows = (tx, scope, entries) => {
  entries.forEach((entry) => {
    tx.executeSql(
      `INSERT OR IGNORE INTO ability_log (
         client_log_id, owner_id, profile_id, language, signal, word, stem, outcome,
         difficulty, p_known, p_observed, theta_before, theta_after, var_before, var_after,
         lookup_rate, guess_rate, source_book_uri, details, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateClientLogId(),
        scope.ownerId,
        scope.profileId,
        scope.language,
        entry.signal,
        entry.word ?? null,
        entry.stem ?? null,
        entry.outcome ?? null,
        entry.difficulty ?? null,
        entry.pKnown ?? null,
        entry.pObserved ?? null,
        entry.thetaBefore ?? null,
        entry.thetaAfter ?? null,
        entry.varianceBefore ?? null,
        entry.varianceAfter ?? null,
        entry.lookupRate ?? null,
        entry.guessRate ?? null,
        entry.sourceBookUri ?? null,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.at ?? new Date().toISOString(),
      ]
    );
  });
};

const writeReaderStateSql = `
  INSERT INTO profile_ability (
    owner_id, profile_id, language, theta, theta_var, self_report_rank, event_count,
    lookup_model, guess_yes, guess_total, last_event_at,
    seeded_at, updated_at, synced_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  ON CONFLICT(owner_id, profile_id, language) DO UPDATE SET
    theta = excluded.theta,
    theta_var = excluded.theta_var,
    self_report_rank = COALESCE(excluded.self_report_rank, profile_ability.self_report_rank),
    event_count = excluded.event_count,
    lookup_model = excluded.lookup_model,
    guess_yes = excluded.guess_yes,
    guess_total = excluded.guess_total,
    last_event_at = excluded.last_event_at,
    seeded_at = COALESCE(excluded.seeded_at, profile_ability.seeded_at),
    updated_at = excluded.updated_at,
    synced_at = NULL`;

// One level change at a time per profile: every update reads the row, folds
// signals in, and writes it back, so two at once (a lookup during a page
// turn) would lose one.
const abilityQueues = new Map();
const withAbilityLock = (key, task) => {
  const previous = abilityQueues.get(key) || Promise.resolve();
  const run = previous.catch(() => {}).then(task);
  abilityQueues.set(key, run);
  run.finally(() => {
    if (abilityQueues.get(key) === run) abilityQueues.delete(key);
  }).catch(() => {});
  return run;
};

/**
 * updateReaderLevel — read the profile's level, let `fold(state)` apply
 * signals through the engine, then write the new state and the log rows in
 * one transaction.
 *
 * `fold` returns { state, logs, selfReportRank?, seededAt? } or null to write
 * nothing.
 *
 * @returns {Promise<object|null>} the new engine state, or null.
 */
export const updateReaderLevel = ({ ownerId, profileId, language = 'ko' } = {}, fold) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);
  const scope = { ownerId: scopedOwnerId, profileId: scopedProfileId, language: normalizedLanguage };
  const key = `${scopedOwnerId}|${scopedProfileId}|${normalizedLanguage}`;

  return withAbilityLock(key, async () => {
    const row = await getProfileAbility(scope);
    const before = readerState(row);
    const result = await fold(before, row);
    if (!result || !result.state) return null;
    const { state, logs = [] } = result;
    const now = new Date().toISOString();
    await new Promise((resolve, reject) => {
      db.transaction(
        tx => {
          tx.executeSql(writeReaderStateSql, [
            scopedOwnerId,
            scopedProfileId,
            normalizedLanguage,
            state.theta,
            state.variance,
            result.selfReportRank ?? null,
            state.eventCount,
            serializeHypotheses(state.hypotheses),
            state.guessYes,
            state.guessTotal,
            state.lastEventAt,
            result.seededAt ?? null,
            now,
          ]);
          insertAbilityLogRows(tx, scope, logs.filter(Boolean));
        },
        (error) => {
          console.error('[Database] Error writing reader level:', error);
          reject(error);
        },
        () => resolve()
      );
    });
    return state;
  });
};

/** The engine's view of a profile: level, how sure, and learned rates. */
export const getReaderLevel = async ({ ownerId, profileId, language = 'ko' } = {}) => {
  const row = await getProfileAbility({ ownerId, profileId, language });
  const state = readerState(row);
  return {
    ...state,
    lookupRate: lookupRateOf(state),
    guessRate: guessRateOf(state),
    hasRow: !!row,
  };
};

/**
 * applyWordCheckResults — save a word check (services/wordCheck.js): every
 * answer goes into the interaction log ('check' / 'check_pseudo', the
 * labelled facts the dashboard's accuracy check uses) and through the level
 * engine, in the order given. The check starts by widening the level's
 * uncertainty so a reader the model is already sure about can still move.
 *
 * @param {object} args
 * @param {Array<{word:string, pseudo:boolean, outcome:0|1, difficulty?:number,
 *                details?:object, at?:string}>} args.answers
 * @returns {Promise<object|null>} the new engine state
 */
export const applyWordCheckResults = async ({ ownerId, profileId, language = 'ko', answers = [] } = {}) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const list = (Array.isArray(answers) ? answers : []).filter((a) => a && typeof a.word === 'string' && a.word);
  if (list.length === 0) return null;

  await Promise.all(list.map((answer) => logInteractionEvent({
    ownerId,
    profileId,
    language: normalizedLanguage,
    word: answer.word,
    stem: answer.pseudo ? null : answer.word,
    eventType: answer.pseudo ? 'check_pseudo' : 'check',
    outcome: answer.outcome ? 1 : 0,
    createdAt: answer.at ?? new Date().toISOString(),
  }).catch((error) => {
    console.warn('[Database] Failed to log word check answer:', error);
  })));

  return updateReaderLevel({ ownerId, profileId, language: normalizedLanguage }, (before) => {
    const at = list[0].at ?? new Date().toISOString();
    let current = { ...before, variance: Math.max(before.variance, CHECK_START_VARIANCE) };
    const logs = [{
      signal: 'check_start',
      thetaBefore: before.theta,
      thetaAfter: before.theta,
      varianceBefore: before.variance,
      varianceAfter: current.variance,
      details: { answered: list.length },
      at,
    }];
    list.forEach((answer) => {
      const { state: next, log } = applyLevelSignal(current, answer.pseudo
        ? { type: 'pseudo', outcome: answer.outcome ? 1 : 0, at: answer.at }
        : { type: 'check', difficulty: Number(answer.difficulty), outcome: answer.outcome ? 1 : 0, at: answer.at });
      if (!log) return;
      current = next;
      logs.push({ ...log, word: answer.word, stem: answer.pseudo ? null : answer.word, details: answer.details ?? null });
    });
    current.eventCount = Math.max(current.eventCount, 1);
    return { state: current, logs, seededAt: new Date().toISOString() };
  });
};

export const getUnsyncedAbilityLog = (ownerId, { limit = 500 } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT * FROM ability_log
         WHERE owner_id = ? AND synced_at IS NULL
         ORDER BY created_at ASC, id ASC
         LIMIT ?`,
        [scopedOwnerId, limit],
        (_, result) => resolve(result.rows._array ?? []),
        (_, error) => {
          console.error('[Database] Error reading unsynced ability log:', error);
          reject(error);
        }
      );
    });
  });
};

export const markAbilityLogSynced = (ids, syncedAt = new Date().toISOString()) => {
  const targets = (Array.isArray(ids) ? ids : []).filter((id) => id != null);
  if (targets.length === 0) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        chunkValues(targets).forEach((chunk) => {
          tx.executeSql(
            `UPDATE ability_log SET synced_at = ? WHERE id IN (${chunk.map(() => '?').join(', ')})`,
            [syncedAt, ...chunk]
          );
        });
      },
      (error) => {
        console.error('[Database] Error marking ability log synced:', error);
        reject(error);
      },
      () => resolve(targets.length)
    );
  });
};

/**
 * getAbilityLog — the newest log rows for a profile, for the on-device
 * "why did my level move" view and tests.
 */
export const getAbilityLog = ({ ownerId, profileId, language = 'ko', limit = 200 } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT * FROM ability_log
         WHERE owner_id = ? AND profile_id = ? AND language = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
        [scopedOwnerId, scopedProfileId, normalizedLanguage, limit],
        (_, result) => resolve(result.rows._array ?? []),
        (_, error) => reject(error)
      );
    });
  });
};

/**
 * estimateBookReadingEase — the personalized "how easy is this book for me?"
 * number surfaced in the book preview. Reads the reader's current ability
 * (`theta`) for the active (owner, profile, language) and estimates the expected
 * fraction of the book's vocabulary the reader already knows.
 *
 * Two tiers, best available wins:
 *   1. `bookLevelStats.distribution` (the per-band histogram the leveling
 *      accumulator stores) → `bookEaseFromDistribution`, a count-weighted mean of
 *      the real word-level sigmoid per band. Continuous — two same-band books
 *      with different vocabulary mixes get different numbers.
 *   2. The single graded band (`levelRank`) → `bookEaseFromLevel`, the coarse
 *      anchored estimate. In a 3-band language (ko) this collapses every book to
 *      one of three values, so it's strictly a fallback.
 *
 * Because `theta` is updated by Phase 3 from every review/lookup, this estimate
 * improves over time with no re-training. Returns `ease: null` when the book has no
 * graded level yet (we don't guess "hard" for an unleveled book).
 *
 * @param {object} args
 * @param {string} [args.ownerId]
 * @param {string} [args.profileId]
 * @param {string} [args.language='ko']
 * @param {number|null} [args.levelRank]  the book's graded band (bookLevel.level_rank)
 * @param {object|string|null} [args.bookLevelStats]  the stored book-level stats
 *        (bookLevel object or its JSON), whose `.distribution` unlocks tier 1
 * @param {string|null} [args.bookUri]  when given and `bookLevelStats` carries no
 *        distribution, the stored preprocess meta (book_level_stats) is consulted
 *        — the caller's in-memory bookLevel can be staler than the table (e.g.
 *        hydrated from the cloud row or the bundled catalog)
 * @returns {Promise<{ease:number|null, theta:number|null, eventCount:number,
 *          hasAbility:boolean, easeSource:'distribution'|'level'|null,
 *          coverage:number|null}>}
 */
export const estimateBookReadingEase = async ({
  ownerId,
  profileId,
  language = 'ko',
  levelRank,
  bookLevelStats = null,
  bookUri = null,
} = {}) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const ability = await getProfileAbility({ ownerId, profileId, language: normalizedLanguage });
  const theta = ability?.theta ?? null;
  const eventCount = Number.isFinite(Number(ability?.event_count))
    ? Number(ability.event_count)
    : 0;

  // Stats may arrive as the stored JSON string (book_level_stats column) or the
  // already-parsed bookLevel object. Tolerate both; a parse failure just drops
  // us to the single-band fallback.
  const parseStats = (value) => {
    if (typeof value !== 'string') {
      return value ?? null;
    }
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  };

  // The caller's bookLevel: if it was graded on the old 3 NIKL grades, its
  // level rank is on that old scale too.
  const callerStats = parseStats(bookLevelStats);
  const callerIsLegacy = isLegacyKoreanStats(callerStats, normalizedLanguage);
  let stats = callerStats;

  // The caller's bookLevel may predate the distribution (bundled catalog, cloud
  // row). If we know which book this is, prefer the locally-accumulated stats
  // from preprocessing — that's the richest signal we have. Non-fatal on error.
  if (!Array.isArray(stats?.distribution) && bookUri) {
    try {
      const meta = await getBookPreprocessMeta(ownerId, bookUri, PREPROCESS_VERSION, profileId);
      const storedStats = parseStats(meta?.book_level_stats);
      if (Array.isArray(storedStats?.distribution)) {
        stats = storedStats;
      }
    } catch (_error) {
      // keep whatever stats we already had
    }
  }

  // Books preprocessed before the 6-level rescale carry NIKL grades; remap them.
  stats = normalizeLegacyKoreanStats(stats, normalizedLanguage);
  const effectiveLevelRank = callerIsLegacy ? remapLegacyKoreanRank(levelRank) : levelRank;

  const distributionEase = bookEaseFromDistribution({
    theta,
    language: normalizedLanguage,
    distribution: stats?.distribution,
  });
  const ease = distributionEase ?? bookEaseFromLevel({
    theta,
    language: normalizedLanguage,
    levelRank: effectiveLevelRank,
  });

  const rawCoverage = Number(stats?.coverage);
  return {
    ease,
    theta,
    eventCount,
    hasAbility: !!ability,
    easeSource: ease == null ? null : (distributionEase != null ? 'distribution' : 'level'),
    coverage: Number.isFinite(rawCoverage) ? rawCoverage : null,
  };
};

/**
 * ensureProfileAbilitySeed — give a cold profile a non-null ability row.
 *
 * The app no longer asks the reader to self-report a level: a cold profile seeds
 * at a NEUTRAL theta (0) with `self_report_rank = NULL` (no self-report spring),
 * and ability is learned from reading — lookups / reviews / exposure move theta
 * from there (Phase 3). A `rank` may still be passed (legacy / tests) to seed
 * from a band instead.
 *
 * Idempotent and safe to call on every app load: it only writes while the profile
 * is still cold (`event_count = 0`). Once behavior has moved theta, the seed never
 * clobbers it.
 *
 * @returns {Promise<number>} the seeded (or existing) theta.
 */
export const ensureProfileAbilitySeed = ({
  ownerId,
  profileId,
  language = 'ko',
  rank,
} = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);
  const hasRank = Number.isFinite(Number(rank));
  const normalizedRank = hasRank ? Math.round(Number(rank)) : null;
  const theta = hasRank ? seedThetaFromRank(normalizedLanguage, normalizedRank) : 0;
  const now = new Date().toISOString();

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      // INSERT the seed if absent; on an existing row only refresh the seed while
      // the profile is still cold. `synced_at = NULL` forces a re-push after any
      // write. Warm rows (event_count > 0) are left untouched by the DO UPDATE
      // guard `WHERE profile_ability.event_count = 0`.
      tx.executeSql(
        `INSERT INTO profile_ability (
           owner_id, profile_id, language, theta, self_report_rank,
           event_count, seeded_at, updated_at, synced_at
         )
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, NULL)
         ON CONFLICT(owner_id, profile_id, language) DO UPDATE SET
           theta = excluded.theta,
           self_report_rank = excluded.self_report_rank,
           seeded_at = excluded.seeded_at,
           updated_at = excluded.updated_at,
           synced_at = NULL
         WHERE profile_ability.event_count = 0`,
        [scopedOwnerId, scopedProfileId, normalizedLanguage, theta, normalizedRank, now, now],
        () => resolve(theta),
        (_, error) => {
          console.error('[Database] Error seeding profile ability:', error);
          reject(error);
        }
      );
    });
  });
};

/**
 * getUnsyncedProfileAbilities — rows whose latest write hasn't been pushed to the
 * cloud yet (synced_at IS NULL). Used by the push sync (profileAbilityCloudSync).
 */
export const getUnsyncedProfileAbilities = (ownerId) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT * FROM profile_ability
         WHERE owner_id = ? AND synced_at IS NULL`,
        [scopedOwnerId],
        (_, result) => resolve(result.rows._array ?? []),
        (_, error) => {
          console.error('[Database] Error reading unsynced profile abilities:', error);
          reject(error);
        }
      );
    });
  });
};

/**
 * markProfileAbilitiesSynced — stamp `synced_at` after a successful cloud push.
 * Guarded on `updated_at` so a write that lands between the push and this stamp
 * isn't marked synced prematurely (it will re-push next cycle).
 */
export const markProfileAbilitiesSynced = (rows, syncedAt = new Date().toISOString()) => {
  const targets = (Array.isArray(rows) ? rows : []).filter((row) => row && row.id != null);
  if (targets.length === 0) {
    return Promise.resolve(0);
  }

  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        targets.forEach((row) => {
          tx.executeSql(
            `UPDATE profile_ability SET synced_at = ?
             WHERE id = ? AND updated_at = ?`,
            [syncedAt, row.id, row.updated_at ?? null]
          );
        });
      },
      (error) => {
        console.error('[Database] Error marking profile abilities synced:', error);
        reject(error);
      },
      () => resolve(targets.length)
    );
  });
};

// Neutral ability for a profile with no self-report seed yet (midpoint of the
// shared scale) — matches the fallback the scorer uses in scoreWordsForProfile.
const NEUTRAL_THETA = (ABILITY_THETA_MIN + ABILITY_THETA_MAX) / 2;

/**
 * countWordSignals — how many lookups and words-read-past each stem already
 * has, for the level engine's repeat discount (levelEngine.repeatWeight).
 */
const countWordSignals = ({ ownerId, profileId, language }, stems) => new Promise((resolve) => {
  const list = Array.from(new Set((stems || []).filter(Boolean)));
  const counts = new Map();
  if (list.length === 0) {
    resolve(counts);
    return;
  }
  db.transaction(tx => {
    chunkValues(list).forEach((chunk) => {
      tx.executeSql(
        `SELECT stem, COUNT(*) AS n FROM interaction_events
         WHERE owner_id = ? AND profile_id = ? AND language = ?
           AND event_type IN ('lookup', 'exposure') AND deleted_at IS NULL
           AND stem IN (${chunk.map(() => '?').join(', ')})
         GROUP BY stem`,
        [ownerId, profileId, language, ...chunk],
        (_, result) => {
          (result.rows._array ?? []).forEach((row) => counts.set(row.stem, Number(row.n) || 0));
        }
      );
    });
  }, () => resolve(counts), () => resolve(counts));
});

/**
 * updateThetaFromOutcome — fold one signal about one word (a lookup, a review,
 * a word-check answer) into the profile's level through the level engine, and
 * log the change. Fire-and-forget from the callers: a failure here must never
 * block or alter the lookup or review itself.
 *
 * Difficulty comes from getWordDifficulties (level, frequency, loanword) when
 * not passed in. A word we know nothing about is skipped rather than moving
 * the level on a guess.
 *
 * @returns {Promise<number|null>} the new theta, or null if the update was skipped.
 */
export const updateThetaFromOutcome = async ({
  ownerId,
  profileId,
  language = 'ko',
  stem,
  word = null,
  difficulty,
  outcome,
  // 'lookup' | 'review' | 'check'. Older callers passed only a learning rate;
  // map those so they keep working.
  signal,
  learningRate,
  sourceBookUri = null,
} = {}) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const y = outcome === 1 || outcome === true ? 1 : (outcome === 0 || outcome === false ? 0 : null);
  const type = signal
    || (learningRate === LOOKUP_LEARNING_RATE ? 'lookup' : null)
    || (Number(learningRate) >= 0.5 ? 'check' : 'review');
  if (y == null && type !== 'lookup') {
    return null;
  }

  // Resolve the word's difficulty if the caller didn't supply it. A word we
  // know nothing about (no level, no frequency) is skipped: it would only
  // move the level by a guess.
  const cleanStem = typeof stem === 'string' ? stem.trim() : '';
  let wordDifficultyValue = Number(difficulty);
  let details = null;
  if (!Number.isFinite(wordDifficultyValue)) {
    if (!cleanStem) {
      return null;
    }
    const diffs = await getWordDifficulties(normalizedLanguage, [cleanStem]);
    const entry = diffs?.[cleanStem];
    if (!entry || entry.isFallback || !Number.isFinite(Number(entry.difficulty))) {
      return null;
    }
    wordDifficultyValue = Number(entry.difficulty);
    details = entry.details ?? null;
  }

  // The lookup itself is already in the event log when this runs, so it is
  // not counted as its own repeat.
  let weight = 1;
  if (type === 'lookup' && cleanStem) {
    const scope = {
      ownerId: resolveOwnerId(ownerId),
      profileId: resolveProfileId(profileId, normalizedLanguage),
      language: normalizedLanguage,
    };
    const counts = await countWordSignals(scope, [cleanStem]);
    weight = repeatWeight(Math.max(0, (counts.get(cleanStem) || 0) - 1));
  }

  const state = await updateReaderLevel({ ownerId, profileId, language: normalizedLanguage }, (before) => {
    const { state: next, log } = applyLevelSignal(before, {
      type,
      difficulty: wordDifficultyValue,
      outcome: y,
      weight,
    });
    if (!log) return null;
    return {
      state: next,
      logs: [{
        ...log,
        word: word ?? cleanStem ?? null,
        stem: cleanStem || null,
        sourceBookUri,
        details,
      }],
    };
  });
  return state ? state.theta : null;
};

/**
 * applyExposureBatch — fold one page's worth of underlined words read past
 * without a lookup into the level, as 'pass' signals, and append the matching
 * exposure events. One read and one write of the ability row per page.
 *
 * How much a pass counts depends on the reader's learned lookup rate (see
 * services/levelEngine.js): from a reader who taps most unknown words, a
 * skipped word is good evidence they knew it; from one who rarely taps, it
 * says little. A word already counted today is skipped, and so are words we
 * know nothing about.
 *
 * @param {object}   args
 * @param {string[]} args.stems      words shown and not looked up
 * @param {number}   [args.dwellSeconds]  logged on each event for later fitting
 * @returns {Promise<{ theta: number|null, applied: number }>}
 */
export const applyExposureBatch = async ({
  ownerId,
  profileId,
  language = 'ko',
  stems = [],
  sourceBookUri = null,
  dwellSeconds = null,
} = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);

  const cleanStems = Array.from(new Set(
    (Array.isArray(stems) ? stems : [])
      .filter((stem) => typeof stem === 'string' && stem.trim())
      .map((stem) => stem.trim())
  ));
  if (cleanStems.length === 0) {
    return { theta: null, applied: 0 };
  }

  // A word read past again the same day (rereading a page, paging back and
  // forth) says nothing new; count it once a day.
  const seenToday = await new Promise((resolve) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT DISTINCT stem FROM interaction_events
         WHERE owner_id = ? AND profile_id = ? AND language = ? AND event_type = 'exposure'
           AND created_at >= ? AND stem IN (${cleanStems.map(() => '?').join(', ')})`,
        [
          scopedOwnerId,
          scopedProfileId,
          normalizedLanguage,
          `${new Date().toISOString().slice(0, 10)}T00:00:00`,
          ...cleanStems,
        ],
        (_, result) => resolve(new Set((result.rows._array ?? []).map((row) => row.stem))),
        () => resolve(new Set())
      );
    });
  });
  const fresh = cleanStems.filter((stem) => !seenToday.has(stem));
  if (fresh.length === 0) {
    return { theta: null, applied: 0 };
  }

  const difficulties = await getWordDifficulties(normalizedLanguage, fresh);
  const graded = fresh
    .map((stem) => ({ stem, entry: difficulties?.[stem] }))
    .filter(({ entry }) => (
      entry && !entry.isFallback && Number.isFinite(Number(entry.difficulty))
    ));

  if (graded.length === 0) {
    return { theta: null, applied: 0 };
  }

  const previous = await countWordSignals(
    { ownerId: scopedOwnerId, profileId: scopedProfileId, language: normalizedLanguage },
    graded.map(({ stem }) => stem)
  );

  // Log BEFORE the derived state is written, matching logInteractionEvent's
  // contract, so the historical outcome survives even if the write below fails.
  await Promise.all(graded.map(({ stem }) => logInteractionEvent({
    ownerId: scopedOwnerId,
    profileId: scopedProfileId,
    language: normalizedLanguage,
    word: stem,
    stem,
    eventType: 'exposure',
    outcome: 1,
    valueNum: Number.isFinite(Number(dwellSeconds)) ? Number(dwellSeconds) : null,
    sourceBookUri,
  }).catch((error) => {
    console.warn('[Database] Failed to log exposure event:', error);
  })));

  const state = await updateReaderLevel(
    { ownerId: scopedOwnerId, profileId: scopedProfileId, language: normalizedLanguage },
    (before) => {
      let current = before;
      const logs = [];
      graded.forEach(({ stem, entry }) => {
        const { state: next, log } = applyLevelSignal(current, {
          type: 'pass',
          difficulty: Number(entry.difficulty),
          weight: repeatWeight(previous.get(stem) || 0),
        });
        if (!log) return;
        current = next;
        logs.push({
          ...log,
          word: stem,
          stem,
          sourceBookUri,
          details: {
            ...(entry.details || {}),
            dwellSeconds: Number(dwellSeconds) || null,
            seenBefore: previous.get(stem) || 0,
          },
        });
      });
      return logs.length > 0 ? { state: current, logs } : null;
    }
  );
  return { theta: state ? state.theta : null, applied: state ? graded.length : 0 };
};

/**
 * setProfileAbilityFromVocab — seed `theta` directly from the vocabulary-size
 * grid pick (Profile cold start; see services/vocabSizeLevels.js).
 *
 * Unlike `ensureProfileAbilitySeed` (which only seeds a cold, band-selected
 * profile), this is an explicit measurement, so it overwrites `theta`
 * unconditionally. It also lifts `event_count` to at least 1, which flips the
 * profile out of "cold" state — that's what protects this continuous theta from
 * being clobbered on the next app load by `ensureProfileAbilitySeed`'s
 * `WHERE event_count = 0` guard (exactly how a quiz tap protected its measurement).
 * `self_report_rank` is stored so any later behavioral update still has a sane
 * anchor to fade from.
 *
 * @returns {Promise<number>} the seeded theta.
 */
export const setProfileAbilityFromVocab = async ({
  ownerId,
  profileId,
  language = 'ko',
  theta,
  nearestRank = null,
  variance = SEED_VARIANCE,
  signal = 'seed',
  details = null,
} = {}) => {
  const seededTheta = Number.isFinite(Number(theta)) ? Number(theta) : NEUTRAL_THETA;
  const rank = Number.isFinite(Number(nearestRank)) ? Math.round(Number(nearestRank)) : null;
  const now = new Date().toISOString();
  const state = await updateReaderLevel({ ownerId, profileId, language }, (before) => {
    const next = seedState(before, { theta: seededTheta, variance, at: now });
    // At least one event, so the cold-start prompt does not ask again.
    next.eventCount = Math.max(before.eventCount, 1);
    return {
      state: next,
      selfReportRank: rank,
      seededAt: now,
      logs: [{
        signal,
        thetaBefore: before.theta,
        thetaAfter: next.theta,
        varianceBefore: before.variance,
        varianceAfter: next.variance,
        details: { ...(details || {}), nearestRank: rank },
        at: now,
      }],
    };
  });
  return state ? state.theta : seededTheta;
};

/**
 * getWordDifficulties — resolve the knowledge-based difficulty for a list of
 * stems (Phase 2.2). Difficulty is the KB prior only; it is user-independent, so
 * this reads the shared, device-global `dictionary_cache` (NOT owner-scoped) where
 * `level_rank` is already populated by the preprocess/lookup pipeline — no extra
 * backend round trip.
 *
 * Every requested stem gets an entry so callers never have to guess about gaps: a
 * stem with no graded-KB rank comes back with `isFallback: true` and the OOV
 * difficulty (plan §4.1 — missing features are explicit, not silently zero).
 *
 * @param {string} language  target language code (ko | zh | en)
 * @param {string[]} stems   base forms to score (as stored in dictionary_cache)
 * @returns {Promise<Object<string, { levelRank: number|null, difficulty: number, isFallback: boolean }>>}
 */
export const getWordDifficulties = (language, stems) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const requested = Array.from(new Set(
    (Array.isArray(stems) ? stems : [])
      .filter((stem) => typeof stem === 'string' && stem.trim())
      .map((stem) => stem.trim())
  ));

  if (requested.length === 0) {
    return Promise.resolve({});
  }

  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        // Accumulate the first non-null value of each feature per stem across
        // the cache's per-interface-language rows.
        const byStem = {};
        chunkValues(requested).forEach((chunk) => {
          const placeholders = chunk.map(() => '?').join(', ');
          tx.executeSql(
            `SELECT stem, level_rank, difficulty_percentile, zipf, loanword FROM dictionary_cache
             WHERE language = ? AND stem IN (${placeholders})`,
            [normalizedLanguage, ...chunk],
            (_, result) => {
              (result.rows._array ?? []).forEach((row) => {
                const cur = byStem[row.stem] || (byStem[row.stem] = {});
                ['level_rank', 'difficulty_percentile', 'zipf', 'loanword'].forEach((key) => {
                  if (cur[key] == null && row[key] != null) cur[key] = row[key];
                });
              });
            }
          );
        });

        // Resolve after the reads land; build the result for EVERY requested stem.
        tx.executeSql(
          'SELECT 1',
          [],
          () => {
            const difficulties = {};
            requested.forEach((stem) => {
              const row = byStem[stem] || {};
              const levelRank = row.level_rank ?? null;
              const resolved = wordDifficulty({
                language: normalizedLanguage,
                levelRank,
                percentile: row.difficulty_percentile,
                zipf: row.zipf,
                loanword: row.loanword,
              });
              difficulties[stem] = {
                levelRank,
                difficulty: resolved.difficulty,
                isFallback: !resolved.graded,
                details: {
                  levelRank,
                  percentile: row.difficulty_percentile ?? null,
                  zipf: row.zipf ?? null,
                  loanword: resolved.parts.loanword || undefined,
                },
              };
            });
            resolve(difficulties);
          }
        );
      },
      (error) => {
        console.error('[Database] Error reading word difficulties:', error);
        reject(error);
      }
    );
  });
};

// ─── Word scores cache (Phase 2.3 of the personalized vocabulary model) ───────
//
// The baseline scorer, P(known) = sigmoid(theta - difficulty_word), must cover
// every word on a rendered page — including words the user has never saved. Saved
// words cache their score on `vocab.p_known`; this table caches it for everyone
// else, so a page read never has to recompute or round-trip per word (design doc
// §4 serving: "precompute on write, not read").
//
// It is a pure DERIVED cache: fully reconstructible from `theta` (profile_ability)
// plus `level_rank` (dictionary_cache). So it is deliberately LOCAL-ONLY — not
// synced to the cloud and not listed in the sync table sets. `theta` and
// `scored_at` are stored so Phase 3 can detect and refresh scores that went stale
// when behavior moved the user's ability.

export const createWordScoresTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS word_scores (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id     TEXT NOT NULL DEFAULT 'guest',
          profile_id   TEXT DEFAULT 'ko_default',
          language     TEXT DEFAULT 'ko',
          stem         TEXT NOT NULL,
          level_rank   INTEGER,
          difficulty   REAL,
          theta        REAL,
          p_known      REAL,
          is_fallback  INTEGER DEFAULT 0,
          source_book_uri TEXT,
          scored_at    TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at   TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(owner_id, profile_id, language, stem)
        )`,
        [],
        () => {
          tx.executeSql(
            `CREATE UNIQUE INDEX IF NOT EXISTS idx_word_scores_scope_stem
             ON word_scores(owner_id, profile_id, language, stem)`
          );
          tx.executeSql(
            `CREATE INDEX IF NOT EXISTS idx_word_scores_scope
             ON word_scores(owner_id, profile_id, language)`
          );
          resolve();
        },
        (_, error) => {
          console.error('[Database] Error creating word_scores table:', error);
          reject(error);
        }
      );
    });
  });
};

export const migrateWordScoresTable = async () => {
  const columns = await getTableColumns('word_scores');
  if (columns.length === 0) {
    // Table doesn't exist yet (createWordScoresTable not run); nothing to migrate.
    return;
  }

  const alterations = [];
  const ensureColumn = (name, ddl) => {
    if (!columns.includes(name)) {
      alterations.push(`ALTER TABLE word_scores ADD COLUMN ${ddl}`);
    }
  };

  ensureColumn('level_rank', 'level_rank INTEGER');
  ensureColumn('difficulty', 'difficulty REAL');
  ensureColumn('theta', 'theta REAL');
  ensureColumn('p_known', 'p_known REAL');
  ensureColumn('is_fallback', 'is_fallback INTEGER DEFAULT 0');
  ensureColumn('source_book_uri', 'source_book_uri TEXT');
  ensureColumn('scored_at', 'scored_at TEXT');
  ensureColumn('updated_at', 'updated_at TEXT');

  if (alterations.length === 0) {
    return;
  }

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        alterations.forEach((statement) => tx.executeSql(statement));
      },
      (error) => {
        console.error('[Database] Error migrating word_scores table:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

/**
 * getWordScores — read cached baseline scores for a list of stems from the
 * unsaved-word cache. Returns a map keyed by stem (only stems with a cached row
 * are present; callers should treat a missing stem as "not scored yet").
 */
export const getWordScores = (language, stems, { ownerId, profileId } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);
  const requested = Array.from(new Set(
    (Array.isArray(stems) ? stems : [])
      .filter((stem) => typeof stem === 'string' && stem.trim())
      .map((stem) => stem.trim())
  ));

  if (requested.length === 0) {
    return Promise.resolve({});
  }

  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        const byStem = {};
        chunkValues(requested).forEach((chunk) => {
          const placeholders = chunk.map(() => '?').join(', ');
          tx.executeSql(
            `SELECT * FROM word_scores
             WHERE owner_id = ? AND profile_id = ? AND language = ?
               AND stem IN (${placeholders})`,
            [scopedOwnerId, scopedProfileId, normalizedLanguage, ...chunk],
            (_, result) => {
              (result.rows._array ?? []).forEach((row) => {
                byStem[row.stem] = row;
              });
            }
          );
        });
        tx.executeSql('SELECT 1', [], () => resolve(byStem));
      },
      (error) => {
        console.error('[Database] Error reading word scores:', error);
        reject(error);
      }
    );
  });
};

/**
 * saveWordScores — upsert baseline scores into the unsaved-word cache. `entries`
 * is an array of `{ stem, levelRank, difficulty, pKnown, isFallback }`; `theta`
 * and `sourceBookUri` are shared context stored on every row for staleness
 * detection and provenance. Idempotent per (scope, stem): re-scoring overwrites.
 */
export const saveWordScores = (entries, { ownerId, profileId, language, theta, sourceBookUri = null } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);
  const thetaValue = Number.isFinite(Number(theta)) ? Number(theta) : null;
  const rows = (Array.isArray(entries) ? entries : []).filter(
    (entry) => entry && typeof entry.stem === 'string' && entry.stem.trim()
  );

  if (rows.length === 0) {
    return Promise.resolve(0);
  }

  const now = new Date().toISOString();

  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        rows.forEach((entry) => {
          tx.executeSql(
            `INSERT INTO word_scores (
               owner_id, profile_id, language, stem, level_rank, difficulty,
               theta, p_known, is_fallback, source_book_uri, scored_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(owner_id, profile_id, language, stem) DO UPDATE SET
               level_rank = excluded.level_rank,
               difficulty = excluded.difficulty,
               theta = excluded.theta,
               p_known = excluded.p_known,
               is_fallback = excluded.is_fallback,
               source_book_uri = excluded.source_book_uri,
               scored_at = excluded.scored_at,
               updated_at = excluded.updated_at`,
            [
              scopedOwnerId,
              scopedProfileId,
              normalizedLanguage,
              entry.stem.trim(),
              entry.levelRank == null ? null : Number(entry.levelRank),
              entry.difficulty == null ? null : Number(entry.difficulty),
              thetaValue,
              entry.pKnown == null ? null : Number(entry.pKnown),
              entry.isFallback ? 1 : 0,
              sourceBookUri,
              now,
              now,
            ]
          );
        });
      },
      (error) => {
        console.error('[Database] Error saving word scores:', error);
        reject(error);
      },
      () => resolve(rows.length)
    );
  });
};

/**
 * updateVocabPKnown — write the baseline P(known) onto saved `vocab` rows,
 * matched by surface `word` within the given scope. Returns a Set of the words
 * that were actually present in `vocab` (so the caller knows which stems it still
 * needs to cache in `word_scores`). Only mutates `p_known` — SRS/FSRS state and
 * `updated_at` are left untouched so this cache write never triggers a cloud
 * re-sync of the vocab row.
 */
export const updateVocabPKnown = (scoresByWord, { ownerId, profileId, language } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);
  const entries = Object.entries(scoresByWord || {}).filter(
    ([word, value]) => typeof word === 'string' && word.trim() && Number.isFinite(Number(value))
  );

  if (entries.length === 0) {
    return Promise.resolve(new Set());
  }

  const words = entries.map(([word]) => word.trim());

  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        const matched = new Set();
        // First find which words actually exist as saved vocab rows in scope.
        chunkValues(words).forEach((chunk) => {
          const placeholders = chunk.map(() => '?').join(', ');
          tx.executeSql(
            `SELECT DISTINCT word FROM vocab
             WHERE owner_id = ? AND profile_id = ? AND language = ?
               AND deleted_at IS NULL AND word IN (${placeholders})`,
            [scopedOwnerId, scopedProfileId, normalizedLanguage, ...chunk],
            (_, result) => {
              (result.rows._array ?? []).forEach((row) => matched.add(row.word));
            }
          );
        });
        // Then write p_known for each matched word.
        entries.forEach(([word, value]) => {
          tx.executeSql(
            `UPDATE vocab SET p_known = ?
             WHERE owner_id = ? AND profile_id = ? AND language = ?
               AND deleted_at IS NULL AND word = ?`,
            [Number(value), scopedOwnerId, scopedProfileId, normalizedLanguage, word.trim()]
          );
        });
        tx.executeSql('SELECT 1', [], () => resolve(matched));
      },
      (error) => {
        console.error('[Database] Error updating vocab p_known:', error);
        reject(error);
      }
    );
  });
};

/**
 * scoreWordsForProfile — the Phase 2.3 orchestrator. Given a set of stems (e.g.
 * every word on a page), it:
 *   1. reads the profile's ability `theta` (profile_ability),
 *   2. resolves each word's KB difficulty (getWordDifficulties),
 *   3. computes P(known) = sigmoid(theta - difficulty) (pure `pKnown`),
 *   4. caches the result — saved words onto `vocab.p_known`, the rest into
 *      `word_scores`,
 * and returns the full in-memory score map keyed by stem so the caller can use it
 * immediately without a re-read. Phase 2.4 calls this from the preprocess flow.
 *
 * If the profile has no seeded ability yet, theta falls back to the scale
 * midpoint (0) so scoring still produces sane, ordered values; the fallback theta
 * is stored on the cached rows so a later re-score can supersede it.
 */
export const scoreWordsForProfile = async ({
  ownerId,
  profileId,
  language = 'ko',
  stems,
  sourceBookUri = null,
} = {}) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const requested = Array.from(new Set(
    (Array.isArray(stems) ? stems : [])
      .filter((stem) => typeof stem === 'string' && stem.trim())
      .map((stem) => stem.trim())
  ));

  if (requested.length === 0) {
    return {};
  }

  const abilityRow = await getProfileAbility({ ownerId, profileId, language: normalizedLanguage });
  const theta = Number.isFinite(Number(abilityRow?.theta))
    ? Number(abilityRow.theta)
    : (ABILITY_THETA_MIN + ABILITY_THETA_MAX) / 2;
  if (!Number.isFinite(Number(abilityRow?.theta))) {
    console.warn('[Database] scoreWordsForProfile: no seeded theta; using neutral midpoint.');
  }

  const difficulties = await getWordDifficulties(normalizedLanguage, requested);

  // Compute the IRT baseline score for every word first. This is always the
  // fallback and still supplies the difficulty/theta the cache records.
  const scores = {};
  requested.forEach((stem) => {
    const info = difficulties[stem] ?? {
      levelRank: null,
      difficulty: OOV_DIFFICULTY,
      isFallback: true,
    };
    scores[stem] = {
      stem,
      levelRank: info.levelRank ?? null,
      difficulty: info.difficulty,
      isFallback: !!info.isFallback,
      pKnown: pKnown(theta, info.difficulty),
      theta,
      source: 'baseline',
    };
  });

  // Phase 4.3: if a full pooled model is registered, its scores REPLACE the
  // baseline for the same words (read path unchanged — the cache columns are the
  // same). Model-agnostic: we only call `model.score(featureRecord)`. Assemble
  // features once for the whole batch (compute-on-write). Non-fatal: a scoring
  // failure leaves the baseline score in place rather than breaking preprocessing.
  const model = getActivePknownModel();
  if (model && typeof model.score === 'function') {
    try {
      const features = await assembleWordFeatures({
        ownerId,
        profileId,
        language: normalizedLanguage,
        stems: requested,
        sourceBookUri,
      });
      requested.forEach((stem) => {
        const record = features[stem];
        if (!record) return;
        const p = model.score(record);
        if (Number.isFinite(p)) {
          scores[stem].pKnown = p;
          scores[stem].source = `model:v${model.version ?? '?'}`;
        }
      });
    } catch (error) {
      console.warn('[Database] scoreWordsForProfile: full-model scoring failed; kept baseline.', error);
    }
  }

  // Saved words get their score on vocab.p_known; the rest go to word_scores.
  const scoresByWord = {};
  requested.forEach((stem) => { scoresByWord[stem] = scores[stem].pKnown; });
  const savedWords = await updateVocabPKnown(scoresByWord, {
    ownerId,
    profileId,
    language: normalizedLanguage,
  });

  const unsavedEntries = requested
    .filter((stem) => !savedWords.has(stem))
    .map((stem) => scores[stem]);
  await saveWordScores(unsavedEntries, {
    ownerId,
    profileId,
    language: normalizedLanguage,
    theta,
    sourceBookUri,
  });

  return scores;
};

// ─── Feature assembly (Phase 4.1 of the personalized vocabulary model) ────────
//
// Gathers, for a batch of stems in one (owner, profile, language) scope, all the
// raw rows the pure `assembleFeatures` needs — dictionary_cache (KB + item),
// profile_ability (user), saved vocab (SRS + explicit), interaction_events
// aggregates (explicit), in-book frequency (item), and the user's known-hanja set
// (cross-word transfer) — then produces one feature record per stem. Batched and
// computed-on-write, matching the §4 serving rule (precompute, don't infer at
// read time). Every raw source is optional: a missing source becomes an explicit
// `present: false` feature, never a silent zero.

// Small promise wrapper for a read-only query (this section does several).
const runSelect = (sql, params = []) => new Promise((resolve, reject) => {
  db.transaction(tx => {
    tx.executeSql(
      sql,
      params,
      (_, result) => resolve(result.rows._array ?? []),
      (_, error) => {
        console.error('[Database] assembleWordFeatures query failed:', error);
        reject(error);
        return true;
      }
    );
  });
});

const CJK_CHAR = /[一-鿿㐀-䶿]/g;

export const assembleWordFeatures = async ({
  ownerId,
  profileId,
  language = 'ko',
  stems,
  sourceBookUri = null,
  l1 = null,
  now = Date.now(),
} = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);
  const requested = Array.from(new Set(
    (Array.isArray(stems) ? stems : [])
      .filter((s) => typeof s === 'string' && s.trim())
      .map((s) => s.trim())
  ));
  if (requested.length === 0) {
    return {};
  }

  // 1. dictionary_cache — coalesce the best non-null field per stem across the
  //    per-interface-language rows (language-scoped, device-global cache).
  const dictByStem = {};
  await Promise.all(chunkValues(requested).map(async (chunk) => {
    const ph = chunk.map(() => '?').join(', ');
    const rows = await runSelect(
      `SELECT stem, pos, hanja, level_rank, difficulty_percentile, definition FROM dictionary_cache
       WHERE language = ? AND stem IN (${ph})`,
      [normalizedLanguage, ...chunk]
    );
    rows.forEach((row) => {
      const cur = dictByStem[row.stem] ?? (dictByStem[row.stem] = {
        pos: null, hanja: null, level_rank: null, difficulty_percentile: null, definition: null,
      });
      if (cur.pos == null && row.pos) cur.pos = row.pos;
      if (cur.hanja == null && row.hanja) cur.hanja = row.hanja;
      if (cur.level_rank == null && row.level_rank != null) cur.level_rank = row.level_rank;
      if (cur.difficulty_percentile == null && row.difficulty_percentile != null) {
        cur.difficulty_percentile = row.difficulty_percentile;
      }
      if (cur.definition == null && row.definition) cur.definition = row.definition;
    });
  }));

  // 2. profile_ability — one row for the whole scope (shared across stems).
  const ability = await getProfileAbility({
    ownerId: scopedOwnerId, profileId: scopedProfileId, language: normalizedLanguage,
  });

  // 3. saved vocab rows (matched by surface `word`, like updateVocabPKnown).
  const vocabByStem = {};
  await Promise.all(chunkValues(requested).map(async (chunk) => {
    const ph = chunk.map(() => '?').join(', ');
    const rows = await runSelect(
      `SELECT word, hanja, stability, difficulty, correct_count, wrong_count,
              last_reviewed_at, next_review_at, updated_at
       FROM vocab
       WHERE owner_id = ? AND profile_id = ? AND language = ? AND deleted_at IS NULL
         AND word IN (${ph})`,
      [scopedOwnerId, scopedProfileId, normalizedLanguage, ...chunk]
    );
    rows.forEach((row) => { if (!vocabByStem[row.word]) vocabByStem[row.word] = row; });
  }));

  // 4. interaction_events aggregates per stem: review / lookup counts + last lookup.
  const eventsByStem = {};
  await Promise.all(chunkValues(requested).map(async (chunk) => {
    const ph = chunk.map(() => '?').join(', ');
    const rows = await runSelect(
      `SELECT stem, event_type, COUNT(*) AS cnt, MAX(created_at) AS last_at
       FROM interaction_events
       WHERE owner_id = ? AND profile_id = ? AND language = ? AND deleted_at IS NULL
         AND stem IN (${ph})
       GROUP BY stem, event_type`,
      [scopedOwnerId, scopedProfileId, normalizedLanguage, ...chunk]
    );
    rows.forEach((row) => {
      const agg = eventsByStem[row.stem] ?? (eventsByStem[row.stem] = {
        reviewCount: 0, lookupCount: 0, lastLookupAt: null,
      });
      if (row.event_type === 'review') agg.reviewCount = row.cnt;
      if (row.event_type === 'lookup') { agg.lookupCount = row.cnt; agg.lastLookupAt = row.last_at; }
    });
  }));

  // 5. in-book frequency proxy (distinct surfaces per stem in the current book).
  const inBookByStem = {};
  if (sourceBookUri) {
    await Promise.all(chunkValues(requested).map(async (chunk) => {
      const ph = chunk.map(() => '?').join(', ');
      const rows = await runSelect(
        `SELECT dc.stem AS stem, COUNT(*) AS freq
         FROM book_index bi
         JOIN dictionary_cache dc ON dc.id = bi.stem_id
         WHERE bi.owner_id = ? AND bi.profile_id = ? AND bi.book_uri = ?
           AND dc.language = ? AND dc.stem IN (${ph})
         GROUP BY dc.stem`,
        [scopedOwnerId, scopedProfileId, sourceBookUri, normalizedLanguage, ...chunk]
      );
      rows.forEach((row) => { inBookByStem[row.stem] = row.freq; });
    }));
  }

  // 6. known-hanja set — hanja chars from the user's OTHER saved words, for the
  //    cross-word transfer feature (capped until Tier 4).
  const knownHanjaSet = new Set();
  const hanjaRows = await runSelect(
    `SELECT DISTINCT hanja FROM vocab
     WHERE owner_id = ? AND profile_id = ? AND language = ? AND deleted_at IS NULL
       AND hanja IS NOT NULL AND hanja != ''`,
    [scopedOwnerId, scopedProfileId, normalizedLanguage]
  );
  hanjaRows.forEach((row) => {
    (String(row.hanja).match(CJK_CHAR) ?? []).forEach((c) => knownHanjaSet.add(c));
  });

  const out = {};
  requested.forEach((stem) => {
    out[stem] = assembleFeatures({
      language: normalizedLanguage,
      stem,
      l1,
      dict: dictByStem[stem] ?? null,
      ability,
      vocab: vocabByStem[stem] ?? null,
      inBookFreq: inBookByStem[stem],
      events: eventsByStem[stem] ?? {},
      knownHanjaSet,
      now,
    });
  });
  return out;
};

/**
 * getCachedPKnown — the cached P(known) for a single word, or null if it hasn't
 * been scored yet. Reads the unsaved-word cache (`word_scores`); used by the save
 * flows to seed a brand-new card's FSRS state (Phase 4.4).
 */
export const getCachedPKnown = async ({ ownerId, profileId, language = 'ko', word } = {}) => {
  const stem = typeof word === 'string' ? word.trim() : '';
  if (!stem) return null;
  const scores = await getWordScores(language, [stem], { ownerId, profileId });
  const p = scores?.[stem]?.p_known;
  return Number.isFinite(Number(p)) ? Number(p) : null;
};

/**
 * nominateFlashcards — rank unsaved words in a book as flashcard candidates
 * (Phase 4.4, design doc §5.2): nomination_score = uncertainty(P_known) ×
 * (1 − remaining_in_book_exposure). Candidates are the words scored for the book
 * in `word_scores` (saved words are excluded — they're already cards); remaining
 * exposure is the in-book frequency proxy (book_index ⋈ dictionary_cache).
 *
 * @returns {Promise<{stem, pKnown, remainingCount, uncertainty, nominationScore}[]>}
 */
export const nominateFlashcards = async ({
  ownerId,
  profileId,
  language = 'ko',
  sourceBookUri,
  limit = 20,
} = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);
  if (!sourceBookUri) return [];

  // Candidate pool: words scored for this book (word_scores holds only unsaved
  // words, so saved cards are already excluded).
  const scoreRows = await runSelect(
    `SELECT stem, p_known FROM word_scores
     WHERE owner_id = ? AND profile_id = ? AND language = ? AND source_book_uri = ?
       AND p_known IS NOT NULL`,
    [scopedOwnerId, scopedProfileId, normalizedLanguage, sourceBookUri]
  );
  if (scoreRows.length === 0) return [];

  const stems = scoreRows.map((r) => r.stem);

  // Defensive: drop any that have since been saved (scored before a later save).
  const savedSet = new Set();
  await Promise.all(chunkValues(stems).map(async (chunk) => {
    const ph = chunk.map(() => '?').join(', ');
    const rows = await runSelect(
      `SELECT DISTINCT word FROM vocab
       WHERE owner_id = ? AND profile_id = ? AND language = ? AND deleted_at IS NULL
         AND word IN (${ph})`,
      [scopedOwnerId, scopedProfileId, normalizedLanguage, ...chunk]
    );
    rows.forEach((r) => savedSet.add(r.word));
  }));

  // Remaining in-book exposure per stem (distinct-surface proxy).
  const freqByStem = {};
  await Promise.all(chunkValues(stems).map(async (chunk) => {
    const ph = chunk.map(() => '?').join(', ');
    const rows = await runSelect(
      `SELECT dc.stem AS stem, COUNT(*) AS freq
       FROM book_index bi
       JOIN dictionary_cache dc ON dc.id = bi.stem_id
       WHERE bi.owner_id = ? AND bi.profile_id = ? AND bi.book_uri = ?
         AND dc.language = ? AND dc.stem IN (${ph})
       GROUP BY dc.stem`,
      [scopedOwnerId, scopedProfileId, sourceBookUri, normalizedLanguage, ...chunk]
    );
    rows.forEach((r) => { freqByStem[r.stem] = r.freq; });
  }));

  const candidates = scoreRows
    .filter((r) => !savedSet.has(r.stem))
    .map((r) => ({
      stem: r.stem,
      pKnown: r.p_known,
      remainingCount: freqByStem[r.stem] ?? 0,
    }));

  return rankNominations(candidates, { limit });
};

const getTableColumns = (tableName) => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `PRAGMA table_info(${tableName})`,
        [],
        (_, result) => resolve(result.rows._array.map((row) => row.name)),
        (_, error) => {
          console.error(`[Database] Error reading schema for ${tableName}:`, error);
          reject(error);
        }
      );
    });
  });
};

export const migrateVocabTable = async () => {
  const columns = await getTableColumns('vocab');
  const alterations = [];

  if (!columns.includes('owner_id')) {
    alterations.push(`ALTER TABLE vocab ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
  }

  if (!columns.includes('profile_id')) {
    alterations.push(`ALTER TABLE vocab ADD COLUMN profile_id TEXT DEFAULT '${DEFAULT_ACTIVE_PROFILE_ID}'`);
  }

  if (!columns.includes('source_book_uri')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN source_book_uri TEXT');
  }

  if (!columns.includes('source_book_title')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN source_book_title TEXT');
  }

  if (!columns.includes('related_known_words')) {
    alterations.push(`ALTER TABLE vocab ADD COLUMN related_known_words TEXT DEFAULT '[]'`);
  }

  // Tombstones for un-marked related known words ([{ korean, hanja, deletedAt }]).
  // Kept apart from related_known_words so screens that parse that column keep
  // seeing live entries only; sync reads both so an un-mark isn't resurrected.
  if (!columns.includes('related_known_words_deleted')) {
    alterations.push(`ALTER TABLE vocab ADD COLUMN related_known_words_deleted TEXT DEFAULT '[]'`);
  }

  if (!columns.includes('is_favorite')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN is_favorite INTEGER DEFAULT 0');
  }

  // Saved-word fading (services/savedWordFade.js): how many times the reader
  // has passed the word without looking it up since they last did, and when
  // the last one counted. Device-only; the 'learned' level it leads to syncs.
  if (!columns.includes('fade_seen')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN fade_seen INTEGER DEFAULT 0');
  }
  if (!columns.includes('fade_seen_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN fade_seen_at TEXT');
  }

  if (!columns.includes('priority')) {
    alterations.push(`ALTER TABLE vocab ADD COLUMN priority TEXT DEFAULT 'normal'`);
  }

  if (!columns.includes('created_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN created_at TEXT');
  }

  if (!columns.includes('last_reviewed_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN last_reviewed_at TEXT');
  }

  if (!columns.includes('next_review_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN next_review_at TEXT');
  }

  if (!columns.includes('correct_count')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN correct_count INTEGER DEFAULT 0');
  }

  if (!columns.includes('wrong_count')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN wrong_count INTEGER DEFAULT 0');
  }

  if (!columns.includes('stability')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN stability REAL DEFAULT 1.0');
  }

  if (!columns.includes('difficulty')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN difficulty REAL DEFAULT 5.0');
  }

  if (!columns.includes('updated_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN updated_at TEXT');
  }

  if (!columns.includes('deleted_at')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN deleted_at TEXT');
  }

  if (!columns.includes('language')) {
    alterations.push(`ALTER TABLE vocab ADD COLUMN language TEXT DEFAULT 'ko'`);
  }

  if (!columns.includes('def_key')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN def_key TEXT');
  }

  // Phase 2.3: baseline P(known) cache for saved words. Distinct from the FSRS
  // `difficulty` column above (which is FSRS's 1-10 item difficulty); this holds
  // sigmoid(theta - KB_difficulty) in (0,1). Left NULL until first scored.
  if (!columns.includes('p_known')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN p_known REAL');
  }

  // Provenance for a saved card. Currently 'ai' marks words saved from the
  // smart-definition (AI-explained) flow; NULL for ordinary dictionary saves.
  if (!columns.includes('source')) {
    alterations.push('ALTER TABLE vocab ADD COLUMN source TEXT');
  }

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        alterations.forEach((statement) => tx.executeSql(statement));
        tx.executeSql(`UPDATE vocab SET priority = 'normal' WHERE priority IS NULL`);
        tx.executeSql(`UPDATE vocab SET created_at = CURRENT_TIMESTAMP WHERE created_at IS NULL`);
        tx.executeSql(`UPDATE vocab SET correct_count = 0 WHERE correct_count IS NULL`);
        tx.executeSql(`UPDATE vocab SET wrong_count = 0 WHERE wrong_count IS NULL`);
        tx.executeSql(`UPDATE vocab SET stability = 1.0 WHERE stability IS NULL`);
        tx.executeSql(`UPDATE vocab SET difficulty = 5.0 WHERE difficulty IS NULL`);
        tx.executeSql(`UPDATE vocab SET related_known_words = '[]' WHERE related_known_words IS NULL`);
        tx.executeSql(`UPDATE vocab SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)`);
        tx.executeSql(`UPDATE vocab SET language = 'ko' WHERE language IS NULL OR TRIM(language) = ''`);
        tx.executeSql(`UPDATE vocab SET owner_id = ? WHERE owner_id IS NULL OR TRIM(owner_id) = ''`, [GUEST_OWNER_ID]);
        tx.executeSql(`UPDATE vocab SET profile_id = ? WHERE profile_id IS NULL OR TRIM(profile_id) = ''`, [DEFAULT_ACTIVE_PROFILE_ID]);
      },
      (error) => {
        console.error('[Database] Error migrating vocab table:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

const backfillVocabDefinitionKeys = async () => {
  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          'SELECT id, def FROM vocab WHERE def IS NOT NULL',
          [],
          (_, result) => {
            const rows = result.rows._array ?? [];
            rows.forEach((row) => {
              tx.executeSql(
                'UPDATE vocab SET def_key = ? WHERE id = ?',
                [makeVocabDefinitionKey(row.def), row.id]
              );
            });
          }
        );
      },
      (error) => {
        console.error('[Database] Error backfilling vocab definition keys:', error);
        reject(error);
      },
      () => resolve()
    );
  });

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          'SELECT id, def FROM vocab_contexts WHERE def IS NOT NULL',
          [],
          (_, result) => {
            const rows = result.rows._array ?? [];
            rows.forEach((row) => {
              tx.executeSql(
                'UPDATE vocab_contexts SET def_key = ? WHERE id = ?',
                [makeVocabDefinitionKey(row.def), row.id]
              );
            });
          }
        );
      },
      (error) => {
        console.error('[Database] Error backfilling vocab context definition keys:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

const timestampValue = (value) => {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
};

const earliestTimestamp = (values) => {
  const sorted = values.filter(Boolean).sort((a, b) => timestampValue(a) - timestampValue(b));
  return sorted[0] ?? null;
};

const latestTimestamp = (values) => {
  const sorted = values.filter(Boolean).sort((a, b) => timestampValue(b) - timestampValue(a));
  return sorted[0] ?? null;
};

const relatedEntryUpdatedAt = (entry) => (
  timestampValue(entry?.updatedAt ?? entry?.markedAt)
);

// Union the live related-known-word lists and their tombstones across rows that
// are being merged into one. The newest of a live entry and its tombstone wins.
const mergeRelatedKnownWordLists = (rows) => {
  const live = new Map();
  const tombstones = new Map();

  rows.forEach((row) => {
    parseRelatedKnownWords(row.related_known_words).forEach((entry) => {
      const key = relatedKnownWordKey(entry);
      const existing = live.get(key);
      if (!existing || relatedEntryUpdatedAt(entry) > relatedEntryUpdatedAt(existing)) {
        live.set(key, entry);
      }
    });
    parseRelatedKnownWords(row.related_known_words_deleted).forEach((entry) => {
      const key = relatedKnownWordKey(entry);
      const existing = tombstones.get(key);
      if (!existing || timestampValue(entry.deletedAt) > timestampValue(existing.deletedAt)) {
        tombstones.set(key, entry);
      }
    });
  });

  tombstones.forEach((tombstone, key) => {
    const entry = live.get(key);
    if (!entry) {
      return;
    }

    if (timestampValue(tombstone.deletedAt) >= relatedEntryUpdatedAt(entry)) {
      live.delete(key);
    } else {
      tombstones.delete(key);
    }
  });

  return { live: [...live.values()], tombstones: [...tombstones.values()] };
};

/**
 * One-off: rows saved with hanja '' (the "no hanja" value the reader / learn
 * screens pass) never matched their cloud copy (hanja null), so a sync pull
 * inserted a second row. Normalize '' to NULL; dedupeVocabDefinitionKeyRows,
 * which runs right after this in initAllTables and already keys ''/NULL hanja
 * the same, then merges the duplicates.
 */
export const migrateVocabEmptyHanja = async () => {
  const migrationState = await AsyncStorage.getItem(VOCAB_EMPTY_HANJA_MIGRATION_KEY);
  if (migrationState === 'done') {
    return;
  }

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(`UPDATE vocab SET hanja = NULL WHERE hanja IS NOT NULL AND TRIM(hanja) = ''`);
        tx.executeSql(`UPDATE vocab_contexts SET hanja = NULL WHERE hanja IS NOT NULL AND TRIM(hanja) = ''`);
      },
      (error) => {
        console.error('[Database] Error normalizing empty vocab hanja:', error);
        reject(error);
      },
      () => resolve()
    );
  });

  await AsyncStorage.setItem(VOCAB_EMPTY_HANJA_MIGRATION_KEY, 'done');
};

export const dedupeVocabDefinitionKeyRows = async () => {
  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          'SELECT * FROM vocab WHERE deleted_at IS NULL',
          [],
          (_, result) => {
            const groups = new Map();
            (result.rows._array ?? []).forEach((row) => {
              const key = [
                row.owner_id,
                row.profile_id,
                row.language,
                normalizeIdentityText(row.word),
                normalizeIdentityText(row.hanja),
                row.def_key ?? makeVocabDefinitionKey(row.def) ?? '',
              ].join('::');
              const rows = groups.get(key) ?? [];
              rows.push(row);
              groups.set(key, rows);
            });

            const deletedAt = new Date().toISOString();
            groups.forEach((rows) => {
              if (rows.length < 2) {
                return;
              }

              const sorted = [...rows].sort((a, b) => (
                timestampValue(b.updated_at) - timestampValue(a.updated_at)
                || timestampValue(b.created_at) - timestampValue(a.created_at)
                || Number(b.id) - Number(a.id)
              ));
              const keeper = sorted[0];
              const duplicates = sorted.slice(1);
              const correctCount = rows.reduce((sum, row) => sum + (Number(row.correct_count) || 0), 0);
              const wrongCount = rows.reduce((sum, row) => sum + (Number(row.wrong_count) || 0), 0);
              const { live: mergedRelated, tombstones: mergedTombstones } = mergeRelatedKnownWordLists(sorted);

              tx.executeSql(
                `UPDATE vocab
                 SET correct_count = ?,
                     wrong_count = ?,
                     created_at = COALESCE(?, created_at),
                     last_reviewed_at = COALESCE(?, last_reviewed_at),
                     is_favorite = ?,
                     related_known_words = ?,
                     related_known_words_deleted = ?,
                     updated_at = ?
                 WHERE id = ?`,
                [
                  Math.max(Number(keeper.correct_count) || 0, correctCount),
                  Math.max(Number(keeper.wrong_count) || 0, wrongCount),
                  earliestTimestamp(rows.map((row) => row.created_at)),
                  latestTimestamp(rows.map((row) => row.last_reviewed_at)),
                  rows.some((row) => Number(row.is_favorite) === 1) ? 1 : 0,
                  JSON.stringify(mergedRelated),
                  JSON.stringify(mergedTombstones),
                  deletedAt,
                  keeper.id,
                ]
              );

              duplicates.forEach((row) => {
                tx.executeSql(
                  'UPDATE vocab SET deleted_at = ?, updated_at = ? WHERE id = ?',
                  [deletedAt, deletedAt, row.id]
                );
                // Keep the merged-away row's example sentences attached to the
                // surviving card (getVocabContexts reads by vocab_id).
                tx.executeSql(
                  'UPDATE vocab_contexts SET vocab_id = ? WHERE vocab_id = ?',
                  [keeper.id, row.id]
                );
              });
            });
          }
        );
      },
      (error) => {
        console.error('[Database] Error deduping vocab definition keys:', error);
        reject(error);
      },
      () => resolve()
    );
  });

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          'SELECT * FROM vocab_contexts WHERE deleted_at IS NULL',
          [],
          (_, result) => {
            const groups = new Map();
            (result.rows._array ?? []).forEach((row) => {
              const key = [
                row.owner_id,
                row.profile_id,
                row.language,
                normalizeIdentityText(row.word),
                normalizeIdentityText(row.hanja),
                row.def_key ?? makeVocabDefinitionKey(row.def) ?? '',
                normalizeIdentityText(row.source_book_uri),
                normalizeIdentityText(row.sentence),
              ].join('::');
              const rows = groups.get(key) ?? [];
              rows.push(row);
              groups.set(key, rows);
            });

            const deletedAt = new Date().toISOString();
            groups.forEach((rows) => {
              if (rows.length < 2) {
                return;
              }

              const sorted = [...rows].sort((a, b) => (
                timestampValue(b.updated_at) - timestampValue(a.updated_at)
                || timestampValue(b.seen_at) - timestampValue(a.seen_at)
                || Number(b.id) - Number(a.id)
              ));
              const keeper = sorted[0];
              const latestSeenAt = latestTimestamp(rows.map((row) => row.seen_at));

              tx.executeSql(
                'UPDATE vocab_contexts SET seen_at = COALESCE(?, seen_at), updated_at = ? WHERE id = ?',
                [latestSeenAt, deletedAt, keeper.id]
              );

              sorted.slice(1).forEach((row) => {
                tx.executeSql(
                  'UPDATE vocab_contexts SET deleted_at = ?, updated_at = ? WHERE id = ?',
                  [deletedAt, deletedAt, row.id]
                );
              });
            });
          }
        );
      },
      (error) => {
        console.error('[Database] Error deduping vocab context definition keys:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

/**
 * createDictionaryCacheTable
 * Creates the `dictionary_cache` table if it doesn't exist.
 *
 * This is the "Local Cache" — every stem that has been looked up via KRDICT
 * (either during book preprocessing or from a live single-word fetch) gets stored
 * here so we never hit the API for the same word twice.
 *
 * Schema:
 *   language    — target/book language for the stem (ko, en)
 *   stem        — dictionary base form (e.g. "달리다", "사랑", "run")
 *   interface_language — KRDICT translation language for display definitions
 *   definition  — primary definition from the target dictionary
 *   gloss       — short translated label for English entries — optional
 *   hanja       — Hanja characters (e.g. "愛情"), or "N/A"
 *   pos         — part of speech (Noun, Verb, Adjective, Adverb)
 *   domain      — subject domain from KRDICT (e.g. "Law", "Science") — optional
 *   romanization — Korean romanization cached from /romanize/ — optional
 *   ipa         — English IPA pronunciation from Kaikki — optional
 *   audio_us    — authentic US pronunciation audio URL from Kaikki/Wikimedia — optional
 *   audio_uk    — authentic UK pronunciation audio URL from Kaikki/Wikimedia — optional
 *   etymology   — English etymology text from Kaikki — optional
 *   derived     — JSON array of derived English words — optional
 *   related     — JSON array of related English words — optional
 *   word_parts   — JSON payload for structured English word anatomy — optional
 *   last_updated — auto-set on insert; helps purge stale data in the future
 */
export const createDictionaryCacheTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS dictionary_cache (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          stem         TEXT NOT NULL,
          language     TEXT NOT NULL DEFAULT 'ko',
          interface_language TEXT NOT NULL DEFAULT 'en',
          definition   TEXT,
          gloss        TEXT,
          hanja        TEXT,
          pos          TEXT,
          domain       TEXT,
          romanization TEXT,
          ipa          TEXT,
          simplified   TEXT,
          traditional  TEXT,
          audio_us     TEXT,
          audio_uk     TEXT,
          etymology    TEXT,
          derived      TEXT,
          related      TEXT,
          word_parts   TEXT,
          level_rank   INTEGER,
          level_label  TEXT,
          level_system TEXT,
          level_source TEXT,
          difficulty_rank       INTEGER,
          difficulty_percentile REAL,
          zipf         REAL,
          loanword     INTEGER,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(language, stem, interface_language)
        )`,
        [],
        () => resolve(),
        (_, error) => {
          console.error("[Database] Error creating dictionary_cache table:", error);
          reject(error);
        }
      );
    });
  });
};

export const migrateDictionaryCache = async () => {
  const migrationState = await AsyncStorage.getItem(DICTIONARY_CACHE_MIGRATION_KEY);
  if (migrationState === 'done') return;

  const columns = await getTableColumns('dictionary_cache');
  const selectLanguage = sqlNormalizedColumnOrDefault(columns, 'language', 'ko');
  const selectInterfaceLanguage = sqlNormalizedColumnOrDefault(columns, 'interface_language', 'en');
  const selectDefinition = sqlTextColumnOrNull(columns, 'definition');
  const selectGloss = sqlTextColumnOrNull(columns, 'gloss');
  const selectHanja = sqlTextColumnOrNull(columns, 'hanja');
  const selectPos = sqlTextColumnOrNull(columns, 'pos');
  const selectDomain = sqlTextColumnOrNull(columns, 'domain');
  const selectRomanization = sqlTextColumnOrNull(columns, 'romanization');
  const selectIpa = sqlTextColumnOrNull(columns, 'ipa');
  const selectEtymology = sqlTextColumnOrNull(columns, 'etymology');
  const selectDerived = sqlTextColumnOrNull(columns, 'derived');
  const selectRelated = sqlTextColumnOrNull(columns, 'related');
  const selectWordParts = sqlTextColumnOrNull(columns, 'word_parts');
  const selectLastUpdated = columns.includes('last_updated') ? 'last_updated' : 'CURRENT_TIMESTAMP';

  await new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql('DROP TABLE IF EXISTS dictionary_cache_new');
      tx.executeSql(
        `CREATE TABLE dictionary_cache_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          stem         TEXT NOT NULL,
          language     TEXT NOT NULL DEFAULT 'ko',
          interface_language TEXT NOT NULL DEFAULT 'en',
          definition   TEXT,
          gloss        TEXT,
          hanja        TEXT,
          pos          TEXT,
          domain       TEXT,
          romanization TEXT,
          ipa          TEXT,
          etymology    TEXT,
          derived      TEXT,
          related      TEXT,
          word_parts   TEXT,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(language, stem, interface_language)
        )`,
        [],
        () => {},
        (_, error) => {
          console.error('[Database] Error creating dictionary_cache_new:', error);
          reject(error);
          return false;
        }
      );

      tx.executeSql(
        `INSERT OR IGNORE INTO dictionary_cache_new
           (id, stem, language, interface_language, definition, gloss, hanja, pos, domain, romanization, ipa, etymology, derived, related, word_parts, last_updated)
         SELECT id, stem, ${selectLanguage}, ${selectInterfaceLanguage}, ${selectDefinition}, ${selectGloss}, ${selectHanja},
                ${selectPos}, ${selectDomain}, ${selectRomanization}, ${selectIpa}, ${selectEtymology}, ${selectDerived},
                ${selectRelated}, ${selectWordParts}, ${selectLastUpdated}
         FROM dictionary_cache
         WHERE stem IS NOT NULL AND TRIM(stem) != ''
         ORDER BY id ASC`,
        [],
        () => {},
        (_, error) => {
          const isMissingTable = typeof error?.message === 'string' && error.message.includes('no such table');
          if (isMissingTable) {
            return true;
          }
          console.error('[Database] Error copying dictionary_cache rows:', error);
          reject(error);
          return false;
        }
      );

      tx.executeSql('DROP TABLE IF EXISTS dictionary_cache');
      tx.executeSql('ALTER TABLE dictionary_cache_new RENAME TO dictionary_cache');
      tx.executeSql(
        'CREATE INDEX IF NOT EXISTS idx_dictionary_cache_stem_language ON dictionary_cache(language, stem, interface_language)',
        [],
        () => resolve(),
        (_, error) => {
          console.error('[Database] Error finalizing dictionary_cache migration:', error);
          reject(error);
          return false;
        }
      );
    });
  });

  await AsyncStorage.setItem(DICTIONARY_CACHE_MIGRATION_KEY, 'done');
};

export const migrateDictionaryCacheInterfaceLanguage = async () => {
  const migrationState = await AsyncStorage.getItem(DICTIONARY_CACHE_LANGUAGE_MIGRATION_KEY);
  if (migrationState === 'done') return;

  const columns = await getTableColumns('dictionary_cache');
  const selectLanguage = sqlNormalizedColumnOrDefault(columns, 'language', 'ko');
  const selectInterfaceLanguage = sqlNormalizedColumnOrDefault(columns, 'interface_language', 'en');
  const selectDefinition = sqlTextColumnOrNull(columns, 'definition');
  const selectGloss = sqlTextColumnOrNull(columns, 'gloss');
  const selectHanja = sqlTextColumnOrNull(columns, 'hanja');
  const selectPos = sqlTextColumnOrNull(columns, 'pos');
  const selectDomain = sqlTextColumnOrNull(columns, 'domain');
  const selectRomanization = sqlTextColumnOrNull(columns, 'romanization');
  const selectIpa = sqlTextColumnOrNull(columns, 'ipa');
  const selectEtymology = sqlTextColumnOrNull(columns, 'etymology');
  const selectDerived = sqlTextColumnOrNull(columns, 'derived');
  const selectRelated = sqlTextColumnOrNull(columns, 'related');
  const selectWordParts = sqlTextColumnOrNull(columns, 'word_parts');
  const selectLastUpdated = columns.includes('last_updated') ? 'last_updated' : 'CURRENT_TIMESTAMP';

  await new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql('DROP TABLE IF EXISTS dictionary_cache_language_new');
      tx.executeSql(
        `CREATE TABLE dictionary_cache_language_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          stem         TEXT NOT NULL,
          language     TEXT NOT NULL DEFAULT 'ko',
          interface_language TEXT NOT NULL DEFAULT 'en',
          definition   TEXT,
          gloss        TEXT,
          hanja        TEXT,
          pos          TEXT,
          domain       TEXT,
          romanization TEXT,
          ipa          TEXT,
          etymology    TEXT,
          derived      TEXT,
          related      TEXT,
          word_parts   TEXT,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(language, stem, interface_language)
        )`,
        [],
        () => {},
        (_, error) => {
          console.error('[Database] Error creating dictionary_cache_language_new:', error);
          reject(error);
          return false;
        }
      );

      tx.executeSql(
        `INSERT OR IGNORE INTO dictionary_cache_language_new
           (id, stem, language, interface_language, definition, gloss, hanja, pos, domain, romanization, ipa, etymology, derived, related, word_parts, last_updated)
         SELECT id, stem, ${selectLanguage}, ${selectInterfaceLanguage}, ${selectDefinition}, ${selectGloss}, ${selectHanja},
                ${selectPos}, ${selectDomain}, ${selectRomanization}, ${selectIpa}, ${selectEtymology}, ${selectDerived},
                ${selectRelated}, ${selectWordParts}, ${selectLastUpdated}
         FROM dictionary_cache
         WHERE stem IS NOT NULL AND TRIM(stem) != ''
         ORDER BY id ASC`,
        [],
        () => {},
        (_, error) => {
          console.error('[Database] Error copying dictionary_cache language rows:', error);
          reject(error);
          return false;
        }
      );

      tx.executeSql('DROP TABLE IF EXISTS dictionary_cache');
      tx.executeSql('ALTER TABLE dictionary_cache_language_new RENAME TO dictionary_cache');
      tx.executeSql(
        'CREATE INDEX IF NOT EXISTS idx_dictionary_cache_stem_language ON dictionary_cache(language, stem, interface_language)',
        [],
        () => resolve(),
        (_, error) => {
          console.error('[Database] Error finalizing dictionary_cache language migration:', error);
          reject(error);
          return false;
        }
      );
    });
  });

  await AsyncStorage.setItem(DICTIONARY_CACHE_LANGUAGE_MIGRATION_KEY, 'done');
};

export const migrateDictionaryCacheTargetLanguage = async () => {
  const migrationState = await AsyncStorage.getItem(DICTIONARY_CACHE_TARGET_LANGUAGE_MIGRATION_KEY);
  const columns = await getTableColumns('dictionary_cache');

  const hasFinalColumns = [
    'language',
    'interface_language',
    'gloss',
    'ipa',
    'etymology',
    'derived',
    'related',
    'word_parts',
  ].every((column) => columns.includes(column));

  if (migrationState === 'done' && hasFinalColumns) return;

  const selectLanguage = sqlNormalizedColumnOrDefault(columns, 'language', 'ko');
  const selectInterfaceLanguage = sqlNormalizedColumnOrDefault(columns, 'interface_language', 'en');
  const selectDefinition = sqlTextColumnOrNull(columns, 'definition');
  const selectGloss = sqlTextColumnOrNull(columns, 'gloss');
  const selectHanja = sqlTextColumnOrNull(columns, 'hanja');
  const selectPos = sqlTextColumnOrNull(columns, 'pos');
  const selectDomain = sqlTextColumnOrNull(columns, 'domain');
  const selectRomanization = sqlTextColumnOrNull(columns, 'romanization');
  const selectIpa = sqlTextColumnOrNull(columns, 'ipa');
  const selectEtymology = sqlTextColumnOrNull(columns, 'etymology');
  const selectDerived = sqlTextColumnOrNull(columns, 'derived');
  const selectRelated = sqlTextColumnOrNull(columns, 'related');
  const selectWordParts = sqlTextColumnOrNull(columns, 'word_parts');
  const selectLastUpdated = columns.includes('last_updated') ? 'last_updated' : 'CURRENT_TIMESTAMP';

  await new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql('DROP TABLE IF EXISTS dictionary_cache_target_language_new');
      tx.executeSql(
        `CREATE TABLE dictionary_cache_target_language_new (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          stem         TEXT NOT NULL,
          language     TEXT NOT NULL DEFAULT 'ko',
          interface_language TEXT NOT NULL DEFAULT 'en',
          definition   TEXT,
          gloss        TEXT,
          hanja        TEXT,
          pos          TEXT,
          domain       TEXT,
          romanization TEXT,
          ipa          TEXT,
          etymology    TEXT,
          derived      TEXT,
          related      TEXT,
          word_parts   TEXT,
          last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(language, stem, interface_language)
        )`,
        [],
        () => {},
        (_, error) => {
          console.error('[Database] Error creating dictionary_cache_target_language_new:', error);
          reject(error);
          return false;
        }
      );

      tx.executeSql(
        `INSERT OR IGNORE INTO dictionary_cache_target_language_new
           (id, stem, language, interface_language, definition, gloss, hanja, pos, domain, romanization, ipa, etymology, derived, related, word_parts, last_updated)
         SELECT id, stem, ${selectLanguage}, ${selectInterfaceLanguage}, ${selectDefinition}, ${selectGloss}, ${selectHanja},
                ${selectPos}, ${selectDomain}, ${selectRomanization}, ${selectIpa}, ${selectEtymology}, ${selectDerived},
                ${selectRelated}, ${selectWordParts}, ${selectLastUpdated}
         FROM dictionary_cache
         WHERE stem IS NOT NULL AND TRIM(stem) != ''
         ORDER BY id ASC`,
        [],
        () => {},
        (_, error) => {
          console.error('[Database] Error copying dictionary_cache target language rows:', error);
          reject(error);
          return false;
        }
      );

      tx.executeSql('DROP TABLE IF EXISTS dictionary_cache');
      tx.executeSql('ALTER TABLE dictionary_cache_target_language_new RENAME TO dictionary_cache');
      tx.executeSql(
        'CREATE INDEX IF NOT EXISTS idx_dictionary_cache_stem_language ON dictionary_cache(language, stem, interface_language)',
        [],
        () => resolve(),
        (_, error) => {
          console.error('[Database] Error finalizing dictionary_cache target language migration:', error);
          reject(error);
          return false;
        }
      );
    });
  });

  await AsyncStorage.setItem(DICTIONARY_CACHE_TARGET_LANGUAGE_MIGRATION_KEY, 'done');
};

export const migrateDictionaryCacheGloss = async () => {
  const migrationState = await AsyncStorage.getItem(DICTIONARY_CACHE_GLOSS_MIGRATION_KEY);
  if (migrationState === 'done') return;

  const columns = await getTableColumns('dictionary_cache');
  if (!columns.includes('gloss')) {
    await new Promise((resolve, reject) => {
      db.transaction(tx => {
        tx.executeSql(
          'ALTER TABLE dictionary_cache ADD COLUMN gloss TEXT',
          [],
          () => resolve(),
          (_, error) => {
            console.error('[Database] Error adding dictionary_cache.gloss:', error);
            reject(error);
            return false;
          }
        );
      });
    });
  }

  await AsyncStorage.setItem(DICTIONARY_CACHE_GLOSS_MIGRATION_KEY, 'done');
};

export const migrateDictionaryCacheWordParts = async () => {
  const migrationState = await AsyncStorage.getItem(DICTIONARY_CACHE_WORD_PARTS_MIGRATION_KEY);
  if (migrationState === 'done') return;

  const columns = await getTableColumns('dictionary_cache');
  if (!columns.includes('word_parts')) {
    await new Promise((resolve, reject) => {
      db.transaction(tx => {
        tx.executeSql(
          'ALTER TABLE dictionary_cache ADD COLUMN word_parts TEXT',
          [],
          () => resolve(),
          (_, error) => {
            console.error('[Database] Error adding dictionary_cache.word_parts:', error);
            reject(error);
            return false;
          }
        );
      });
    });
  }

  await AsyncStorage.setItem(DICTIONARY_CACHE_WORD_PARTS_MIGRATION_KEY, 'done');
};

export const migrateDictionaryCacheAudio = async () => {
  const migrationState = await AsyncStorage.getItem(DICTIONARY_CACHE_AUDIO_MIGRATION_KEY);
  const columns = await getTableColumns('dictionary_cache');
  const missingColumns = ['audio_us', 'audio_uk'].filter(column => !columns.includes(column));

  if (migrationState === 'done' && missingColumns.length === 0) return;

  if (missingColumns.length > 0) {
    await new Promise((resolve, reject) => {
      db.transaction(tx => {
        missingColumns.forEach((column) => {
          tx.executeSql(
            `ALTER TABLE dictionary_cache ADD COLUMN ${column} TEXT`,
            [],
            () => {},
            (_, error) => {
              console.error(`[Database] Error adding dictionary_cache.${column}:`, error);
              reject(error);
              return false;
            }
          );
        });
      }, reject, resolve);
    });
  }

  await AsyncStorage.setItem(DICTIONARY_CACHE_AUDIO_MIGRATION_KEY, 'done');
};

export const migrateDictionaryCacheProficiencyLevels = async () => {
  const migrationState = await AsyncStorage.getItem(DICTIONARY_CACHE_PROFICIENCY_MIGRATION_KEY);
  const columns = await getTableColumns('dictionary_cache');
  const levelColumns = [
    ['level_rank', 'INTEGER'],
    ['level_label', 'TEXT'],
    ['level_system', 'TEXT'],
    ['level_source', 'TEXT'],
  ];
  const missingColumns = levelColumns.filter(([column]) => !columns.includes(column));

  if (migrationState === 'done' && missingColumns.length === 0) return;

  if (missingColumns.length > 0) {
    await new Promise((resolve, reject) => {
      db.transaction(
        tx => {
          missingColumns.forEach(([column, type]) => {
            tx.executeSql(
              `ALTER TABLE dictionary_cache ADD COLUMN ${column} ${type}`,
              [],
              () => {},
              (_, error) => {
                console.error(`[Database] Error adding dictionary_cache.${column}:`, error);
                reject(error);
                return false;
              }
            );
          });
        },
        reject,
        resolve
      );
    });
  }

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_dictionary_cache_level
           ON dictionary_cache(language, level_rank)`
        );
      },
      reject,
      resolve
    );
  });

  await AsyncStorage.setItem(DICTIONARY_CACHE_PROFICIENCY_MIGRATION_KEY, 'done');
};

// Level engine: how common each word is (Zipf) and the Korean loanword flag,
// sent by preprocessing (backend word_features). Old rows stay null until the
// book is preprocessed again (PREPROCESS_VERSION).
export const migrateDictionaryCacheWordFeatures = async () => {
  const columns = await getTableColumns('dictionary_cache');
  const missing = [['zipf', 'REAL'], ['loanword', 'INTEGER']].filter(([column]) => !columns.includes(column));
  if (missing.length === 0) return;
  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        missing.forEach(([column, type]) => {
          tx.executeSql(`ALTER TABLE dictionary_cache ADD COLUMN ${column} ${type}`);
        });
      },
      (error) => {
        console.error('[Database] Error adding dictionary_cache word features:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

// Phase 2 (continuous Korean difficulty): add the difficulty_rank / difficulty_percentile
// columns and rescale legacy Korean rows. level_rank changed meaning from the 3 NIKL
// grades (1..3) to the 6 Noeul reading levels (1..6); rows the OLD backend wrote carry
// level_system='NIKL', so we remap those onto the LOWER band of each grade's Lower/Upper
// pair (초급→1, 중급→3, 고급→5) — grade-correct immediately, refined to the exact reading
// level + difficulty percentile on the word's next lookup. Rows already written by the new
// backend carry level_system='Noeul Reading Levels' and are left untouched, so this is safe
// to run over a cache that mixes old and new entries.
export const migrateDictionaryCacheDifficulty = async () => {
  const migrationState = await AsyncStorage.getItem(DICTIONARY_CACHE_DIFFICULTY_MIGRATION_KEY);
  const columns = await getTableColumns('dictionary_cache');
  const difficultyColumns = [
    ['difficulty_rank', 'INTEGER'],
    ['difficulty_percentile', 'REAL'],
  ];
  const missingColumns = difficultyColumns.filter(([column]) => !columns.includes(column));

  if (migrationState === 'done' && missingColumns.length === 0) return;

  if (missingColumns.length > 0) {
    await new Promise((resolve, reject) => {
      db.transaction(
        tx => {
          missingColumns.forEach(([column, type]) => {
            tx.executeSql(
              `ALTER TABLE dictionary_cache ADD COLUMN ${column} ${type}`,
              [],
              () => {},
              (_, error) => {
                console.error(`[Database] Error adding dictionary_cache.${column}:`, error);
                reject(error);
                return false;
              }
            );
          });
        },
        reject,
        resolve
      );
    });
  }

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          `UPDATE dictionary_cache
             SET level_rank = CASE level_rank WHEN 1 THEN 1 WHEN 2 THEN 3 WHEN 3 THEN 5 ELSE level_rank END,
                 level_system = 'Noeul Reading Levels'
           WHERE language = 'ko' AND level_system = 'NIKL' AND level_rank IN (1, 2, 3)`,
          [],
          () => {},
          (_, error) => {
            console.error('[Database] Error rescaling legacy Korean level_rank:', error);
            reject(error);
            return false;
          }
        );
      },
      reject,
      resolve
    );
  });

  await AsyncStorage.setItem(DICTIONARY_CACHE_DIFFICULTY_MIGRATION_KEY, 'done');
};

export const migrateDictionaryCacheRomanization = async () => {
  const migrationState = await AsyncStorage.getItem(DICTIONARY_CACHE_ROMANIZATION_MIGRATION_KEY);
  const columns = await getTableColumns('dictionary_cache');

  if (migrationState === 'done' && columns.includes('romanization')) return;

  if (!columns.includes('romanization')) {
    await new Promise((resolve, reject) => {
      db.transaction(tx => {
        tx.executeSql(
          'ALTER TABLE dictionary_cache ADD COLUMN romanization TEXT',
          [],
          () => resolve(),
          (_, error) => {
            console.error('[Database] Error adding dictionary_cache.romanization:', error);
            reject(error);
            return false;
          }
        );
      });
    });
  }

  await AsyncStorage.setItem(DICTIONARY_CACHE_ROMANIZATION_MIGRATION_KEY, 'done');
};

// Chinese lookups keep BOTH the Simplified and Traditional headword forms so the
// definition panel can show both regardless of the book's script. CC-CEDICT
// carries both, so these are populated from preprocess/live results; older rows
// stay null until re-fetched.
export const migrateDictionaryCacheZhScripts = async () => {
  const migrationState = await AsyncStorage.getItem(DICTIONARY_CACHE_ZH_SCRIPTS_MIGRATION_KEY);
  const columns = await getTableColumns('dictionary_cache');

  if (migrationState === 'done' && columns.includes('simplified') && columns.includes('traditional')) {
    return;
  }

  const addColumn = (name) => new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `ALTER TABLE dictionary_cache ADD COLUMN ${name} TEXT`,
        [],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error adding dictionary_cache.${name}:`, error);
          reject(error);
          return false;
        }
      );
    });
  });

  if (!columns.includes('simplified')) {
    await addColumn('simplified');
  }
  if (!columns.includes('traditional')) {
    await addColumn('traditional');
  }

  await AsyncStorage.setItem(DICTIONARY_CACHE_ZH_SCRIPTS_MIGRATION_KEY, 'done');
};

// Chapter preprocessing used to save Korean words' English definitions under
// the app language (vi, es, …), and a Korean book's cache rows are always
// trusted, so those English rows were shown forever. Drop every non-English
// Korean row once, with the book_index rows that point at them. The reader
// then sees no rows in the app language and preprocesses the book again, now
// in that language; tapped words are fetched again on their next tap.
export const purgeKoreanNonEnglishCacheRows = async () => {
  if (await AsyncStorage.getItem(DICTIONARY_CACHE_KO_LANGUAGE_PURGE_KEY) === 'done') return;

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          `DELETE FROM book_index
           WHERE stem_id IN (
             SELECT id FROM dictionary_cache WHERE language = 'ko' AND interface_language <> 'en'
           )`
        );
        tx.executeSql(
          `DELETE FROM dictionary_cache WHERE language = 'ko' AND interface_language <> 'en'`
        );
      },
      (error) => {
        console.error('[Database] Error purging non-English Korean cache rows:', error);
        reject(error);
      },
      () => resolve()
    );
  });

  await AsyncStorage.setItem(DICTIONARY_CACHE_KO_LANGUAGE_PURGE_KEY, 'done');
};

/**
 * createBookIndexTable
 * Creates the `book_index` table if it doesn't exist.
 *
 * After a book is preprocessed, we store a lightweight index mapping every
 * raw surface word (as it appears in text) to the stem_id in dictionary_cache.
 * This lets us jump straight to the cached definition without re-stemming.
 *
 * Schema:
 *   book_uri — file URI of the book (identifies which book this row belongs to)
 *   surface  — the word as it appears in text (e.g. "달렸다")
 *   stem_id  — FK → dictionary_cache.id for the base form (e.g. row for "달리다")
 */
export const createBookIndexTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS book_index (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          owner_id TEXT NOT NULL DEFAULT 'guest',
          profile_id TEXT DEFAULT 'ko_default',
          book_uri TEXT NOT NULL,
          surface  TEXT NOT NULL,
          stem_id  INTEGER NOT NULL,
          UNIQUE(owner_id, profile_id, book_uri, surface, stem_id)
        )`,
        [],
        () => resolve(),
        (_, error) => {
          console.error("[Database] Error creating book_index table:", error);
          reject(error);
        }
      );
    });
  });
};

export const createBookPreprocessTables = () => {
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          `CREATE TABLE IF NOT EXISTS book_preprocess_meta (
            owner_id           TEXT NOT NULL DEFAULT 'guest',
            profile_id         TEXT DEFAULT 'ko_default',
            book_uri           TEXT NOT NULL,
            status             TEXT,
            preprocess_version INTEGER DEFAULT ${PREPROCESS_VERSION},
            started_at         TEXT,
            completed_at       TEXT,
            surface_count      INTEGER DEFAULT 0,
            book_level         TEXT,
            book_level_rank    INTEGER,
            book_level_system  TEXT,
            book_level_source  TEXT,
            book_level_stats   TEXT,
            PRIMARY KEY (owner_id, profile_id, book_uri, preprocess_version)
          )`,
          []
        );
        tx.executeSql(
          `CREATE TABLE IF NOT EXISTS book_preprocess_chapters (
            owner_id           TEXT NOT NULL DEFAULT 'guest',
            profile_id         TEXT DEFAULT 'ko_default',
            book_uri           TEXT NOT NULL,
            spine_index        INTEGER NOT NULL,
            status             TEXT,
            surface_count      INTEGER DEFAULT 0,
            book_level         TEXT,
            book_level_rank    INTEGER,
            book_level_system  TEXT,
            book_level_source  TEXT,
            book_level_stats   TEXT,
            completed_at       TEXT,
            preprocess_version INTEGER DEFAULT ${PREPROCESS_VERSION},
            PRIMARY KEY (owner_id, profile_id, book_uri, spine_index, preprocess_version)
          )`,
          []
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_book_preprocess_chapters_book_status
           ON book_preprocess_chapters(owner_id, profile_id, book_uri, preprocess_version, status)`,
          []
        );
      },
      (error) => {
        console.error('[Database] Error creating book preprocess tables:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const migrateBookPreprocessLevelColumns = async () => {
  const [metaColumns, chapterColumns] = await Promise.all([
    getTableColumns('book_preprocess_meta'),
    getTableColumns('book_preprocess_chapters'),
  ]);
  const levelColumns = [
    ['book_level', 'TEXT'],
    ['book_level_rank', 'INTEGER'],
    ['book_level_system', 'TEXT'],
    ['book_level_source', 'TEXT'],
    ['book_level_stats', 'TEXT'],
  ];

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        levelColumns.forEach(([column, type]) => {
          if (!metaColumns.includes(column)) {
            tx.executeSql(`ALTER TABLE book_preprocess_meta ADD COLUMN ${column} ${type}`);
          }
          if (!chapterColumns.includes(column)) {
            tx.executeSql(`ALTER TABLE book_preprocess_chapters ADD COLUMN ${column} ${type}`);
          }
        });
      },
      (error) => {
        console.error('[Database] Error migrating book preprocess level columns:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const migrateBookIndex = async () => {
  const migrationState = await AsyncStorage.getItem(BOOK_INDEX_MIGRATION_KEY);
  if (migrationState === 'done') return;

  await new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'DROP TABLE IF EXISTS book_index',
        [],
        () => resolve(),
        (_, error) => {
          console.error('[Database] Error dropping legacy book_index table:', error);
          reject(error);
        }
      );
    });
  });

  await createBookIndexTable();
  await AsyncStorage.setItem(BOOK_INDEX_MIGRATION_KEY, 'done');
};

const createOwnerIndexes = () => {
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_owner_identity_key
           ON vocab(owner_id, profile_id, language, word, hanja, def_key)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_owner_updated
           ON vocab(owner_id, profile_id, updated_at)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_contexts_owner_identity_key
           ON vocab_contexts(owner_id, profile_id, language, word, hanja, def_key, source_book_uri, sentence)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_contexts_owner_updated
           ON vocab_contexts(owner_id, profile_id, updated_at)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_vocab_contexts_owner_vocab_seen
           ON vocab_contexts(owner_id, vocab_id, seen_at DESC)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_book_index_owner_surface
           ON book_index(owner_id, profile_id, book_uri, surface)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_book_index_owner_stem_surface
           ON book_index(owner_id, profile_id, book_uri, stem_id, surface)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_book_preprocess_meta_owner_book
           ON book_preprocess_meta(owner_id, profile_id, book_uri, preprocess_version)`
        );
        tx.executeSql(
          `CREATE INDEX IF NOT EXISTS idx_book_preprocess_chapters_owner_book_status
           ON book_preprocess_chapters(owner_id, profile_id, book_uri, preprocess_version, status)`
        );
      },
      (error) => {
        console.error('[Database] Error creating owner indexes:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const migrateLocalOwnerSqlite = async () => {
  const migrationState = await AsyncStorage.getItem(LOCAL_OWNER_SQLITE_MIGRATION_KEY);
  if (migrationState === 'done') {
    await createOwnerIndexes();
    return;
  }

  const [
    vocabColumns,
    contextColumns,
    bookIndexColumns,
    preprocessMetaColumns,
    preprocessChapterColumns,
  ] = await Promise.all([
    getTableColumns('vocab'),
    getTableColumns('vocab_contexts'),
    getTableColumns('book_index'),
    getTableColumns('book_preprocess_meta'),
    getTableColumns('book_preprocess_chapters'),
  ]);

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        if (!vocabColumns.includes('owner_id')) {
          tx.executeSql(`ALTER TABLE vocab ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
        }
        if (!vocabColumns.includes('profile_id')) {
          tx.executeSql(`ALTER TABLE vocab ADD COLUMN profile_id TEXT DEFAULT '${DEFAULT_ACTIVE_PROFILE_ID}'`);
        }
        if (!contextColumns.includes('owner_id')) {
          tx.executeSql(`ALTER TABLE vocab_contexts ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
        }
        if (!contextColumns.includes('profile_id')) {
          tx.executeSql(`ALTER TABLE vocab_contexts ADD COLUMN profile_id TEXT DEFAULT '${DEFAULT_ACTIVE_PROFILE_ID}'`);
        }
        tx.executeSql(
          `UPDATE vocab SET owner_id = ? WHERE owner_id IS NULL OR TRIM(owner_id) = ''`,
          [GUEST_OWNER_ID]
        );
        tx.executeSql(
          `UPDATE vocab SET profile_id = ? WHERE profile_id IS NULL OR TRIM(profile_id) = ''`,
          [DEFAULT_ACTIVE_PROFILE_ID]
        );
        tx.executeSql(
          `UPDATE vocab_contexts SET owner_id = ? WHERE owner_id IS NULL OR TRIM(owner_id) = ''`,
          [GUEST_OWNER_ID]
        );
        tx.executeSql(
          `UPDATE vocab_contexts SET profile_id = ? WHERE profile_id IS NULL OR TRIM(profile_id) = ''`,
          [DEFAULT_ACTIVE_PROFILE_ID]
        );

        if (!bookIndexColumns.includes('owner_id')) {
          tx.executeSql(`ALTER TABLE book_index ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
        }
        if (!bookIndexColumns.includes('profile_id')) {
          tx.executeSql(`ALTER TABLE book_index ADD COLUMN profile_id TEXT DEFAULT '${DEFAULT_ACTIVE_PROFILE_ID}'`);
        }
        tx.executeSql(`DROP TABLE IF EXISTS book_index_owner_new`);
        tx.executeSql(
          `CREATE TABLE book_index_owner_new (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_id TEXT NOT NULL DEFAULT 'guest',
            profile_id TEXT DEFAULT 'ko_default',
            book_uri TEXT NOT NULL,
            surface  TEXT NOT NULL,
            stem_id  INTEGER NOT NULL,
            UNIQUE(owner_id, profile_id, book_uri, surface, stem_id)
          )`
        );
        tx.executeSql(
          `INSERT OR IGNORE INTO book_index_owner_new (owner_id, profile_id, book_uri, surface, stem_id)
           SELECT COALESCE(owner_id, ?), COALESCE(profile_id, ?), book_uri, surface, stem_id
           FROM book_index
           WHERE book_uri IS NOT NULL AND surface IS NOT NULL AND stem_id IS NOT NULL`,
          [GUEST_OWNER_ID, DEFAULT_ACTIVE_PROFILE_ID]
        );
        tx.executeSql(`DROP TABLE IF EXISTS book_index`);
        tx.executeSql(`ALTER TABLE book_index_owner_new RENAME TO book_index`);

        if (!preprocessMetaColumns.includes('owner_id')) {
          tx.executeSql(`ALTER TABLE book_preprocess_meta ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
        }
        if (!preprocessMetaColumns.includes('profile_id')) {
          tx.executeSql(`ALTER TABLE book_preprocess_meta ADD COLUMN profile_id TEXT DEFAULT '${DEFAULT_ACTIVE_PROFILE_ID}'`);
        }
        tx.executeSql(`DROP TABLE IF EXISTS book_preprocess_meta_owner_new`);
        tx.executeSql(
          `CREATE TABLE book_preprocess_meta_owner_new (
            owner_id           TEXT NOT NULL DEFAULT 'guest',
            profile_id         TEXT DEFAULT 'ko_default',
            book_uri           TEXT NOT NULL,
            status             TEXT,
            preprocess_version INTEGER DEFAULT ${PREPROCESS_VERSION},
            started_at         TEXT,
            completed_at       TEXT,
            surface_count      INTEGER DEFAULT 0,
            book_level         TEXT,
            book_level_rank    INTEGER,
            book_level_system  TEXT,
            book_level_source  TEXT,
            book_level_stats   TEXT,
            PRIMARY KEY (owner_id, profile_id, book_uri, preprocess_version)
          )`
        );
        tx.executeSql(
          `INSERT OR REPLACE INTO book_preprocess_meta_owner_new (
            owner_id, profile_id, book_uri, status, preprocess_version, started_at, completed_at, surface_count,
            book_level, book_level_rank, book_level_system, book_level_source, book_level_stats
          )
           SELECT
            COALESCE(owner_id, ?),
            COALESCE(profile_id, ?),
            book_uri,
            status,
            COALESCE(preprocess_version, ?),
            started_at,
            completed_at,
            COALESCE(surface_count, 0),
            ${sqlBookLevelColumnOrNull(preprocessMetaColumns, 'book_level')},
            ${sqlBookLevelColumnOrNull(preprocessMetaColumns, 'book_level_rank')},
            ${sqlBookLevelColumnOrNull(preprocessMetaColumns, 'book_level_system')},
            ${sqlBookLevelColumnOrNull(preprocessMetaColumns, 'book_level_source')},
            ${sqlBookLevelColumnOrNull(preprocessMetaColumns, 'book_level_stats')}
           FROM book_preprocess_meta
           WHERE book_uri IS NOT NULL`,
          [GUEST_OWNER_ID, DEFAULT_ACTIVE_PROFILE_ID, PREPROCESS_VERSION]
        );
        tx.executeSql(`DROP TABLE IF EXISTS book_preprocess_meta`);
        tx.executeSql(`ALTER TABLE book_preprocess_meta_owner_new RENAME TO book_preprocess_meta`);

        if (!preprocessChapterColumns.includes('owner_id')) {
          tx.executeSql(`ALTER TABLE book_preprocess_chapters ADD COLUMN owner_id TEXT DEFAULT '${GUEST_OWNER_ID}'`);
        }
        if (!preprocessChapterColumns.includes('profile_id')) {
          tx.executeSql(`ALTER TABLE book_preprocess_chapters ADD COLUMN profile_id TEXT DEFAULT '${DEFAULT_ACTIVE_PROFILE_ID}'`);
        }
        tx.executeSql(`DROP TABLE IF EXISTS book_preprocess_chapters_owner_new`);
        tx.executeSql(
          `CREATE TABLE book_preprocess_chapters_owner_new (
            owner_id           TEXT NOT NULL DEFAULT 'guest',
            profile_id         TEXT DEFAULT 'ko_default',
            book_uri           TEXT NOT NULL,
            spine_index        INTEGER NOT NULL,
            status             TEXT,
            surface_count      INTEGER DEFAULT 0,
            book_level         TEXT,
            book_level_rank    INTEGER,
            book_level_system  TEXT,
            book_level_source  TEXT,
            book_level_stats   TEXT,
            completed_at       TEXT,
            preprocess_version INTEGER DEFAULT ${PREPROCESS_VERSION},
            PRIMARY KEY (owner_id, profile_id, book_uri, spine_index, preprocess_version)
          )`
        );
        tx.executeSql(
          `INSERT OR REPLACE INTO book_preprocess_chapters_owner_new (
            owner_id, profile_id, book_uri, spine_index, status, surface_count,
            book_level, book_level_rank, book_level_system, book_level_source, book_level_stats,
            completed_at, preprocess_version
          )
           SELECT
            COALESCE(owner_id, ?),
            COALESCE(profile_id, ?),
            book_uri,
            spine_index,
            status,
            COALESCE(surface_count, 0),
            ${sqlBookLevelColumnOrNull(preprocessChapterColumns, 'book_level')},
            ${sqlBookLevelColumnOrNull(preprocessChapterColumns, 'book_level_rank')},
            ${sqlBookLevelColumnOrNull(preprocessChapterColumns, 'book_level_system')},
            ${sqlBookLevelColumnOrNull(preprocessChapterColumns, 'book_level_source')},
            ${sqlBookLevelColumnOrNull(preprocessChapterColumns, 'book_level_stats')},
            completed_at,
            COALESCE(preprocess_version, ?)
           FROM book_preprocess_chapters
           WHERE book_uri IS NOT NULL AND spine_index IS NOT NULL`,
          [GUEST_OWNER_ID, DEFAULT_ACTIVE_PROFILE_ID, PREPROCESS_VERSION]
        );
        tx.executeSql(`DROP TABLE IF EXISTS book_preprocess_chapters`);
        tx.executeSql(`ALTER TABLE book_preprocess_chapters_owner_new RENAME TO book_preprocess_chapters`);
      },
      (error) => {
        console.error('[Database] Error migrating local owner SQLite tables:', error);
        reject(error);
      },
      () => resolve()
    );
  });

  await createOwnerIndexes();
  await AsyncStorage.setItem(LOCAL_OWNER_SQLITE_MIGRATION_KEY, 'done');
};

export const migrateProfileSqlite = async () => {
  const migrationState = await AsyncStorage.getItem(PROFILE_SQLITE_MIGRATION_KEY);
  const [
    vocabColumns,
    contextColumns,
    bookIndexColumns,
    preprocessMetaColumns,
    preprocessChapterColumns,
  ] = await Promise.all([
    getTableColumns('vocab'),
    getTableColumns('vocab_contexts'),
    getTableColumns('book_index'),
    getTableColumns('book_preprocess_meta'),
    getTableColumns('book_preprocess_chapters'),
  ]);

  if (
    migrationState === 'done'
    && vocabColumns.includes('profile_id')
    && contextColumns.includes('profile_id')
    && bookIndexColumns.includes('profile_id')
    && preprocessMetaColumns.includes('profile_id')
    && preprocessChapterColumns.includes('profile_id')
  ) {
    await createOwnerIndexes();
    return;
  }

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        if (!vocabColumns.includes('profile_id')) {
          tx.executeSql(`ALTER TABLE vocab ADD COLUMN profile_id TEXT DEFAULT '${DEFAULT_ACTIVE_PROFILE_ID}'`);
        }
        if (!contextColumns.includes('profile_id')) {
          tx.executeSql(`ALTER TABLE vocab_contexts ADD COLUMN profile_id TEXT DEFAULT '${DEFAULT_ACTIVE_PROFILE_ID}'`);
        }
        if (!bookIndexColumns.includes('profile_id')) {
          tx.executeSql(`ALTER TABLE book_index ADD COLUMN profile_id TEXT DEFAULT '${DEFAULT_ACTIVE_PROFILE_ID}'`);
        }
        if (!preprocessMetaColumns.includes('profile_id')) {
          tx.executeSql(`ALTER TABLE book_preprocess_meta ADD COLUMN profile_id TEXT DEFAULT '${DEFAULT_ACTIVE_PROFILE_ID}'`);
        }
        if (!preprocessChapterColumns.includes('profile_id')) {
          tx.executeSql(`ALTER TABLE book_preprocess_chapters ADD COLUMN profile_id TEXT DEFAULT '${DEFAULT_ACTIVE_PROFILE_ID}'`);
        }

        tx.executeSql(
          `UPDATE vocab SET profile_id = ? WHERE profile_id IS NULL OR TRIM(profile_id) = ''`,
          [DEFAULT_ACTIVE_PROFILE_ID]
        );
        tx.executeSql(
          `UPDATE vocab_contexts SET profile_id = ? WHERE profile_id IS NULL OR TRIM(profile_id) = ''`,
          [DEFAULT_ACTIVE_PROFILE_ID]
        );
        tx.executeSql(
          `UPDATE book_index SET profile_id = ? WHERE profile_id IS NULL OR TRIM(profile_id) = ''`,
          [DEFAULT_ACTIVE_PROFILE_ID]
        );
        tx.executeSql(
          `UPDATE book_preprocess_meta SET profile_id = ? WHERE profile_id IS NULL OR TRIM(profile_id) = ''`,
          [DEFAULT_ACTIVE_PROFILE_ID]
        );
        tx.executeSql(
          `UPDATE book_preprocess_chapters SET profile_id = ? WHERE profile_id IS NULL OR TRIM(profile_id) = ''`,
          [DEFAULT_ACTIVE_PROFILE_ID]
        );
      },
      (error) => {
        console.error('[Database] Error migrating profile SQLite columns:', error);
        reject(error);
      },
      () => resolve()
    );
  });

  await createOwnerIndexes();
  await AsyncStorage.setItem(PROFILE_SQLITE_MIGRATION_KEY, 'done');
};

/**
 * Move one owner's rows for one language from that language's placeholder
 * profile id (e.g. 'ko_default') to the real (cloud) profile id. Scoped by owner
 * and language so it never relabels another account's or another language's
 * rows. `ownerId` defaults to the active local owner.
 */
export const replaceDefaultProfileId = (profileId, language = 'ko', options = {}) => {
  const nextProfileId = typeof profileId === 'string' ? profileId.trim() : '';
  const normalizedLanguage = typeof language === 'string' && language.trim() ? language.trim() : 'ko';
  const defaultProfileId = getDefaultProfileIdForLanguage(normalizedLanguage);
  const ownerId = resolveOwnerId(options.ownerId ?? getActiveOwnerId());
  // Rows from before profiles existed have no profile id; they predate
  // multi-language support, so they belong to the default (Korean) profile only.
  const includeUnscopedRows = defaultProfileId === DEFAULT_ACTIVE_PROFILE_ID;
  const profileClause = includeUnscopedRows
    ? "(profile_id = ? OR profile_id IS NULL OR TRIM(profile_id) = '')"
    : 'profile_id = ?';

  return new Promise((resolve, reject) => {
    if (!nextProfileId || nextProfileId === defaultProfileId) {
      resolve();
      return;
    }

    db.transaction(
      tx => {
        SQLITE_OWNER_SCOPED_TABLES.forEach((tableName) => {
          const hasLanguage = SQLITE_TABLES_WITH_LANGUAGE.has(tableName);
          // OR IGNORE: tables with a unique (owner, profile, ...) key may already
          // hold a row for the real profile; keep that one rather than failing.
          tx.executeSql(
            `UPDATE OR IGNORE ${tableName}
             SET profile_id = ?
             WHERE owner_id = ?
               ${hasLanguage ? 'AND language = ?' : ''}
               AND ${profileClause}`,
            hasLanguage
              ? [nextProfileId, ownerId, normalizedLanguage, defaultProfileId]
              : [nextProfileId, ownerId, defaultProfileId]
          );
        });
      },
      (error) => {
        console.error('[Database] Error replacing default profile id:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

// Tables whose rows mean "this owner has saved something". hasSqliteUserData
// checks only these: the learning-signal tables below fill in automatically
// (ability seeds, word scores, lookups), so counting them would make every
// signed-in account look non-empty and block a guest import.
const SQLITE_PRIMARY_USER_DATA_TABLES = [
  'vocab',
  'vocab_contexts',
  'book_notes',
  'book_bookmarks',
];

// Per-owner learning signal that must move with the owner on guest import and
// be removed on discard, but doesn't count as "has data" on its own.
const SQLITE_LEARNING_SIGNAL_TABLES = [
  'interaction_events',
  'profile_ability',
  'word_scores',
];

const SQLITE_USER_DATA_TABLES = [
  ...SQLITE_PRIMARY_USER_DATA_TABLES,
  ...SQLITE_LEARNING_SIGNAL_TABLES,
];

const SQLITE_OWNER_CACHE_TABLES = [
  'book_index',
  'book_preprocess_meta',
  'book_preprocess_chapters',
];

const SQLITE_OWNER_SCOPED_TABLES = [
  ...SQLITE_USER_DATA_TABLES,
  ...SQLITE_OWNER_CACHE_TABLES,
];

const SQLITE_TABLES_WITH_LANGUAGE = new Set([
  'vocab',
  'vocab_contexts',
  'book_notes',
  'book_bookmarks',
  'interaction_events',
  'profile_ability',
  'word_scores',
]);

const sqliteTableHasData = (tableName, whereClause, params = [], logLabel = 'owner data') => (
  new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          `SELECT 1 AS has_data FROM ${tableName}
           WHERE ${whereClause}
           LIMIT 1`,
          params,
          (_, result) => resolve(result.rows.length > 0),
          (_, error) => {
            console.error(`[Database] Error checking ${logLabel} in ${tableName}:`, error);
            reject(error);
            return false;
          }
        );
      },
      (error) => reject(error)
    );
  })
);

export const hasSqliteUserData = async (ownerId = GUEST_OWNER_ID) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const results = await Promise.all(
    SQLITE_PRIMARY_USER_DATA_TABLES.map((tableName) => (
      sqliteTableHasData(tableName, 'owner_id = ?', [scopedOwnerId], 'owner data')
    ))
  );

  return results.some(Boolean);
};

export const clearSqliteUserData = async (ownerId = GUEST_OWNER_ID) => {
  const scopedOwnerId = resolveOwnerId(ownerId);

  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        SQLITE_OWNER_SCOPED_TABLES.forEach((tableName) => {
          tx.executeSql(`DELETE FROM ${tableName} WHERE owner_id = ?`, [scopedOwnerId]);
        });
      },
      (error) => {
        console.error(`[Database] Error clearing SQLite user data for "${scopedOwnerId}":`, error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const hasUnscopedSqliteUserData = async () => {
  const results = await Promise.all(
    SQLITE_PRIMARY_USER_DATA_TABLES.map((tableName) => (
      sqliteTableHasData(
        tableName,
        "owner_id IS NULL OR TRIM(owner_id) = ''",
        [],
        'unscoped owner data'
      )
    ))
  );

  return results.some(Boolean);
};

export const assignUnscopedSqliteUserDataToGuest = async () => {
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        SQLITE_USER_DATA_TABLES.forEach((tableName) => {
          tx.executeSql(
            `UPDATE ${tableName}
             SET owner_id = ?
             WHERE owner_id IS NULL OR TRIM(owner_id) = ''`,
            [GUEST_OWNER_ID]
          );
        });
      },
      (error) => {
        console.error('[Database] Error assigning unscoped SQLite user data to guest:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const clearUnscopedSqliteUserData = async () => {
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        SQLITE_OWNER_SCOPED_TABLES.forEach((tableName) => {
          tx.executeSql(
            `DELETE FROM ${tableName}
             WHERE owner_id IS NULL OR TRIM(owner_id) = ''`
          );
        });
      },
      (error) => {
        console.error('[Database] Error clearing unscoped SQLite user data:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const reassignSqliteUserData = async (fromOwnerId, toOwnerId) => {
  const sourceOwnerId = resolveOwnerId(fromOwnerId);
  const targetOwnerId = resolveOwnerId(toOwnerId);

  if (sourceOwnerId === targetOwnerId) {
    return;
  }

  if (await hasSqliteUserData(targetOwnerId)) {
    throw new Error('Refusing to reassign SQLite user data because target owner already has local rows');
  }

  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        SQLITE_PRIMARY_USER_DATA_TABLES.forEach((tableName) => {
          tx.executeSql(
            `UPDATE ${tableName} SET owner_id = ? WHERE owner_id = ?`,
            [targetOwnerId, sourceOwnerId]
          );
        });

        // Events are append-only with a globally unique client_event_id; clear
        // synced_at so they are pushed to the new owner's account.
        tx.executeSql(
          'UPDATE interaction_events SET owner_id = ?, synced_at = NULL WHERE owner_id = ?',
          [targetOwnerId, sourceOwnerId]
        );

        // word_scores is a recomputable cache keyed (owner, profile, language,
        // stem): move what doesn't collide, drop the source's colliding rows.
        tx.executeSql(
          'UPDATE OR IGNORE word_scores SET owner_id = ? WHERE owner_id = ?',
          [targetOwnerId, sourceOwnerId]
        );
        tx.executeSql('DELETE FROM word_scores WHERE owner_id = ?', [sourceOwnerId]);

        // profile_ability is unique per (owner, profile, language). The target
        // may already have a seeded row; keep whichever estimate has seen more
        // events (newer on a tie) instead of hitting a duplicate-key failure.
        tx.executeSql(
          'SELECT * FROM profile_ability WHERE owner_id IN (?, ?)',
          [sourceOwnerId, targetOwnerId],
          (_, result) => {
            const rows = result.rows._array ?? [];
            const scopeKey = (row) => `${row.profile_id ?? ''}::${row.language ?? ''}`;
            const targetByScope = new Map(
              rows.filter((row) => row.owner_id === targetOwnerId).map((row) => [scopeKey(row), row])
            );

            rows.filter((row) => row.owner_id === sourceOwnerId).forEach((sourceRow) => {
              const targetRow = targetByScope.get(scopeKey(sourceRow));
              if (!targetRow) {
                tx.executeSql(
                  'UPDATE profile_ability SET owner_id = ?, synced_at = NULL WHERE id = ?',
                  [targetOwnerId, sourceRow.id]
                );
                return;
              }

              const sourceEvents = Number(sourceRow.event_count) || 0;
              const targetEvents = Number(targetRow.event_count) || 0;
              const sourceWins = sourceEvents > targetEvents || (
                sourceEvents === targetEvents
                && timestampValue(sourceRow.updated_at) > timestampValue(targetRow.updated_at)
              );

              if (sourceWins) {
                tx.executeSql(
                  `UPDATE profile_ability
                   SET theta = ?, self_report_rank = ?, event_count = ?, seeded_at = ?,
                       updated_at = ?, synced_at = NULL
                   WHERE id = ?`,
                  [
                    sourceRow.theta,
                    sourceRow.self_report_rank,
                    sourceRow.event_count,
                    sourceRow.seeded_at,
                    sourceRow.updated_at ?? nowIso(),
                    targetRow.id,
                  ]
                );
              }

              tx.executeSql('DELETE FROM profile_ability WHERE id = ?', [sourceRow.id]);
            });
          }
        );
      },
      (error) => {
        console.error(`[Database] Error reassigning SQLite data from "${sourceOwnerId}" to "${targetOwnerId}":`, error);
        reject(error);
      },
      () => resolve()
    );
  });
};

/**
 * initAllTables
 * Convenience function: creates all tables in the correct order.
 * Call this once at app startup (in App.js or useAppSetup.js).
 */
const deduplicateCacheTable = () => {
  return new Promise((resolve) => {
    db.transaction(tx => {
      // Keep only the lowest-id row per target language, stem, and interface language.
      tx.executeSql(
        `DELETE FROM dictionary_cache
         WHERE id NOT IN (
           SELECT MIN(id) FROM dictionary_cache GROUP BY language, stem, interface_language
         )`,
        [],
        () => resolve(),
        (_, error) => {
          console.warn('[Database] deduplicateCacheTable failed (non-fatal):', error);
          resolve(); // non-fatal
        }
      );
    });
  });
};

// ─── Book notes (reader "note to self") ───────────────────────────────────────
//
// A short free-text note the reader leaves for their future self when they step
// away from a book (thoughtful close), surfaced again as a "welcome back" card on
// re-entry and browsable as a per-book log. Real user content, so the schema is
// sync-ready (client-generated id, updated_at/deleted_at/synced_at) even though
// cloud sync is not wired yet — notes live on-device for now.

const makeBookNoteId = () => (
  `bn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
);

export const createBookNotesTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS book_notes (
          id            TEXT PRIMARY KEY,
          owner_id      TEXT NOT NULL DEFAULT 'guest',
          profile_id    TEXT DEFAULT 'ko_default',
          book_uri      TEXT NOT NULL,
          language      TEXT NOT NULL DEFAULT 'ko',
          note          TEXT NOT NULL,
          chapter_label TEXT,
          progress      REAL,
          created_at    TEXT NOT NULL,
          updated_at    TEXT,
          deleted_at    TEXT,
          synced_at     TEXT
        )`,
        [],
        () => {
          tx.executeSql(
            `CREATE INDEX IF NOT EXISTS idx_book_notes_owner_book_created
             ON book_notes(owner_id, profile_id, book_uri, created_at)`,
            [],
            () => resolve(),
            (_, error) => {
              console.error('[Database] Error indexing book_notes:', error);
              reject(error);
              return true;
            }
          );
        },
        (_, error) => {
          console.error('[Database] Error creating book_notes table:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

export const migrateBookNotesTable = async () => {
  const columns = await getTableColumns('book_notes');
  const alterations = [];

  if (!columns.includes('note')) {
    alterations.push("ALTER TABLE book_notes ADD COLUMN note TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.includes('chapter_label')) {
    alterations.push('ALTER TABLE book_notes ADD COLUMN chapter_label TEXT');
  }
  if (!columns.includes('progress')) {
    alterations.push('ALTER TABLE book_notes ADD COLUMN progress REAL');
  }
  if (!columns.includes('synced_at')) {
    alterations.push('ALTER TABLE book_notes ADD COLUMN synced_at TEXT');
  }

  if (alterations.length === 0) return;

  await new Promise((resolve, reject) => {
    db.transaction(tx => {
      alterations.reduce((chain, sql) => {
        return chain.then(() => new Promise((res, rej) => {
          tx.executeSql(sql, [], () => res(), (_, err) => { rej(err); return true; });
        }));
      }, Promise.resolve()).then(resolve).catch(reject);
    });
  });
};

export const insertBookNote = ({
  ownerId,
  profileId,
  bookUri,
  language = 'ko',
  note,
  chapterLabel = null,
  progress = null,
} = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);
  const trimmed = typeof note === 'string' ? note.trim() : '';

  return new Promise((resolve, reject) => {
    if (!bookUri || !trimmed) {
      return resolve(null);
    }
    const id = makeBookNoteId();
    const createdAt = new Date().toISOString();
    db.transaction(tx => {
      tx.executeSql(
        `INSERT INTO book_notes
           (id, owner_id, profile_id, book_uri, language, note, chapter_label, progress, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          normalizedLanguage,
          trimmed,
          chapterLabel,
          typeof progress === 'number' ? progress : null,
          createdAt,
          createdAt,
        ],
        () => resolve({
          id,
          bookUri,
          language: normalizedLanguage,
          note: trimmed,
          chapterLabel,
          progress: typeof progress === 'number' ? progress : null,
          createdAt,
        }),
        (_, error) => {
          console.error('[Database] Error inserting book note:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

export const getBookNotes = (bookUri, { ownerId, profileId, language = 'ko', limit = 100 } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      return resolve([]);
    }
    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, note, chapter_label AS chapterLabel, progress, created_at AS createdAt
         FROM book_notes
         WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND language = ?
           AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ?`,
        [scopedOwnerId, scopedProfileId, bookUri, normalizedLanguage, Math.max(1, Number(limit) || 100)],
        (_, result) => resolve(result.rows._array),
        (_, error) => {
          console.error('[Database] Error reading book notes:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

export const getLatestBookNote = async (bookUri, options = {}) => {
  const rows = await getBookNotes(bookUri, { ...options, limit: 1 });
  return rows[0] ?? null;
};

export const deleteBookNote = (id, { ownerId } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  return new Promise((resolve, reject) => {
    if (!id) {
      return resolve(false);
    }
    const deletedAt = new Date().toISOString();
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE book_notes SET deleted_at = ?, updated_at = ?, synced_at = NULL
         WHERE id = ? AND owner_id = ?`,
        [deletedAt, deletedAt, id, scopedOwnerId],
        (_, result) => resolve((result.rowsAffected ?? 0) > 0),
        (_, error) => {
          console.error('[Database] Error deleting book note:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

// ─── Book bookmarks (reader checkpoints) ──────────────────────────────────────
//
// A saved reading position the reader can jump back to from the checkpoints
// sheet. Stores the same position shape the native reader restores from
// (spine index + page + first block id), plus display metadata. Sync-ready
// schema like book_notes, though bookmarks live on-device for now.

const makeBookBookmarkId = () => (
  `bb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
);

export const createBookBookmarksTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS book_bookmarks (
          id             TEXT PRIMARY KEY,
          owner_id       TEXT NOT NULL DEFAULT 'guest',
          profile_id     TEXT DEFAULT 'ko_default',
          book_uri       TEXT NOT NULL,
          language       TEXT NOT NULL DEFAULT 'ko',
          spine_index    INTEGER NOT NULL,
          page_index     INTEGER,
          pages_in_chapter INTEGER,
          href           TEXT,
          first_block_id TEXT,
          chapter_label  TEXT,
          progress       REAL,
          created_at     TEXT NOT NULL,
          updated_at     TEXT,
          deleted_at     TEXT,
          synced_at      TEXT
        )`,
        [],
        () => {
          tx.executeSql(
            `CREATE INDEX IF NOT EXISTS idx_book_bookmarks_owner_book_created
             ON book_bookmarks(owner_id, profile_id, book_uri, created_at)`,
            [],
            () => resolve(),
            (_, error) => {
              console.error('[Database] Error indexing book_bookmarks:', error);
              reject(error);
              return true;
            }
          );
        },
        (_, error) => {
          console.error('[Database] Error creating book_bookmarks table:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

export const insertBookBookmark = ({
  ownerId,
  profileId,
  bookUri,
  language = 'ko',
  spineIndex,
  pageIndex = null,
  pagesInChapter = null,
  href = null,
  firstBlockId = null,
  chapterLabel = null,
  progress = null,
} = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);

  return new Promise((resolve, reject) => {
    if (!bookUri || !Number.isInteger(spineIndex)) {
      return resolve(null);
    }
    const id = makeBookBookmarkId();
    const createdAt = new Date().toISOString();
    db.transaction(tx => {
      tx.executeSql(
        `INSERT INTO book_bookmarks
           (id, owner_id, profile_id, book_uri, language, spine_index, page_index,
            pages_in_chapter, href, first_block_id, chapter_label, progress, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          normalizedLanguage,
          spineIndex,
          Number.isInteger(pageIndex) ? pageIndex : null,
          Number.isInteger(pagesInChapter) ? pagesInChapter : null,
          href || null,
          firstBlockId || null,
          chapterLabel,
          typeof progress === 'number' ? progress : null,
          createdAt,
          createdAt,
        ],
        () => resolve({
          id,
          bookUri,
          language: normalizedLanguage,
          spineIndex,
          pageIndex: Number.isInteger(pageIndex) ? pageIndex : null,
          pagesInChapter: Number.isInteger(pagesInChapter) ? pagesInChapter : null,
          href: href || null,
          firstBlockId: firstBlockId || null,
          chapterLabel,
          progress: typeof progress === 'number' ? progress : null,
          createdAt,
        }),
        (_, error) => {
          console.error('[Database] Error inserting book bookmark:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

export const getBookBookmarks = (bookUri, { ownerId, profileId, language = 'ko', limit = 100 } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      return resolve([]);
    }
    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, spine_index AS spineIndex, page_index AS pageIndex,
                pages_in_chapter AS pagesInChapter, href, first_block_id AS firstBlockId,
                chapter_label AS chapterLabel, progress, created_at AS createdAt
         FROM book_bookmarks
         WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND language = ?
           AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ?`,
        [scopedOwnerId, scopedProfileId, bookUri, normalizedLanguage, Math.max(1, Number(limit) || 100)],
        (_, result) => resolve(result.rows._array),
        (_, error) => {
          console.error('[Database] Error reading book bookmarks:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

export const deleteBookBookmark = (id, { ownerId } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  return new Promise((resolve, reject) => {
    if (!id) {
      return resolve(false);
    }
    const deletedAt = new Date().toISOString();
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE book_bookmarks SET deleted_at = ?, updated_at = ?, synced_at = NULL
         WHERE id = ? AND owner_id = ?`,
        [deletedAt, deletedAt, id, scopedOwnerId],
        (_, result) => resolve((result.rowsAffected ?? 0) > 0),
        (_, error) => {
          console.error('[Database] Error deleting book bookmark:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

// ─── Highlights and notes (long press → toolbar) ──────────────────────────────
//
// A highlight is a passage the reader marked, kept by position (spine item,
// block, source offsets: what the native selection reports) with its text.
// A note is a highlight with the reader's words attached (`note`), shown in
// the book's notes list. Kept on this device for now, like bookmarks.

const makeBookHighlightId = () => (
  `bh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
);

export const createBookHighlightsTable = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `CREATE TABLE IF NOT EXISTS book_highlights (
          id             TEXT PRIMARY KEY,
          owner_id       TEXT NOT NULL DEFAULT 'guest',
          profile_id     TEXT DEFAULT 'ko_default',
          book_uri       TEXT NOT NULL,
          language       TEXT NOT NULL DEFAULT 'ko',
          spine_index    INTEGER NOT NULL,
          block_id       TEXT NOT NULL,
          start_offset   INTEGER NOT NULL,
          end_offset     INTEGER NOT NULL,
          text           TEXT NOT NULL,
          color          TEXT NOT NULL DEFAULT 'yellow',
          note           TEXT,
          chapter_label  TEXT,
          progress       REAL,
          created_at     TEXT NOT NULL,
          updated_at     TEXT,
          deleted_at     TEXT,
          synced_at      TEXT
        )`,
        [],
        () => {
          tx.executeSql(
            `CREATE INDEX IF NOT EXISTS idx_book_highlights_owner_book
             ON book_highlights(owner_id, profile_id, book_uri, spine_index)`,
            [],
            () => resolve(),
            (_, error) => {
              console.error('[Database] Error indexing book_highlights:', error);
              reject(error);
              return true;
            }
          );
        },
        (_, error) => {
          console.error('[Database] Error creating book_highlights table:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

export const insertBookHighlight = ({
  ownerId,
  profileId,
  bookUri,
  language = 'ko',
  spineIndex,
  blockId,
  startOffset,
  endOffset,
  text,
  color = 'yellow',
  note = null,
  chapterLabel = null,
  progress = null,
} = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);

  return new Promise((resolve, reject) => {
    if (!bookUri || !Number.isInteger(spineIndex) || !blockId
      || !Number.isInteger(startOffset) || !Number.isInteger(endOffset) || endOffset <= startOffset) {
      return resolve(null);
    }
    const id = makeBookHighlightId();
    const createdAt = new Date().toISOString();
    const cleanText = String(text || '').trim();
    const cleanNote = typeof note === 'string' && note.trim() ? note.trim() : null;
    db.transaction(tx => {
      tx.executeSql(
        `INSERT INTO book_highlights
           (id, owner_id, profile_id, book_uri, language, spine_index, block_id, start_offset,
            end_offset, text, color, note, chapter_label, progress, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, scopedOwnerId, scopedProfileId, bookUri, normalizedLanguage, spineIndex, blockId,
          startOffset, endOffset, cleanText, color, cleanNote, chapterLabel,
          typeof progress === 'number' ? progress : null, createdAt, createdAt,
        ],
        () => resolve({
          id, spineIndex, blockId, startOffset, endOffset, text: cleanText, color, note: cleanNote,
          chapterLabel, progress: typeof progress === 'number' ? progress : null, createdAt,
        }),
        (_, error) => {
          console.error('[Database] Error inserting book highlight:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

export const getBookHighlights = (bookUri, { ownerId, profileId, language = 'ko' } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      return resolve([]);
    }
    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, spine_index AS spineIndex, block_id AS blockId, start_offset AS startOffset,
                end_offset AS endOffset, text, color, note, chapter_label AS chapterLabel,
                progress, created_at AS createdAt
         FROM book_highlights
         WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND language = ?
           AND deleted_at IS NULL
         ORDER BY spine_index ASC, start_offset ASC`,
        [scopedOwnerId, scopedProfileId, bookUri, normalizedLanguage],
        (_, result) => resolve(result.rows._array),
        (_, error) => {
          console.error('[Database] Error reading book highlights:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

export const updateBookHighlightNote = (id, note, { ownerId } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  return new Promise((resolve, reject) => {
    if (!id) {
      return resolve(false);
    }
    const updatedAt = new Date().toISOString();
    const cleanNote = typeof note === 'string' && note.trim() ? note.trim() : null;
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE book_highlights SET note = ?, updated_at = ?, synced_at = NULL
         WHERE id = ? AND owner_id = ?`,
        [cleanNote, updatedAt, id, scopedOwnerId],
        (_, result) => resolve((result.rowsAffected ?? 0) > 0),
        (_, error) => {
          console.error('[Database] Error updating book highlight note:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

export const updateBookHighlightColor = (id, color, { ownerId } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  return new Promise((resolve, reject) => {
    if (!id || !color) {
      return resolve(false);
    }
    const updatedAt = new Date().toISOString();
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE book_highlights SET color = ?, updated_at = ?, synced_at = NULL
         WHERE id = ? AND owner_id = ?`,
        [color, updatedAt, id, scopedOwnerId],
        (_, result) => resolve((result.rowsAffected ?? 0) > 0),
        (_, error) => {
          console.error('[Database] Error updating book highlight color:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

export const deleteBookHighlight = (id, { ownerId } = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  return new Promise((resolve, reject) => {
    if (!id) {
      return resolve(false);
    }
    const deletedAt = new Date().toISOString();
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE book_highlights SET deleted_at = ?, updated_at = ?, synced_at = NULL
         WHERE id = ? AND owner_id = ?`,
        [deletedAt, deletedAt, id, scopedOwnerId],
        (_, result) => resolve((result.rowsAffected ?? 0) > 0),
        (_, error) => {
          console.error('[Database] Error deleting book highlight:', error);
          reject(error);
          return true;
        }
      );
    });
  });
};

// ─── Word candidates for the "before you go" panel ────────────────────────────
//
// Reuses the Phase 4.4 flashcard nominator (uncertain AND rare-in-book words the
// reader didn't already save) and hydrates each stem with its cached dictionary
// entry (reading, gloss, hanja, level) so the panel can render it. Pure daily
// rotation + badge selection live in services/wordCandidates.js.

export const getBookWordCandidates = async ({
  ownerId,
  profileId,
  language = 'ko',
  interfaceLanguage = 'en',
  bookUri,
  limit = 12,
} = {}) => {
  if (!bookUri) return [];
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';

  const nominations = await nominateFlashcards({
    ownerId,
    profileId,
    language: normalizedLanguage,
    sourceBookUri: bookUri,
    limit,
  });
  if (nominations.length === 0) return [];

  const stems = nominations.map((n) => n.stem);
  const cacheRows = await lookupCacheByStems(stems, {
    language: normalizedLanguage,
    interfaceLanguage,
  });
  const cacheByStem = new Map();
  cacheRows.forEach((row) => {
    if (!cacheByStem.has(row.stem)) {
      cacheByStem.set(row.stem, row);
    }
  });

  return nominations
    .map((n) => {
      const entry = cacheByStem.get(n.stem);
      if (!entry) return null;
      const gloss = (entry.gloss || entry.definition || '').trim();
      if (!gloss) return null;
      return {
        stem: n.stem,
        headword: n.stem,
        romanization: entry.romanization || '',
        gloss,
        hanja: entry.hanja || '',
        levelLabel: entry.level_label || '',
        levelRank: entry.level_rank ?? null,
        pKnown: n.pKnown,
        uncertainty: n.uncertainty,
        remainingCount: n.remainingCount,
      };
    })
    .filter(Boolean);
};

// ─── Saved words scoped to a single book ──────────────────────────────────────
//
// Powers the reader's saved-word count pill and the panel's "Saved" tab. Unlike
// getSavedWords (language-wide, strings only), this returns the vocab rows a
// reader saved *while in this book*, newest first, with just enough for a list
// row. `source_book_uri` is stamped on every save (see insertData).

export const getBookSavedWords = async ({ ownerId, profileId, language = 'ko', bookUri } = {}) => {
  if (!bookUri) return [];
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);

  const rows = await runSelect(
    `SELECT id, word, hanja, def, level, source, source_book_title, created_at
     FROM vocab
     WHERE owner_id = ? AND profile_id = ? AND language = ? AND source_book_uri = ?
       AND deleted_at IS NULL AND COALESCE(level, '') != '${LEARNED_LEVEL}'
     ORDER BY COALESCE(created_at, updated_at) DESC, id DESC`,
    [scopedOwnerId, scopedProfileId, normalizedLanguage, bookUri]
  );

  return rows.map((row) => ({
    id: row.id,
    word: row.word,
    hanja: row.hanja || '',
    def: row.def || '',
    level: row.level || 'unorganized',
    source: row.source || null,
    bookTitle: row.source_book_title || '',
    createdAt: row.created_at || null,
  }));
};

// ─── Candidates across every book, grouped by book ────────────────────────────
//
// The reader panel shows candidates for the current book; the vocab (Learn)
// screen's "Suggested" tab shows them for *every* book the reader has scored,
// grouped per book. Book identity comes from word_scores (the candidate pool);
// titles are recovered from any vocab row the reader saved from that book, since
// word_scores itself doesn't carry a title.

export const getAllBooksWordCandidates = async ({
  ownerId,
  profileId,
  language = 'ko',
  interfaceLanguage = 'en',
  perBookLimit = 12,
} = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);

  const bookRows = await runSelect(
    `SELECT DISTINCT source_book_uri AS uri FROM word_scores
     WHERE owner_id = ? AND profile_id = ? AND language = ?
       AND source_book_uri IS NOT NULL AND p_known IS NOT NULL`,
    [scopedOwnerId, scopedProfileId, normalizedLanguage]
  );
  if (bookRows.length === 0) return [];

  // Best-effort title per book from the reader's own saves for it.
  const titleRows = await runSelect(
    `SELECT source_book_uri AS uri, source_book_title AS title
     FROM vocab
     WHERE owner_id = ? AND profile_id = ? AND language = ?
       AND source_book_uri IS NOT NULL AND source_book_title IS NOT NULL
       AND deleted_at IS NULL
     GROUP BY source_book_uri`,
    [scopedOwnerId, scopedProfileId, normalizedLanguage]
  );
  const titleByUri = new Map(titleRows.map((r) => [r.uri, r.title]));

  const groups = await Promise.all(
    bookRows.map(async ({ uri }) => {
      const candidates = await getBookWordCandidates({
        ownerId: scopedOwnerId,
        profileId: scopedProfileId,
        language: normalizedLanguage,
        interfaceLanguage,
        bookUri: uri,
        limit: perBookLimit,
      });
      return {
        bookUri: uri,
        bookTitle: titleByUri.get(uri) || '',
        candidates,
      };
    })
  );

  // Drop books that yielded nothing; surface the fullest lists first.
  return groups
    .filter((group) => group.candidates.length > 0)
    .sort((a, b) => b.candidates.length - a.candidates.length);
};

// ─── Sentence translations ────────────────────────────────────────────────────
// Translations of book sentences, fetched a chapter at a time
// (services/chapterTranslations.js) for listen mode and the pinned translation
// bar. Content, not personal data: shared by every profile on the phone and
// keyed on the normalized sentence (services/sentenceSplit.js). Capped so a
// heavy listener's phone doesn't grow it without bound.
const SENTENCE_TRANSLATIONS_MAX_ROWS = 40000;

export const createSentenceTranslationsTable = () => new Promise((resolve, reject) => {
  db.transaction(tx => {
    tx.executeSql(
      `CREATE TABLE IF NOT EXISTS sentence_translations (
        source     TEXT NOT NULL,
        target     TEXT NOT NULL,
        sentence   TEXT NOT NULL,
        translated TEXT NOT NULL,
        created_at TEXT,
        PRIMARY KEY (source, target, sentence)
      )`,
      [],
      () => resolve(),
      (_, error) => {
        console.error('[Database] Error creating sentence_translations table:', error);
        reject(error);
      }
    );
  });
});

/** { sentence: translation } for the ones already saved. */
export const getSentenceTranslations = async ({ source, target, sentences = [] } = {}) => {
  const list = Array.from(new Set((sentences || []).filter((s) => typeof s === 'string' && s)));
  if (!source || !target || list.length === 0) return {};
  const rows = (await Promise.all(chunkValues(list).map((chunk) => runSelect(
    `SELECT sentence, translated FROM sentence_translations
     WHERE source = ? AND target = ? AND sentence IN (${chunk.map(() => '?').join(', ')})`,
    [source, target, ...chunk]
  )))).flat();
  const out = {};
  rows.forEach((row) => { if (row.translated) out[row.sentence] = row.translated; });
  return out;
};

export const saveSentenceTranslations = ({ source, target, entries = [] } = {}) => {
  const list = (entries || []).filter(([sentence, translated]) => sentence && translated);
  if (!source || !target || list.length === 0) return Promise.resolve(0);
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        list.forEach(([sentence, translated]) => {
          tx.executeSql(
            `INSERT OR REPLACE INTO sentence_translations (source, target, sentence, translated, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [source, target, sentence, translated, now]
          );
        });
        // Oldest first out once over the cap.
        tx.executeSql(
          `DELETE FROM sentence_translations WHERE rowid IN (
             SELECT rowid FROM sentence_translations ORDER BY created_at DESC LIMIT -1 OFFSET ?
           )`,
          [SENTENCE_TRANSLATIONS_MAX_ROWS]
        );
      },
      (error) => {
        console.error('[Database] Error saving sentence translations:', error);
        reject(error);
      },
      () => resolve(list.length)
    );
  });
};

export const initAllTables = async () => {
  await createTable();
  await migrateVocabTable();
  await createVocabContextTable();
  await migrateVocabContextTable();
  await createInteractionEventsTable();
  await migrateInteractionEventsTable();
  await createProfileAbilityTable();
  await migrateProfileAbilityTable();
  await createAbilityLogTable();
  await createWordScoresTable();
  await migrateWordScoresTable();
  await backfillVocabDefinitionKeys();
  await migrateVocabEmptyHanja();
  await dedupeVocabDefinitionKeyRows();
  await createDictionaryCacheTable();
  await migrateDictionaryCache();
  await migrateDictionaryCacheInterfaceLanguage();
  await migrateDictionaryCacheTargetLanguage();
  await migrateDictionaryCacheGloss();
  await migrateDictionaryCacheWordParts();
  await migrateDictionaryCacheAudio();
  await migrateDictionaryCacheProficiencyLevels();
  await migrateDictionaryCacheDifficulty();
  await migrateDictionaryCacheWordFeatures();
  await migrateDictionaryCacheRomanization();
  await migrateDictionaryCacheZhScripts();
  await migrateBookIndex();
  await createBookIndexTable();
  await purgeKoreanNonEnglishCacheRows();
  await createBookNotesTable();
  await migrateBookNotesTable();
  await createBookBookmarksTable();
  await createBookHighlightsTable();
  await createBookPreprocessTables();
  await migrateBookPreprocessLevelColumns();
  await createSentenceTranslationsTable();
  await migrateLocalOwnerSqlite();
  await migrateProfileSqlite();
  await createOwnerIndexes();
  await deduplicateCacheTable();
  await initializeHanjaDatabase();
};


// ─── Vocab Table Operations ───────────────────────────────────────────────────

export const insertData = (word, hanja, definition, levelOrOptions) => {
  const options = typeof levelOrOptions === 'object' && levelOrOptions !== null
    ? levelOrOptions
    : { level: levelOrOptions };

  const {
    level = 'unorganized',
    sourceBookUri = null,
    sourceBookTitle = null,
    isFavorite = 0,
    priority = 'normal',
    createdAt = new Date().toISOString(),
    lastReviewedAt = null,
    nextReviewAt = null,
    correctCount = 0,
    wrongCount = 0,
    relatedKnownWords = [],
    updatedAt = createdAt,
    deletedAt = null,
    language = 'ko',
    source = null,
    ownerId = GUEST_OWNER_ID,
    profileId = null,
  } = options;

  // Phase 4.4 scheduling prior: seed a brand-new card's FSRS state from its
  // P(known) when the caller supplies it, so a likely-known word starts with a
  // longer interval / lower difficulty than the generic default. An explicit
  // stability/difficulty option still wins; absent both, the defaults stand.
  const pKnownSeed = Number.isFinite(Number(options.pKnown))
    ? initialFsrsFromPKnown(Number(options.pKnown))
    : null;
  const stability = options.stability != null
    ? options.stability
    : (pKnownSeed ? pKnownSeed.stability : DEFAULT_STABILITY);
  const difficulty = options.difficulty != null
    ? options.difficulty
    : (pKnownSeed ? pKnownSeed.difficulty : DEFAULT_DIFFICULTY);
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scopedProfileId = resolveProfileId(profileId ?? options.profile_id ?? options, language);
  const relatedKnownWordsJson = JSON.stringify(Array.isArray(relatedKnownWords) ? relatedKnownWords : []);
  const definitionKey = makeVocabDefinitionKey(definition);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `INSERT INTO vocab (
          owner_id, profile_id, word, hanja, def, def_key, level, source_book_uri, source_book_title, is_favorite,
          priority, created_at, last_reviewed_at, next_review_at, correct_count, wrong_count,
          stability, difficulty, related_known_words, updated_at, deleted_at, language, source
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scopedOwnerId,
          scopedProfileId,
          word,
          normalizeHanjaForStorage(hanja),
          definition,
          definitionKey,
          level,
          sourceBookUri,
          sourceBookTitle,
          isFavorite ? 1 : 0,
          priority,
          createdAt,
          lastReviewedAt,
          nextReviewAt,
          correctCount,
          wrongCount,
          normalizeFsrsValue(stability, DEFAULT_STABILITY),
          normalizeFsrsValue(difficulty, DEFAULT_DIFFICULTY, 1, 10),
          relatedKnownWordsJson,
          updatedAt ?? createdAt,
          deletedAt,
          language || 'ko',
          source ?? null,
        ],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error inserting vocab word "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const vocabEntryExists = (word, hanja, definition, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language);
  const definitionKey = makeVocabDefinitionKey(definition);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT COUNT(*) AS count
         FROM vocab
         WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL`,
        [ownerId, profileId, word, hanja ?? null, definitionKey, language],
        (_, result) => {
          const { count } = result.rows.item(0);
          resolve(count > 0);
        },
        (_, error) => {
          console.error(`[Database] Error checking vocab entry for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const insertDataIfMissing = async (word, hanja, definition, levelOrOptions) => {
  const options = typeof levelOrOptions === 'object' && levelOrOptions !== null
    ? levelOrOptions
    : { level: levelOrOptions };
  const language = options.language ?? 'ko';
  const ownerId = resolveOwnerId(options);
  const exists = await vocabEntryExists(word, hanja, definition, language, { ...options, ownerId });
  if (exists) {
    return false;
  }

  await insertData(word, hanja, definition, { ...options, ownerId });
  return true;
};

export const upsertVocabEntryFromCloud = (entry, options = {}) => {
  const now = new Date().toISOString();
  const word = entry.word;
  const hanja = normalizeHanjaForStorage(entry.hanja);
  const definition = entry.definition ?? entry.def ?? null;
  const definitionKey = makeVocabDefinitionKey(definition);
  const level = entry.status ?? entry.level ?? 'unorganized';
  const language = entry.language ?? 'ko';
  const createdAt = entry.created_at ?? entry.createdAt ?? now;
  const updatedAt = entry.updated_at ?? entry.updatedAt ?? createdAt;
  const stability = normalizeFsrsValue(entry.stability, DEFAULT_STABILITY);
  const difficulty = normalizeFsrsValue(entry.difficulty, DEFAULT_DIFFICULTY, 1, 10);
  const ownerId = resolveOwnerId(options.ownerId ?? entry.owner_id ?? entry.ownerId);
  const profileId = resolveProfileId(options.profileId ?? entry.profile_id ?? entry.profileId ?? options, language);
  // Cloud rows carry no profile, so the same word may already be saved locally
  // under the other id this language has had: the placeholder ('ko_default')
  // before the real profile id was known, or the real id when this pull runs
  // under the placeholder. Match those too so a pull never files a second copy.
  // A word in the placeholder moves to the real profile; a word in a real
  // profile stays there. Two real profiles are never merged.
  const placeholderProfileId = getDefaultProfileIdForLanguage(language);
  const targetIsPlaceholder = isPlaceholderProfileId(profileId, language);
  const profileMatchClause = targetIsPlaceholder ? '' : 'AND profile_id IN (?, ?)';
  const profileMatchParams = targetIsPlaceholder ? [] : [profileId, placeholderProfileId];
  // Cloud vocab rows don't carry related_known_words (those sync through their
  // own table). Bind null when the field is absent so the UPDATE keeps the local
  // list instead of wiping it to '[]'.
  const rawRelatedKnownWords = entry.related_known_words ?? entry.relatedKnownWords;
  const relatedKnownWordsJson = rawRelatedKnownWords == null
    ? null
    : (Array.isArray(rawRelatedKnownWords) ? JSON.stringify(rawRelatedKnownWords) : String(rawRelatedKnownWords));

  return new Promise((resolve, reject) => {
    if (!word) {
      resolve(false);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, profile_id
         FROM vocab
         WHERE owner_id = ? ${profileMatchClause} AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ?
         ORDER BY CASE WHEN deleted_at IS NULL THEN 0 ELSE 1 END,
                  CASE WHEN profile_id = ? THEN 0 WHEN profile_id = ? THEN 2 ELSE 1 END,
                  id ASC
         LIMIT 1`,
        [ownerId, ...profileMatchParams, word, hanja, definitionKey, language, profileId, placeholderProfileId],
        (_, result) => {
          const params = [
            ownerId,
            profileId,
            word,
            hanja,
            definition,
            definitionKey,
            level,
            entry.source_book_uri ?? entry.sourceBookUri ?? null,
            entry.source_book_title ?? entry.sourceBookTitle ?? null,
            entry.is_favorite || entry.isFavorite ? 1 : 0,
            entry.priority ?? 'normal',
            createdAt,
            entry.last_reviewed_at ?? entry.lastReviewedAt ?? null,
            entry.next_review_at ?? entry.nextReviewAt ?? null,
            Number(entry.correct_count ?? entry.correctCount ?? 0) || 0,
            Number(entry.wrong_count ?? entry.wrongCount ?? 0) || 0,
            stability,
            difficulty,
            relatedKnownWordsJson ?? '[]',
            updatedAt,
            entry.deleted_at ?? entry.deletedAt ?? null,
            language,
          ];

          if (result.rows.length === 0) {
            tx.executeSql(
              `INSERT INTO vocab (
                owner_id, profile_id, word, hanja, def, def_key, level, source_book_uri, source_book_title, is_favorite,
                priority, created_at, last_reviewed_at, next_review_at,
                correct_count, wrong_count, stability, difficulty, related_known_words, updated_at, deleted_at, language
              )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              params,
              () => resolve(true),
              (_, insertError) => {
                console.error(`[Database] Error inserting cloud vocab row "${word}":`, insertError);
                reject(insertError);
                return false;
              }
            );
            return;
          }

          tx.executeSql(
            `UPDATE vocab
             SET word = ?,
                 owner_id = ?,
                 profile_id = ?,
                 hanja = ?,
                 def = ?,
                 def_key = ?,
                 level = ?,
                 source_book_uri = ?,
                 source_book_title = ?,
                 is_favorite = ?,
                 priority = ?,
                 created_at = ?,
                 last_reviewed_at = ?,
                 next_review_at = ?,
                 correct_count = ?,
                 wrong_count = ?,
                 stability = ?,
                 difficulty = ?,
                 related_known_words = COALESCE(?, related_known_words),
                 updated_at = ?,
                 deleted_at = ?,
                 language = ?
             WHERE id = ?`,
            [
              word,
              ownerId,
              targetIsPlaceholder ? result.rows.item(0).profile_id : profileId,
              hanja,
              definition,
              definitionKey,
              level,
              entry.source_book_uri ?? entry.sourceBookUri ?? null,
              entry.source_book_title ?? entry.sourceBookTitle ?? null,
              entry.is_favorite || entry.isFavorite ? 1 : 0,
              entry.priority ?? 'normal',
              createdAt,
              entry.last_reviewed_at ?? entry.lastReviewedAt ?? null,
              entry.next_review_at ?? entry.nextReviewAt ?? null,
              Number(entry.correct_count ?? entry.correctCount ?? 0) || 0,
              Number(entry.wrong_count ?? entry.wrongCount ?? 0) || 0,
              stability,
              difficulty,
              relatedKnownWordsJson,
              updatedAt,
              entry.deleted_at ?? entry.deletedAt ?? null,
              language,
              result.rows.item(0).id,
            ],
            () => resolve(true),
            (_, updateError) => {
              console.error(`[Database] Error updating cloud vocab row "${word}":`, updateError);
              reject(updateError);
              return false;
            }
          );
        },
        (_, selectError) => {
          console.error(`[Database] Error finding cloud vocab row "${word}":`, selectError);
          reject(selectError);
          return false;
        }
      );
    });
  });
};

const parseRelatedKnownWords = (value) => {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const cleanValue = (value) => (typeof value === 'string' ? value.trim() : '');
const isMasteredLevel = (level) => cleanValue(level).toLowerCase() === 'good';

const resolveNullable = (value) => {
  const cleaned = cleanValue(value);
  return cleaned || null;
};

const relatedKnownWordKey = (entry) => `${entry?.korean ?? ''}|${entry?.hanja ?? ''}`;
const nowIso = () => new Date().toISOString();

const upsertContextForVocabRow = (tx, row, {
  ownerId = row?.owner_id ?? GUEST_OWNER_ID,
  profileId = row?.profile_id ?? null,
  sentence,
  sourceBookUri = null,
  sourceBookTitle = null,
  seenAt = new Date().toISOString(),
  language = row?.language ?? 'ko',
  updatedAt = nowIso(),
}, resolve, reject) => {
  const cleanedSentence = cleanValue(sentence);
  if (!row?.id || !cleanedSentence) {
    resolve(false);
    return;
  }

  const normalizedSourceUri = resolveNullable(sourceBookUri);
  const normalizedSourceTitle = resolveNullable(sourceBookTitle);
  const normalizedLanguage = language || row?.language || 'ko';
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scopedProfileId = resolveProfileId(profileId ?? row?.profile_id ?? row, normalizedLanguage);
  const definitionKey = row.def_key ?? makeVocabDefinitionKey(row.def);
  const buildContextRow = (id) => ({
    id,
    owner_id: scopedOwnerId,
    ownerId: scopedOwnerId,
    profile_id: scopedProfileId,
    profileId: scopedProfileId,
    vocab_id: row.id,
    word: row.word,
    hanja: normalizeHanjaForStorage(row.hanja),
    def: row.def ?? null,
    definition: row.def ?? null,
    def_key: definitionKey,
    source_book_uri: normalizedSourceUri,
    source_book_title: normalizedSourceTitle,
    sentence: cleanedSentence,
    seen_at: seenAt,
    updated_at: updatedAt,
    deleted_at: null,
    language: normalizedLanguage,
  });

  tx.executeSql(
    `SELECT id
     FROM vocab_contexts
     WHERE owner_id = ?
       AND profile_id = ?
       AND language = ?
       AND word = ?
       AND COALESCE(hanja, '') = COALESCE(?, '')
       AND def_key IS ?
       AND sentence = ?
       AND COALESCE(source_book_uri, '') = COALESCE(?, '')
       AND deleted_at IS NULL
     ORDER BY id ASC
     LIMIT 1`,
    [
      scopedOwnerId,
      scopedProfileId,
      normalizedLanguage,
      row.word,
      normalizeHanjaForStorage(row.hanja),
      definitionKey,
      cleanedSentence,
      normalizedSourceUri,
    ],
    (_, existingResult) => {
      if (existingResult.rows.length > 0) {
        const contextId = existingResult.rows.item(0).id;
        tx.executeSql(
          `UPDATE vocab_contexts
           SET vocab_id = ?,
               profile_id = ?,
               seen_at = ?,
               updated_at = ?,
               def_key = ?,
               source_book_title = COALESCE(?, source_book_title),
               language = ?
           WHERE id = ?`,
          [row.id, scopedProfileId, seenAt, updatedAt, definitionKey, normalizedSourceTitle, normalizedLanguage, contextId],
          () => resolve(buildContextRow(contextId)),
          (_, updateError) => {
            console.error('[Database] Error updating vocab context:', updateError);
            reject(updateError);
            return false;
          }
        );
        return;
      }

      tx.executeSql(
        `INSERT INTO vocab_contexts (
          owner_id, profile_id, vocab_id, word, hanja, def, def_key, source_book_uri, source_book_title, sentence,
          seen_at, language, updated_at, deleted_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          scopedOwnerId,
          scopedProfileId,
          row.id,
          row.word,
          normalizeHanjaForStorage(row.hanja),
          row.def ?? null,
          definitionKey,
          normalizedSourceUri,
          normalizedSourceTitle,
          cleanedSentence,
          seenAt,
          normalizedLanguage,
          updatedAt,
          null,
        ],
        (_, insertResult) => resolve(buildContextRow(insertResult.insertId)),
        (_, insertError) => {
          console.error('[Database] Error inserting vocab context:', insertError);
          reject(insertError);
          return false;
        }
      );
    },
    (_, selectError) => {
      console.error('[Database] Error checking vocab context:', selectError);
      reject(selectError);
      return false;
    }
  );
};

export const recordVocabContext = ({
  word,
  hanja = null,
  definition = null,
  sentence = '',
  sourceBookUri = null,
  sourceBookTitle = null,
  seenAt = new Date().toISOString(),
  language = 'ko',
  force = false,
  ownerId = GUEST_OWNER_ID,
  profileId = null,
}) => {
  const cleanedWord = cleanValue(word);
  const cleanedSentence = cleanValue(sentence);
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scopedProfileId = resolveProfileId(profileId, language);
  const definitionKey = makeVocabDefinitionKey(definition);

  return new Promise((resolve, reject) => {
    if (!cleanedWord || !cleanedSentence) {
      resolve(false);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, owner_id, profile_id, word, hanja, def, def_key, level, language
         FROM vocab
         WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL
         ORDER BY id ASC
         LIMIT 1`,
        [scopedOwnerId, scopedProfileId, cleanedWord, hanja ?? null, definitionKey, language],
        (_, result) => {
          if (result.rows.length === 0) {
            resolve(false);
            return;
          }

          const row = result.rows.item(0);
          if (!force && isMasteredLevel(row.level)) {
            resolve(false);
            return;
          }

          upsertContextForVocabRow(tx, row, {
            sentence: cleanedSentence,
            sourceBookUri,
            sourceBookTitle,
            seenAt,
            language,
            ownerId: scopedOwnerId,
            profileId: scopedProfileId,
          }, resolve, reject);
        },
        (_, error) => {
          console.error(`[Database] Error finding vocab row for context "${cleanedWord}":`, error);
          reject(error);
          return false;
        }
      );
    });
  });
};

export const recordVocabContextForSurface = ({
  surface,
  sentence = '',
  sourceBookUri = null,
  sourceBookTitle = null,
  seenAt = new Date().toISOString(),
  language = 'ko',
  ownerId = GUEST_OWNER_ID,
}) => {
  const cleanedSurface = cleanValue(surface);
  const cleanedSentence = cleanValue(sentence);
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scopedProfileId = resolveProfileId(null, language);

  return new Promise((resolve, reject) => {
    if (!cleanedSurface || !cleanedSentence) {
      resolve(false);
      return;
    }

    db.transaction(tx => {
      const recordFirstAvailableRow = (rows) => {
        const row = rows.find((candidate) => !isMasteredLevel(candidate.level));
        if (!row) {
          resolve(false);
          return;
        }

        upsertContextForVocabRow(tx, row, {
          sentence: cleanedSentence,
            sourceBookUri,
            sourceBookTitle,
            seenAt,
            language,
          }, resolve, reject);
      };

      tx.executeSql(
        `SELECT id, owner_id, profile_id, word, hanja, def, def_key, level, language
         FROM vocab
         WHERE owner_id = ? AND profile_id = ? AND word = ? AND language = ? AND deleted_at IS NULL
         ORDER BY id ASC`,
        [scopedOwnerId, scopedProfileId, cleanedSurface, language],
        (_, exactResult) => {
          const exactRows = exactResult.rows._array ?? [];
          if (exactRows.length > 0) {
            recordFirstAvailableRow(exactRows);
            return;
          }

          if (!sourceBookUri) {
            resolve(false);
            return;
          }

          tx.executeSql(
            `SELECT v.id, v.owner_id, v.profile_id, v.word, v.hanja, v.def, v.level, v.language
             FROM book_index bi
             JOIN dictionary_cache dc ON dc.id = bi.stem_id
             JOIN vocab v ON v.word = dc.stem
             WHERE bi.owner_id = ?
               AND bi.profile_id = ?
               AND v.owner_id = ?
               AND v.profile_id = ?
               AND bi.book_uri = ?
               AND bi.surface = ?
               AND dc.language = ?
               AND v.language = ?
               AND v.deleted_at IS NULL
             ORDER BY v.id ASC`,
            [scopedOwnerId, scopedProfileId, scopedOwnerId, scopedProfileId, sourceBookUri, cleanedSurface, language, language],
            (_, indexResult) => {
              recordFirstAvailableRow(indexResult.rows._array ?? []);
            },
            (_, indexError) => {
              console.error(`[Database] Error resolving context surface "${cleanedSurface}":`, indexError);
              reject(indexError);
              return false;
            }
          );
        },
        (_, exactError) => {
          console.error(`[Database] Error finding context surface "${cleanedSurface}":`, exactError);
          reject(exactError);
          return false;
        }
      );
    });
  });
};

export const getVocabContexts = (word, hanja, definition, limit = 12, language = 'ko', options = {}) => {
  const cleanedWord = cleanValue(word);
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language);
  const definitionKey = makeVocabDefinitionKey(definition);

  return new Promise((resolve, reject) => {
    if (!cleanedWord) {
      resolve([]);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT id
         FROM vocab
         WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL
         ORDER BY id ASC
         LIMIT 1`,
        [ownerId, profileId, cleanedWord, hanja ?? null, definitionKey, language],
        (_, vocabResult) => {
          if (vocabResult.rows.length === 0) {
            resolve([]);
            return;
          }

          const vocabRow = vocabResult.rows.item(0);
          tx.executeSql(
            `SELECT sentence, source_book_uri, source_book_title, seen_at
             FROM vocab_contexts
             WHERE owner_id = ? AND profile_id = ? AND vocab_id = ? AND language = ? AND deleted_at IS NULL
             ORDER BY datetime(seen_at) DESC, id DESC
             LIMIT ?`,
            [ownerId, profileId, vocabRow.id, language, limit],
            (_, contextResult) => {
              const rows = contextResult.rows._array ?? [];
              const contexts = rows.map((row) => ({
                sentence: row.sentence,
                sourceBookUri: row.source_book_uri,
                sourceBookTitle: row.source_book_title,
                seenAt: row.seen_at,
              }));

              resolve(contexts);
            },
            (_, contextError) => {
              console.error(`[Database] Error reading contexts for "${cleanedWord}":`, contextError);
              reject(contextError);
              return false;
            }
          );
        },
        (_, vocabError) => {
          console.error(`[Database] Error reading vocab row for contexts "${cleanedWord}":`, vocabError);
          reject(vocabError);
          return false;
        }
      );
    });
  });
};

export const getAllVocabContexts = (options = {}) => {
  const { includeDeleted = false, updatedAfter = null } = options;
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, options.language ?? 'ko');

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      const whereClauses = ['owner_id = ?', 'profile_id = ?'];
      const params = [ownerId, profileId];

      if (!includeDeleted) {
        whereClauses.push('deleted_at IS NULL');
      }

      if (options.language != null) {
        whereClauses.push('language = ?');
        params.push(options.language);
      }

      if (updatedAfter) {
        whereClauses.push('updated_at IS NOT NULL AND julianday(updated_at) > julianday(?)');
        params.push(updatedAfter);
      }

      tx.executeSql(
        `SELECT id, vocab_id, word, hanja, def, source_book_uri, source_book_title,
                sentence, seen_at, language, updated_at, deleted_at
         FROM vocab_contexts
         WHERE ${whereClauses.join(' AND ')}
         ORDER BY datetime(seen_at) DESC, id DESC`,
        params,
        (_, result) => resolve(result.rows._array ?? []),
        (_, error) => {
          console.error('[Database] Error reading all vocab contexts:', error);
          reject(error);
          return false;
        }
      );
    });
  });
};

export const insertVocabContextIfMissing = (context, options = {}) => {
  const cleanedWord = cleanValue(context?.word);
  const cleanedSentence = cleanValue(context?.sentence);
  const language = context?.language ?? 'ko';
  const definition = context?.def ?? context?.definition ?? null;
  const definitionKey = makeVocabDefinitionKey(definition);
  const hanja = context?.hanja ?? null;
  const seenAt = context?.seen_at ?? context?.seenAt ?? new Date().toISOString();
  const updatedAt = context?.updated_at ?? context?.updatedAt ?? seenAt;
  const ownerId = resolveOwnerId(options.ownerId ?? context?.owner_id ?? context?.ownerId);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? context?.profile_id ?? context?.profileId ?? options, language);

  return new Promise((resolve, reject) => {
    if (!cleanedWord || !cleanedSentence || context?.deleted_at || context?.deletedAt) {
      resolve(false);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, owner_id, profile_id, word, hanja, def, def_key, level, language
         FROM vocab
         WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL
         ORDER BY id ASC
         LIMIT 1`,
        [ownerId, profileId, cleanedWord, hanja, definitionKey, language],
        (_, result) => {
          if (result.rows.length === 0) {
            resolve(false);
            return;
          }

          upsertContextForVocabRow(tx, result.rows.item(0), {
            sentence: cleanedSentence,
            sourceBookUri: context.source_book_uri ?? context.sourceBookUri ?? null,
            sourceBookTitle: context.source_book_title ?? context.sourceBookTitle ?? null,
            seenAt,
            updatedAt,
            language,
            ownerId,
            profileId,
          }, resolve, reject);
        },
        (_, error) => {
          console.error(`[Database] Error finding vocab row for cloud context "${cleanedWord}":`, error);
          reject(error);
          return false;
        }
      );
    });
  });
};

export const softDeleteVocabContextsForWord = (word, hanja, definition, language = 'ko', options = {}) => {
  const deletedAt = nowIso();
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language);
  const definitionKey = makeVocabDefinitionKey(definition);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE vocab_contexts
         SET deleted_at = ?, updated_at = ?
         WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL`,
        [deletedAt, deletedAt, ownerId, profileId, word, hanja ?? null, definitionKey, language],
        (_, result) => resolve(result.rowsAffected ?? 0),
        (_, error) => {
          console.error(`[Database] Error soft-deleting vocab contexts for "${word}":`, error);
          reject(error);
          return false;
        }
      );
    });
  });
};

/**
 * Soft-delete the one example sentence that matches `context` exactly (word,
 * hanja, definition, sentence and source book). Used to apply a single cloud
 * context tombstone; never touches the word's other sentences. Resolves with the
 * number of rows deleted (0 when nothing matches).
 */
export const softDeleteVocabContext = (context, options = {}) => {
  const word = cleanValue(context?.word);
  const language = context?.language ?? 'ko';
  const hanja = normalizeHanjaForStorage(context?.hanja);
  const definitionKey = makeVocabDefinitionKey(context?.def ?? context?.definition ?? null);
  const sentenceKey = normalizeIdentityText(context?.sentence);
  const sourceUriKey = normalizeIdentityText(context?.source_book_uri ?? context?.sourceBookUri);
  const deletedAt = context?.deleted_at ?? context?.deletedAt ?? nowIso();
  const ownerId = resolveOwnerId(options.ownerId ?? options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language);

  return new Promise((resolve, reject) => {
    if (!word || !sentenceKey) {
      resolve(0);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, sentence, source_book_uri
         FROM vocab_contexts
         WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL`,
        [ownerId, profileId, word, hanja, definitionKey, language],
        (_, result) => {
          // Compare sentence and source with the same normalization the cloud
          // key uses (NFKC, collapsed whitespace), so a stored sentence matches
          // its cloud copy even if spacing differs.
          const matches = (result.rows._array ?? []).filter((row) => (
            normalizeIdentityText(row.sentence) === sentenceKey
            && normalizeIdentityText(row.source_book_uri) === sourceUriKey
          ));

          if (matches.length === 0) {
            resolve(0);
            return;
          }

          matches.forEach((row) => {
            tx.executeSql(
              'UPDATE vocab_contexts SET deleted_at = ?, updated_at = ? WHERE id = ?',
              [deletedAt, deletedAt, row.id]
            );
          });
          resolve(matches.length);
        },
        (_, error) => {
          console.error(`[Database] Error soft-deleting vocab context for "${word}":`, error);
          reject(error);
          return true;
        }
      );
    });
  });
};

export const getRelatedKnownWords = (word, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT related_known_words
         FROM vocab
         WHERE owner_id = ? AND profile_id = ? AND word = ? AND language = ? AND deleted_at IS NULL
         ORDER BY id ASC
         LIMIT 1`,
        [ownerId, profileId, word, language],
        (_, result) => {
          const row = result.rows.length > 0 ? result.rows.item(0) : null;
          resolve(parseRelatedKnownWords(row?.related_known_words));
        },
        (_, error) => {
          console.error(`[Database] Error reading related known words for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const addRelatedKnownWord = (word, relatedWord, options = {}) => {
  const markedAt = relatedWord?.markedAt ?? new Date().toISOString();
  const normalizedEntry = {
    korean: relatedWord?.korean ?? '',
    hanja: relatedWord?.hanja ?? '',
    meaning: relatedWord?.meaning ?? '',
    sourceHanja: relatedWord?.sourceHanja ?? '',
    markedAt,
    updatedAt: relatedWord?.updatedAt ?? markedAt,
  };
  const {
    createIfMissing = false,
    mainWord = {},
    language = mainWord.language ?? 'ko',
    ownerId = GUEST_OWNER_ID,
  } = options;
  const scopedOwnerId = resolveOwnerId(ownerId);
  const shouldScopeToEntry = (
    Object.prototype.hasOwnProperty.call(options, 'mainHanja')
    || Object.prototype.hasOwnProperty.call(options, 'mainDefinition')
    || Object.prototype.hasOwnProperty.call(mainWord, 'hanja')
    || Object.prototype.hasOwnProperty.call(mainWord, 'definition')
  );
  const mainHanja = options.mainHanja ?? mainWord.hanja ?? null;
  const mainDefinition = options.mainDefinition ?? mainWord.definition ?? null;
  const mainDefinitionKey = makeVocabDefinitionKey(mainDefinition);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language);

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        shouldScopeToEntry
          ? `SELECT id, related_known_words, related_known_words_deleted
             FROM vocab
             WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL`
          : 'SELECT id, related_known_words, related_known_words_deleted FROM vocab WHERE owner_id = ? AND profile_id = ? AND word = ? AND language = ? AND deleted_at IS NULL',
        shouldScopeToEntry
          ? [scopedOwnerId, profileId, word, mainHanja, mainDefinitionKey, language]
          : [scopedOwnerId, profileId, word, language],
        (_, result) => {
          if (result.rows.length === 0) {
            if (!createIfMissing) {
              resolve([]);
              return;
            }

            const relatedKnownWordsJson = JSON.stringify([normalizedEntry]);
            tx.executeSql(
              `INSERT INTO vocab (
                owner_id, profile_id, word, hanja, def, def_key, level, source_book_uri, source_book_title, is_favorite,
                priority, created_at, last_reviewed_at, next_review_at, correct_count, wrong_count,
                stability, difficulty, related_known_words, updated_at, deleted_at, language
              )
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                scopedOwnerId,
                profileId,
                word,
                normalizeHanjaForStorage(mainWord.hanja),
                mainWord.definition ?? null,
                makeVocabDefinitionKey(mainWord.definition),
                mainWord.level ?? 'unorganized',
                mainWord.sourceBookUri ?? null,
                mainWord.sourceBookTitle ?? null,
                mainWord.isFavorite ? 1 : 0,
                mainWord.priority ?? 'normal',
                mainWord.createdAt ?? new Date().toISOString(),
                mainWord.lastReviewedAt ?? null,
                mainWord.nextReviewAt ?? null,
                mainWord.correctCount ?? 0,
                mainWord.wrongCount ?? 0,
                normalizeFsrsValue(mainWord.stability, DEFAULT_STABILITY),
                normalizeFsrsValue(mainWord.difficulty, DEFAULT_DIFFICULTY, 1, 10),
                relatedKnownWordsJson,
                mainWord.updatedAt ?? nowIso(),
                mainWord.deletedAt ?? null,
                language,
              ],
              () => resolve([normalizedEntry]),
              (_, insertError) => {
                console.error(`[Database] Error auto-saving vocab word "${word}" for related known word:`, insertError);
                reject(insertError);
                return false;
              }
            );
            return;
          }

          const firstKnownWords = parseRelatedKnownWords(result.rows.item(0).related_known_words);
          const normalizedKey = relatedKnownWordKey(normalizedEntry);
          const existingIndex = firstKnownWords.findIndex((entry) => relatedKnownWordKey(entry) === normalizedKey);
          const nextKnownWords = existingIndex >= 0
            ? firstKnownWords.map((entry, index) => (
                index === existingIndex ? { ...entry, ...normalizedEntry } : entry
              ))
            : [...firstKnownWords, normalizedEntry];
          const nextJson = JSON.stringify(nextKnownWords);
          // Re-marking clears any un-mark tombstone for the same word.
          const nextTombstonesJson = JSON.stringify(
            parseRelatedKnownWords(result.rows.item(0).related_known_words_deleted)
              .filter((entry) => relatedKnownWordKey(entry) !== normalizedKey)
          );

          for (let index = 0; index < result.rows.length; index += 1) {
            tx.executeSql(
              'UPDATE vocab SET related_known_words = ?, related_known_words_deleted = ?, updated_at = ? WHERE id = ?',
              [nextJson, nextTombstonesJson, nowIso(), result.rows.item(index).id]
            );
          }

          resolve(nextKnownWords);
        },
        (_, error) => {
          console.error(`[Database] Error adding related known word for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const removeRelatedKnownWord = (word, relatedWord, language = 'ko', options = {}) => {
  const keyToRemove = relatedKnownWordKey(relatedWord);
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language);
  const shouldScopeToEntry = (
    Object.prototype.hasOwnProperty.call(options, 'mainHanja')
    || Object.prototype.hasOwnProperty.call(options, 'mainDefinition')
  );
  const mainHanja = options.mainHanja ?? null;
  const mainDefinition = options.mainDefinition ?? null;
  const mainDefinitionKey = makeVocabDefinitionKey(mainDefinition);
  const deletedAt = options.deletedAt ?? nowIso();

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        shouldScopeToEntry
          ? `SELECT id, related_known_words, related_known_words_deleted
             FROM vocab
             WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL`
          : 'SELECT id, related_known_words, related_known_words_deleted FROM vocab WHERE owner_id = ? AND profile_id = ? AND word = ? AND language = ? AND deleted_at IS NULL',
        shouldScopeToEntry
          ? [ownerId, profileId, word, mainHanja, mainDefinitionKey, language]
          : [ownerId, profileId, word, language],
        (_, result) => {
          if (result.rows.length === 0) {
            resolve([]);
            return;
          }

          const firstKnownWords = parseRelatedKnownWords(result.rows.item(0).related_known_words);
          const nextKnownWords = firstKnownWords.filter(
            (entry) => relatedKnownWordKey(entry) !== keyToRemove
          );
          const nextJson = JSON.stringify(nextKnownWords);
          // Record a tombstone so the next full sync pushes the un-mark to the
          // cloud instead of pulling the cloud's live copy back in.
          const nextTombstones = [
            ...parseRelatedKnownWords(result.rows.item(0).related_known_words_deleted)
              .filter((entry) => relatedKnownWordKey(entry) !== keyToRemove),
            {
              korean: relatedWord?.korean ?? '',
              hanja: relatedWord?.hanja ?? '',
              deletedAt,
              updatedAt: deletedAt,
            },
          ];
          const nextTombstonesJson = JSON.stringify(nextTombstones);

          for (let index = 0; index < result.rows.length; index += 1) {
            tx.executeSql(
              'UPDATE vocab SET related_known_words = ?, related_known_words_deleted = ?, updated_at = ? WHERE id = ?',
              [nextJson, nextTombstonesJson, nowIso(), result.rows.item(index).id]
            );
          }

          resolve(nextKnownWords);
        },
        (_, error) => {
          console.error(`[Database] Error removing related known word for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

/**
 * Flatten every saved word's related known words into relation rows. With
 * `includeDeleted`, un-mark tombstones are included too, as relations carrying
 * `deletedAt` (sync uses them so an un-mark isn't resurrected by the cloud).
 * `language` optionally narrows to one language.
 */
export const getAllRelatedKnownWords = (options = {}) => {
  const { updatedAfter = null, includeDeleted = false, language = null } = options;
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language ?? 'ko');

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      const hasLiveClause = "(related_known_words IS NOT NULL AND related_known_words != '' AND related_known_words != '[]')";
      const hasTombstoneClause = "(related_known_words_deleted IS NOT NULL AND related_known_words_deleted != '' AND related_known_words_deleted != '[]')";
      const whereClauses = [
        'owner_id = ?',
        'profile_id = ?',
        includeDeleted ? `(${hasLiveClause} OR ${hasTombstoneClause})` : hasLiveClause,
        'deleted_at IS NULL',
      ];
      const params = [ownerId, profileId];

      if (language != null) {
        whereClauses.push('language = ?');
        params.push(language);
      }

      if (updatedAfter) {
        whereClauses.push('updated_at IS NOT NULL AND julianday(updated_at) > julianday(?)');
        params.push(updatedAfter);
      }

      tx.executeSql(
        `SELECT word, hanja, def, related_known_words, related_known_words_deleted, language, updated_at
         FROM vocab
         WHERE ${whereClauses.join(' AND ')}`,
        params,
        (_, result) => {
          const relations = [];
          const rows = result.rows._array ?? [];

          rows.forEach((row) => {
            if (includeDeleted) {
              parseRelatedKnownWords(row.related_known_words_deleted).forEach((entry) => {
                const relatedWord = cleanValue(entry?.korean);
                if (!relatedWord || !entry?.deletedAt) {
                  return;
                }

                relations.push({
                  language: row.language ?? 'ko',
                  mainWord: row.word,
                  mainHanja: normalizeHanjaForStorage(row.hanja),
                  mainDefinition: row.def ?? null,
                  relatedWord,
                  relatedHanja: entry?.hanja ?? null,
                  relatedDefinition: null,
                  sourceHanja: null,
                  markedAt: entry.deletedAt,
                  updatedAt: entry.updatedAt ?? entry.deletedAt,
                  deletedAt: entry.deletedAt,
                });
              });
            }

            parseRelatedKnownWords(row.related_known_words).forEach((entry) => {
              const relatedWord = cleanValue(entry?.korean);
              if (!relatedWord) {
                return;
              }

              const markedAt = entry?.markedAt ?? row.updated_at ?? new Date().toISOString();
              relations.push({
                language: row.language ?? 'ko',
                mainWord: row.word,
                mainHanja: normalizeHanjaForStorage(row.hanja),
                mainDefinition: row.def ?? null,
                relatedWord,
                relatedHanja: entry?.hanja ?? null,
                relatedDefinition: entry?.meaning ?? null,
                sourceHanja: entry?.sourceHanja ?? null,
                markedAt,
                updatedAt: entry?.updatedAt ?? markedAt,
              });
            });
          });

          resolve(relations);
        },
        (_, error) => {
          console.error('[Database] Error reading all related known words:', error);
          reject(error);
          return false;
        }
      );
    });
  });
};

export const addRelatedKnownWordForEntry = ({
  mainWord,
  mainHanja = null,
  mainDefinition = null,
  relatedWord,
  relatedHanja = null,
  relatedDefinition = null,
  sourceHanja = null,
  markedAt = new Date().toISOString(),
  updatedAt = markedAt,
  language = 'ko',
  ownerId = GUEST_OWNER_ID,
  profileId = null,
}) => {
  if (!mainWord || !relatedWord) {
    return Promise.resolve([]);
  }

  return addRelatedKnownWord(
    mainWord,
    {
      korean: relatedWord,
      hanja: relatedHanja,
      meaning: relatedDefinition,
      sourceHanja,
      markedAt,
      updatedAt,
    },
    {
      createIfMissing: true,
      ownerId,
      ...(profileId ? { profileId } : {}),
      language,
      mainWord: {
        hanja: mainHanja,
        definition: mainDefinition,
        level: 'unorganized',
        language,
        createdAt: markedAt,
        updatedAt,
      },
    }
  );
};

export const removeRelatedKnownWordForEntry = ({
  mainWord,
  mainHanja = null,
  mainDefinition = null,
  relatedWord,
  relatedHanja = null,
  language = 'ko',
  ownerId = GUEST_OWNER_ID,
  profileId = null,
  deletedAt = null,
}) => {
  if (!mainWord || !relatedWord) {
    return Promise.resolve([]);
  }

  return removeRelatedKnownWord(
    mainWord,
    {
      korean: relatedWord,
      hanja: relatedHanja,
    },
    language,
    {
      ownerId,
      ...(profileId ? { profileId } : {}),
      ...(deletedAt ? { deletedAt } : {}),
      mainHanja,
      mainDefinition,
    }
  );
};

export const updateLevel = (word, hanja, definition, newLevel, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language);
  const definitionKey = makeVocabDefinitionKey(definition);

  return new Promise((resolve, reject) => {
    const updatedAt = nowIso();
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE vocab
         SET level = ?, updated_at = ?
         WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL`,
        [newLevel, updatedAt, ownerId, profileId, word, hanja, definitionKey, language],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error updating level for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const updateFavorite = (word, hanja, definition, isFavorite, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language);
  const definitionKey = makeVocabDefinitionKey(definition);

  return new Promise((resolve, reject) => {
    const updatedAt = nowIso();
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE vocab
         SET is_favorite = ?, updated_at = ?
         WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL`,
        [isFavorite ? 1 : 0, updatedAt, ownerId, profileId, word, hanja, definitionKey, language],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error updating favorite for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const updatePriority = (word, hanja, definition, priority, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language);
  const definitionKey = makeVocabDefinitionKey(definition);

  return new Promise((resolve, reject) => {
    const updatedAt = nowIso();
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE vocab
         SET priority = ?, updated_at = ?
         WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL`,
        [priority, updatedAt, ownerId, profileId, word, hanja, definitionKey, language],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error updating priority for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

const MS_PER_DAY = 86_400_000;

const addDays = (days) => {
  const safeDays = Math.max(0, Number(days) || 0);
  const date = new Date();
  date.setDate(date.getDate() + safeDays);
  return date.toISOString();
};

const forgettingCurve = (stability, days) => (
  Math.pow(1 + days / (9 * normalizeFsrsValue(stability, DEFAULT_STABILITY)), -1)
);

const nextInterval = (stability) => {
  const { requestRetention, maximumInterval } = FSRS_PARAMS;
  const interval = 9 * normalizeFsrsValue(stability, DEFAULT_STABILITY) * ((1 / requestRetention) - 1);
  return Math.min(Math.max(1, Math.round(interval)), maximumInterval);
};

const updateStability = (stability, difficulty, retrievability, grade) => {
  if (grade === 1) {
    return 0.4;
  }

  const currentStability = normalizeFsrsValue(stability, DEFAULT_STABILITY);
  const currentDifficulty = normalizeFsrsValue(difficulty, DEFAULT_DIFFICULTY, 1, 10);
  const next = currentStability * (
    1
    + Math.exp(0.9)
    * (11 - currentDifficulty)
    * Math.pow(currentStability, -0.2)
    * (Math.exp(0.1 * (1 - retrievability)) - 1)
  );

  return normalizeFsrsValue(next, currentStability);
};

const updateDifficulty = (difficulty, grade) => {
  const currentDifficulty = normalizeFsrsValue(difficulty, DEFAULT_DIFFICULTY, 1, 10);
  const delta = -0.72 * (grade - 3);
  const next = currentDifficulty + delta + 0.14 * (DEFAULT_DIFFICULTY - currentDifficulty);
  return Math.min(Math.max(next, 1), 10);
};

export const fsrsSchedule = (wordData = {}, outcome, daysSinceLastReview) => {
  const gradeMap = { bad: 1, mid: 2, good: 3 };
  const grade = gradeMap[outcome];
  if (!grade) {
    return null;
  }

  const currentStability = normalizeFsrsValue(wordData.stability, DEFAULT_STABILITY);
  const currentDifficulty = normalizeFsrsValue(wordData.difficulty, DEFAULT_DIFFICULTY, 1, 10);
  const elapsedDays = Math.max(0, Number(daysSinceLastReview) || 0);
  const retrievability = elapsedDays > 0
    ? forgettingCurve(currentStability, elapsedDays)
    : 1.0;

  const stability = updateStability(currentStability, currentDifficulty, retrievability, grade);
  const difficulty = updateDifficulty(currentDifficulty, grade);
  const interval = grade === 1 ? 1 : nextInterval(stability);

  return {
    stability,
    difficulty,
    interval,
  };
};

export const recordReviewOutcome = (word, hanja, definition, _currentLevel, outcome, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language);
  const definitionKey = makeVocabDefinitionKey(definition);
  const wordData = options.wordData ?? {};
  const lastReviewedAt = wordData.last_reviewed_at ?? wordData.lastReviewedAt;
  const lastReviewedTimestamp = new Date(lastReviewedAt).getTime();
  const daysSinceLastReview = Number.isFinite(lastReviewedTimestamp)
    ? Math.max(0, (Date.now() - lastReviewedTimestamp) / MS_PER_DAY)
    : null;
  const schedule = fsrsSchedule(wordData, outcome, daysSinceLastReview);

  if (!schedule) {
    return Promise.resolve();
  }

  const levelMap = { bad: 'bad', mid: 'mid', good: 'good' };
  const correctInc = outcome !== 'bad' ? 1 : 0;
  const wrongInc = outcome === 'bad' ? 1 : 0;

  // Append the review to the interaction log BEFORE the vocab row's FSRS state is
  // mutated below, so the historical outcome is preserved. This is the only
  // unconfounded label channel (plan invariant #4) — fire-and-forget so a logging
  // failure never blocks or alters the review itself.
  const gradeMap = { bad: 1, mid: 2, good: 3 };
  logInteractionEvent({
    ownerId,
    profileId,
    language,
    word,
    hanja,
    def: definition,
    stem: wordData.stem ?? null,
    eventType: 'review',
    grade: gradeMap[outcome] ?? null,
    outcome: outcome === 'bad' ? 0 : 1,
    vocabId: wordData.id ?? options.vocabId ?? null,
    sourceBookUri: options.sourceBookUri ?? null,
    sentence: options.sentence ?? null,
  }).catch((error) => {
    console.warn('[Database] Failed to log review interaction event:', error);
  });

  // Phase 3.1: nudge the profile's ability from this graded outcome (the clean,
  // unconfounded channel). Fire-and-forget for the same reason as the event log —
  // theta is a derived signal; a failed update must never break the review.
  updateThetaFromOutcome({
    ownerId,
    profileId,
    language,
    stem: wordData.stem ?? word,
    outcome: outcome === 'bad' ? 0 : 1,
    signal: 'review',
    sourceBookUri: options.sourceBookUri ?? null,
  }).catch((error) => {
    console.warn('[Database] Failed to update theta from review:', error);
  });

  return new Promise((resolve, reject) => {
    const reviewedAt = nowIso();
    const nextReviewAt = addDays(schedule.interval);
    db.transaction(tx => {
      tx.executeSql(
        `UPDATE vocab
         SET level = ?,
             last_reviewed_at = ?,
             next_review_at = ?,
             stability = ?,
             difficulty = ?,
             correct_count = COALESCE(correct_count, 0) + ?,
             wrong_count = COALESCE(wrong_count, 0) + ?,
             updated_at = ?
         WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL`,
        [
          levelMap[outcome],
          reviewedAt,
          nextReviewAt,
          schedule.stability,
          schedule.difficulty,
          correctInc,
          wrongInc,
          reviewedAt,
          ownerId,
          profileId,
          word,
          hanja,
          definitionKey,
          language,
        ],
        () => resolve({
          ...schedule,
          nextReviewAt,
          reviewedAt,
        }),
        (_, error) => {
          console.error(`[Database] Error recording review outcome for "${word}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const removeData = (word, hanja, definition, language = 'ko', options = {}) => {
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, language);
  const definitionKey = makeVocabDefinitionKey(definition);

  // All-or-nothing: a failing statement's error callback returns true so the
  // transaction rolls back (returning false would commit the contexts delete
  // while the word itself stayed). Resolve only once the transaction commits.
  return new Promise((resolve, reject) => {
    const deletedAt = nowIso();
    let vocabResult = null;
    db.transaction(
      tx => {
        tx.executeSql(
          `UPDATE vocab_contexts
           SET deleted_at = ?, updated_at = ?
           WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL`,
          [deletedAt, deletedAt, ownerId, profileId, word, hanja, definitionKey, language],
          () => {},
          (_, error) => {
            console.error(`[Database] Error soft-deleting vocab contexts for "${word}":`, error);
            return true;
          }
        );
        tx.executeSql(
          `UPDATE vocab
           SET deleted_at = ?, updated_at = ?
           WHERE owner_id = ? AND profile_id = ? AND word = ? AND COALESCE(hanja, '') = COALESCE(?, '') AND def_key IS ? AND language = ? AND deleted_at IS NULL`,
          [deletedAt, deletedAt, ownerId, profileId, word, hanja, definitionKey, language],
          (_, result) => {
            vocabResult = result;
          },
          (_, error) => {
            console.error(`[Database] Error removing vocab word "${word}":`, error);
            return true;
          }
        );
      },
      (error) => reject(error),
      () => resolve(vocabResult)
    );
  });
};

// ─── Saved-word fading ────────────────────────────────────────────────────────
//
// A saved word's highlight fades each time the reader passes it without looking
// it up; looking it up again restores it. Once it has faded out the word is
// "learned": level 'learned' (cloud status 'learned', so it syncs), out of the
// highlights, the saved lists and the review queue, but kept with its
// definition and history in the Learned list. See services/savedWordFade.js.


/** word → passes since its last lookup, for saved words that have started fading. */
export const getSavedWordFades = async ({ ownerId, profileId, language = 'ko' } = {}) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const rows = await runSelect(
    `SELECT word, MAX(COALESCE(fade_seen, 0)) AS seen FROM vocab
     WHERE owner_id = ? AND profile_id = ? AND language = ? AND deleted_at IS NULL
       AND COALESCE(level, '') != '${LEARNED_LEVEL}' AND COALESCE(fade_seen, 0) > 0
     GROUP BY word`,
    [resolveOwnerId(ownerId), resolveProfileId(profileId, normalizedLanguage), normalizedLanguage]
  );
  return new Map(rows.map((row) => [row.word, Number(row.seen) || 0]));
};

/**
 * recordSavedWordSightings — the reader passed these saved words without
 * looking them up. Each counts once per SAVED_WORD_FADE_GAP_MS; a word that
 * reaches SAVED_WORD_FADE_STEPS becomes learned.
 *
 * @returns {Promise<{faded: Map<string, number>, learned: string[]}>}
 *          the new counts of the words that moved, and the newly learned words
 */
export const recordSavedWordSightings = async ({ ownerId, profileId, language = 'ko', words = [], now = Date.now() } = {}) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scopedProfileId = resolveProfileId(profileId, normalizedLanguage);
  const list = Array.from(new Set((words || []).filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim())));
  const faded = new Map();
  const learned = [];
  if (list.length === 0) return { faded, learned };

  const rows = (await Promise.all(chunkValues(list).map((chunk) => runSelect(
    // A word saved moments ago has no fade_seen_at yet; its save time
    // (updated_at) starts the gap, so it doesn't fade on the very next page or
    // focus sentence.
    `SELECT id, word, COALESCE(fade_seen, 0) AS seen, COALESCE(fade_seen_at, updated_at) AS fade_seen_at FROM vocab
     WHERE owner_id = ? AND profile_id = ? AND language = ? AND deleted_at IS NULL
       AND COALESCE(level, '') != '${LEARNED_LEVEL}' AND word IN (${chunk.map(() => '?').join(', ')})`,
    [scopedOwnerId, scopedProfileId, normalizedLanguage, ...chunk]
  )))).flat();

  const nowIsoValue = new Date(now).toISOString();
  const updates = [];
  rows.forEach((row) => {
    const last = row.fade_seen_at ? new Date(row.fade_seen_at).getTime() : null;
    // Only a recent past mark holds the word back (a clock that moved back
    // must not freeze its fade).
    if (last != null && Number.isFinite(last) && now >= last && now - last < SAVED_WORD_FADE_GAP_MS) return;
    const seen = (Number(row.seen) || 0) + 1;
    updates.push({ id: row.id, seen });
    faded.set(row.word, Math.max(faded.get(row.word) || 0, seen));
    if (seen >= SAVED_WORD_FADE_STEPS && !learned.includes(row.word)) learned.push(row.word);
  });
  if (updates.length === 0) return { faded, learned };

  await new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        updates.forEach(({ id, seen }) => {
          if (seen >= SAVED_WORD_FADE_STEPS) {
            // Learned: the level change bumps updated_at so it syncs.
            tx.executeSql(
              `UPDATE vocab SET fade_seen = ?, fade_seen_at = ?, level = '${LEARNED_LEVEL}', updated_at = ? WHERE id = ?`,
              [seen, nowIsoValue, nowIsoValue, id]
            );
          } else {
            tx.executeSql('UPDATE vocab SET fade_seen = ?, fade_seen_at = ? WHERE id = ?', [seen, nowIsoValue, id]);
          }
        });
      },
      (error) => {
        console.error('[Database] Error recording saved word sightings:', error);
        reject(error);
      },
      () => resolve()
    );
  });
  return { faded, learned };
};

/** The reader looked a saved word up again: its highlight comes back in full. */
export const resetSavedWordFade = ({ ownerId, profileId, language = 'ko', words = [] } = {}) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const list = Array.from(new Set((words || []).filter((w) => typeof w === 'string' && w.trim()).map((w) => w.trim())));
  if (list.length === 0) return Promise.resolve(0);
  return new Promise((resolve, reject) => {
    let changed = 0;
    db.transaction(
      tx => {
        tx.executeSql(
          // Stamped with the lookup's time, so the word doesn't fade again on
          // the very next page (SAVED_WORD_FADE_GAP_MS).
          `UPDATE vocab SET fade_seen = 0, fade_seen_at = ?
           WHERE owner_id = ? AND profile_id = ? AND language = ? AND deleted_at IS NULL
             AND COALESCE(level, '') != '${LEARNED_LEVEL}'
             AND word IN (${list.map(() => '?').join(', ')})`,
          [new Date().toISOString(), resolveOwnerId(ownerId), resolveProfileId(profileId, normalizedLanguage), normalizedLanguage, ...list],
          (_, result) => { changed = result.rowsAffected || 0; }
        );
      },
      (error) => reject(error),
      () => resolve(changed)
    );
  });
};

/** Learned words, newest first, for the Learned list. */
export const getLearnedWords = async ({ ownerId, profileId, language = 'ko' } = {}) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const rows = await runSelect(
    `SELECT id, word, hanja, def, source_book_title, created_at, updated_at FROM vocab
     WHERE owner_id = ? AND profile_id = ? AND language = ? AND deleted_at IS NULL
       AND level = '${LEARNED_LEVEL}'
     ORDER BY updated_at DESC, id DESC`,
    [resolveOwnerId(ownerId), resolveProfileId(profileId, normalizedLanguage), normalizedLanguage]
  );
  return rows.map((row) => ({
    id: row.id,
    word: row.word,
    hanja: row.hanja || '',
    def: row.def || '',
    bookTitle: row.source_book_title || '',
    learnedAt: row.updated_at || null,
  }));
};

/** Move a learned word back to the saved words, highlighted in full again. */
export const restoreLearnedWord = ({ ownerId, profileId, language = 'ko', id } = {}) => {
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  return new Promise((resolve, reject) => {
    db.transaction(
      tx => {
        tx.executeSql(
          `UPDATE vocab SET level = 'unorganized', fade_seen = 0, fade_seen_at = NULL, updated_at = ?
           WHERE id = ? AND owner_id = ? AND profile_id = ? AND language = ? AND level = '${LEARNED_LEVEL}'`,
          [nowIso(), id, resolveOwnerId(ownerId), resolveProfileId(profileId, normalizedLanguage), normalizedLanguage]
        );
      },
      (error) => reject(error),
      () => resolve()
    );
  });
};

export const getSavedWords = (options = {}) => {
  const normalizedOptions = typeof options === 'string' || options === null
    ? { language: options }
    : options;
  const { language = 'ko' } = normalizedOptions ?? {};
  const ownerId = resolveOwnerId(normalizedOptions);
  const profileId = resolveProfileId(normalizedOptions, language ?? 'ko');

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      const sql = language == null
        ? `SELECT DISTINCT word FROM vocab WHERE owner_id = ? AND profile_id = ? AND deleted_at IS NULL AND COALESCE(level, '') != '${LEARNED_LEVEL}'`
        : `SELECT DISTINCT word FROM vocab WHERE owner_id = ? AND profile_id = ? AND language = ? AND deleted_at IS NULL AND COALESCE(level, '') != '${LEARNED_LEVEL}'`;

      tx.executeSql(
        sql,
        language == null ? [ownerId, profileId] : [ownerId, profileId, language],
        (_, result) => {
          const words = result.rows._array.map(row => row.word).filter(Boolean);
          resolve(words);
        },
        (_, error) => {
          console.error('[Database] Error fetching saved words:', error);
          reject(error);
        }
      );
    });
  });
};

export const viewData = (options = {}) => {
  const normalizedOptions = typeof options === 'string' || options === null
    ? { language: options }
    : options;
  const { includeDeleted = false, language = null, updatedAfter = null } = normalizedOptions;
  const ownerId = resolveOwnerId(normalizedOptions);
  const profileId = resolveProfileId(normalizedOptions, language ?? 'ko');

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      const whereClauses = ['owner_id = ?', 'profile_id = ?'];
      const params = [ownerId, profileId];

      if (!includeDeleted) {
        whereClauses.push('deleted_at IS NULL');
      }

      if (language != null) {
        whereClauses.push('language = ?');
        params.push(language);
      }

      if (updatedAfter) {
        whereClauses.push('updated_at IS NOT NULL AND julianday(updated_at) > julianday(?)');
        params.push(updatedAfter);
      }

      tx.executeSql(
        `SELECT v.*,
                (
                  SELECT dc.pos
                  FROM dictionary_cache dc
                  WHERE dc.language = v.language
                    AND dc.stem = v.word
                    AND dc.pos IS NOT NULL
                    AND TRIM(dc.pos) != ''
                    AND (v.hanja IS NULL OR dc.hanja = v.hanja OR dc.hanja IS NULL)
                  ORDER BY dc.id ASC
                  LIMIT 1
                ) AS pos,
                (
                  SELECT dc.ipa
                  FROM dictionary_cache dc
                  WHERE dc.language = v.language
                    AND dc.stem = v.word
                    AND dc.ipa IS NOT NULL
                    AND TRIM(dc.ipa) != ''
                    AND (v.hanja IS NULL OR dc.hanja = v.hanja OR dc.hanja IS NULL)
                  ORDER BY dc.id ASC
                  LIMIT 1
                ) AS ipa
         FROM vocab v
         WHERE ${whereClauses.map((clause) => `v.${clause}`).join(' AND ')}`,
        params,
        (_, result) => {
          const data = result.rows._array;
          resolve(data);
        },
        (_, error) => {
          console.error('[Database] Error fetching vocab data:', error);
          reject(error);
        }
      );
    });
  });
};

export const getDictionaryCacheCount = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        'SELECT COUNT(*) AS count FROM dictionary_cache',
        [],
        (_, result) => {
          resolve(result.rows.item(0).count);
        },
        (_, error) => {
          console.error('[Database] Error fetching dictionary_cache count:', error);
          reject(error);
        }
      );
    });
  });
};

export const getTableSchema = () => {
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `PRAGMA table_info(vocab)`,
        [],
        (_, result) => resolve(result.rows._array),
        (_, error) => {
          console.error(`[Database] Error retrieving vocab schema:`, error);
          reject(error);
        }
      );
    });
  });
};

export const deleteAllDataFromTable = (options = {}) => {
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, options.language ?? 'ko');

  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(`DELETE FROM vocab_contexts WHERE owner_id = ? AND profile_id = ?`, [ownerId, profileId]);
      tx.executeSql(
        `DELETE FROM vocab WHERE owner_id = ? AND profile_id = ?`,
        [ownerId, profileId],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error deleting all vocab data:`, error);
          reject(error);
        }
      );
    });
  });
};


// ─── Dictionary Cache Operations ──────────────────────────────────────────────

/**
 * insertCacheEntries
 * Bulk-insert an array of {stem, definition, hanja, pos, domain?} objects
 * returned by chapter preprocessing or live lookup endpoints.
 * Uses an upsert so translated live lookups can replace stale fallback rows
 * while preprocessing rows with null fields do not wipe existing data.
 *
 * @param {Array<{stem, definition, gloss?, hanja, pos, domain?}>} entries
 */
export const insertCacheEntries = (entries, scopeOrInterfaceLanguage = 'en', options = {}) => {
  const scope = normalizeDictionaryCacheScope(scopeOrInterfaceLanguage, options);

  return new Promise((resolve, reject) => {
    if (!entries || entries.length === 0) {
      return resolve();
    }
    db.transaction(
      tx => {
        entries.forEach((entry) => {
          const {
            stem,
            definition,
            gloss,
            hanja,
            pos,
            domain,
            romanization,
            ipa,
            simplified,
            traditional,
            audio_us,
            audio_uk,
            etymology,
            derived,
            related,
            word_parts,
            wordParts,
            interface_language,
            interfaceLanguage: entryInterfaceLanguage,
            language,
          } = entry;
          const normalizedLanguage = normalizeBookLanguage(language ?? scope.language);
          const normalizedInterfaceLanguage = normalizeInterfaceLanguageCode(
            entryInterfaceLanguage ?? interface_language ?? scope.interfaceLanguage
          );
          const normalizedWordParts = word_parts ?? wordParts;
          const levelMetadata = normalizeDictionaryLevelMetadata(entry);
          tx.executeSql(
            `INSERT INTO dictionary_cache
               (stem, language, interface_language, definition, gloss, hanja, pos, domain, romanization, ipa, simplified, traditional, audio_us, audio_uk, etymology, derived, related, word_parts,
                level_rank, level_label, level_system, level_source, difficulty_rank, difficulty_percentile, zipf, loanword)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(stem, language, interface_language) DO UPDATE SET
               definition = COALESCE(excluded.definition, dictionary_cache.definition),
               gloss = COALESCE(excluded.gloss, dictionary_cache.gloss),
               hanja = COALESCE(excluded.hanja, dictionary_cache.hanja),
               pos = COALESCE(excluded.pos, dictionary_cache.pos),
               domain = COALESCE(excluded.domain, dictionary_cache.domain),
               romanization = COALESCE(excluded.romanization, dictionary_cache.romanization),
               ipa = COALESCE(excluded.ipa, dictionary_cache.ipa),
               simplified = COALESCE(excluded.simplified, dictionary_cache.simplified),
               traditional = COALESCE(excluded.traditional, dictionary_cache.traditional),
               audio_us = COALESCE(excluded.audio_us, dictionary_cache.audio_us),
               audio_uk = COALESCE(excluded.audio_uk, dictionary_cache.audio_uk),
               etymology = COALESCE(excluded.etymology, dictionary_cache.etymology),
               derived = COALESCE(excluded.derived, dictionary_cache.derived),
               related = COALESCE(excluded.related, dictionary_cache.related),
               word_parts = COALESCE(excluded.word_parts, dictionary_cache.word_parts),
               level_rank = COALESCE(excluded.level_rank, dictionary_cache.level_rank),
               level_label = COALESCE(excluded.level_label, dictionary_cache.level_label),
               level_system = COALESCE(excluded.level_system, dictionary_cache.level_system),
               level_source = COALESCE(excluded.level_source, dictionary_cache.level_source),
               difficulty_rank = COALESCE(excluded.difficulty_rank, dictionary_cache.difficulty_rank),
               difficulty_percentile = COALESCE(excluded.difficulty_percentile, dictionary_cache.difficulty_percentile),
               zipf = COALESCE(excluded.zipf, dictionary_cache.zipf),
               loanword = COALESCE(excluded.loanword, dictionary_cache.loanword),
               last_updated = CURRENT_TIMESTAMP`,
            [
              stem,
              normalizedLanguage,
              normalizedInterfaceLanguage,
              definition ?? null,
              gloss ?? null,
              hanja ?? null,
              pos ?? null,
              domain ?? null,
              romanization ?? null,
              ipa ?? null,
              simplified ?? null,
              traditional ?? null,
              audio_us ?? null,
              audio_uk ?? null,
              etymology ?? null,
              Array.isArray(derived) ? JSON.stringify(derived) : (derived ?? null),
              Array.isArray(related) ? JSON.stringify(related) : (related ?? null),
              normalizedWordParts && typeof normalizedWordParts === 'object'
                ? JSON.stringify(normalizedWordParts)
                : (normalizedWordParts ?? null),
              levelMetadata.levelRank,
              levelMetadata.levelLabel,
              levelMetadata.levelSystem,
              levelMetadata.levelSource,
              levelMetadata.difficultyRank,
              levelMetadata.difficultyPercentile,
              levelMetadata.zipf,
              levelMetadata.loanword,
            ]
          );
        });
      },
      (error) => {
        console.error(`[Database] Error bulk-inserting ${entries.length} cache entries:`, error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const updateCacheRomanizations = (entries, scopeOrInterfaceLanguage = 'en', options = {}) => {
  const scope = normalizeDictionaryCacheScope(scopeOrInterfaceLanguage, options);
  const normalizedEntries = (entries || [])
    .map(({ stem, romanization }) => ({
      stem: typeof stem === 'string' ? stem.trim() : '',
      romanization: typeof romanization === 'string' ? romanization.trim() : '',
    }))
    .filter((entry) => entry.stem && entry.romanization);

  return new Promise((resolve, reject) => {
    if (normalizedEntries.length === 0) {
      resolve();
      return;
    }

    db.transaction(
      tx => {
        normalizedEntries.forEach(({ stem, romanization }) => {
          tx.executeSql(
            `UPDATE dictionary_cache
             SET romanization = ?, last_updated = CURRENT_TIMESTAMP
             WHERE language = ? AND interface_language = ? AND stem = ?`,
            [romanization, scope.language, scope.interfaceLanguage, stem]
          );
        });
      },
      (error) => {
        console.error('[Database] Error updating cache romanizations:', error);
        reject(error);
      },
      () => resolve()
    );
  });
};

/**
 * lookupCacheByStems
 * Query dictionary_cache for one or more stems in a single SQL call.
 * Returns matching rows in the same order as the requested stems.
 *
 * This is the "instant lookup" path: called when a user taps a word,
 * before deciding whether a live API call is needed.
 *
 * @param {string[]} stems
 * @returns {Promise<Array<{id, stem, language, interface_language, definition, gloss, hanja, pos, domain}>>}
 */
export const lookupCacheByStems = (stems, scopeOrInterfaceLanguage = 'en', options = {}) => {
  return new Promise((resolve, reject) => {
    if (!stems || stems.length === 0) return resolve([]);
    const placeholders = stems.map(() => '?').join(',');
    const stemOrder = new Map(stems.map((stem, index) => [stem, index]));
    const scope = normalizeDictionaryCacheScope(scopeOrInterfaceLanguage, options);
    db.transaction(tx => {
      tx.executeSql(
        `SELECT id, stem, language, interface_language, definition, gloss, hanja, pos, domain, romanization, ipa, simplified, traditional, audio_us, audio_uk, etymology, derived, related, word_parts,
                level_rank, level_label, level_system, level_source
         FROM dictionary_cache
         WHERE language = ? AND interface_language = ? AND stem IN (${placeholders})`,
        [scope.language, scope.interfaceLanguage, ...stems],
        (_, result) => {
          const rows = [...result.rows._array].sort((a, b) => (
            (stemOrder.get(a.stem) ?? Number.MAX_SAFE_INTEGER)
            - (stemOrder.get(b.stem) ?? Number.MAX_SAFE_INTEGER)
          ));
          resolve(rows);
        },
        (_, error) => {
          console.error('[Database] Error querying dictionary_cache:', error);
          reject(error);
        }
      );
    });
  });
};

/**
 * lookupCacheByStem
 * Single-stem convenience wrapper around lookupCacheByStems.
 * Returns the matching row or null if not cached.
 *
 * @param {string} stem
 * @returns {Promise<{id, stem, language, interface_language, definition, gloss, hanja, pos, domain} | null>}
 */
export const lookupCacheByStem = (stem, scopeOrInterfaceLanguage = 'en', options = {}) => {
  return lookupCacheByStems([stem], scopeOrInterfaceLanguage, options).then(rows => {
    return rows[0] ?? null;
  });
};

export const lookupBookIndexBySurface = (ownerId, bookUri, surface, scopeOrInterfaceLanguage = 'en', options = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scope = normalizeDictionaryCacheScope(scopeOrInterfaceLanguage, options);
  const scopedProfileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, scope.language);

  return new Promise((resolve, reject) => {
    if (!bookUri || !surface) {
      return resolve([]);
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT dc.id, dc.stem, dc.language, dc.interface_language, dc.definition, dc.gloss, dc.hanja, dc.pos,
                dc.domain, dc.romanization, dc.ipa, dc.simplified, dc.traditional, dc.audio_us, dc.audio_uk, dc.etymology, dc.derived, dc.related, dc.word_parts,
                dc.level_rank, dc.level_label, dc.level_system, dc.level_source
         FROM book_index bi
         JOIN dictionary_cache dc ON dc.id = bi.stem_id
         WHERE bi.owner_id = ?
           AND bi.profile_id = ?
           AND bi.book_uri = ?
           AND bi.surface = ?
           AND dc.language = ?
           AND dc.interface_language = ?`,
        [scopedOwnerId, scopedProfileId, bookUri, surface, scope.language, scope.interfaceLanguage],
        (_, result) => {
          resolve(result.rows._array);
        },
        (_, error) => {
          console.error('[Database] Error querying book_index by surface:', error);
          reject(error);
        }
      );
    });
  });
};

/**
 * lookupBookIndexBySurfaceVariants
 * Book-index rows whose stored surface contains `fragment`, with that stored
 * surface returned as `index_surface`. Preprocessing stores whitespace-delimited
 * eojeols, so a sentence-final or quoted word is indexed with its punctuation
 * ("갔다.", "“누워") while the reader taps the bare token ("갔다"). The caller
 * keeps only rows whose surface normalizes to the tapped word. Used only after
 * an exact lookupBookIndexBySurface miss; `fragment` must not contain LIKE
 * wildcards (normalized Hangul never does).
 */
export const lookupBookIndexBySurfaceVariants = (ownerId, bookUri, fragment, scopeOrInterfaceLanguage = 'en', options = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scope = normalizeDictionaryCacheScope(scopeOrInterfaceLanguage, options);
  const scopedProfileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, scope.language);
  const maxExtraChars = Number.isInteger(options.maxExtraChars) ? options.maxExtraChars : 4;

  return new Promise((resolve, reject) => {
    if (!bookUri || !fragment || /[%_\\]/.test(fragment)) {
      resolve([]);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT bi.surface AS index_surface,
                dc.id, dc.stem, dc.language, dc.interface_language, dc.definition, dc.gloss, dc.hanja, dc.pos,
                dc.domain, dc.romanization, dc.ipa, dc.simplified, dc.traditional, dc.audio_us, dc.audio_uk, dc.etymology, dc.derived, dc.related, dc.word_parts,
                dc.level_rank, dc.level_label, dc.level_system, dc.level_source
         FROM book_index bi
         JOIN dictionary_cache dc ON dc.id = bi.stem_id
         WHERE bi.owner_id = ?
           AND bi.profile_id = ?
           AND bi.book_uri = ?
           AND bi.surface LIKE ?
           AND length(bi.surface) <= ?
           AND dc.language = ?
           AND dc.interface_language = ?`,
        [
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          `%${fragment}%`,
          fragment.length + maxExtraChars,
          scope.language,
          scope.interfaceLanguage,
        ],
        (_, result) => {
          resolve(result.rows._array);
        },
        (_, error) => {
          console.error('[Database] Error querying book_index by surface variants:', error);
          reject(error);
        }
      );
    });
  });
};

export const lookupBookHighlightSurfaces = async (ownerId, bookUri, savedStems, scopeOrInterfaceLanguage = 'en', options = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scope = normalizeDictionaryCacheScope(scopeOrInterfaceLanguage, options);
  const scopedProfileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, scope.language);

  if (!bookUri || !savedStems || savedStems.length === 0) {
    return [];
  }

  const uniqueStems = [...new Set(
    savedStems
      .map((stem) => (typeof stem === 'string' ? stem.trim() : ''))
      .filter(Boolean)
  )];
  if (uniqueStems.length === 0) {
    return [];
  }

  const queryChunk = (stems) => new Promise((resolve, reject) => {
    const placeholders = stems.map(() => '?').join(',');
    db.transaction(tx => {
      tx.executeSql(
        `SELECT DISTINCT bi.surface, dc.stem
         FROM dictionary_cache dc
         JOIN book_index bi ON bi.stem_id = dc.id
         WHERE dc.language = ?
           AND dc.interface_language = ?
           AND dc.stem IN (${placeholders})
           AND bi.owner_id = ?
           AND bi.profile_id = ?
           AND bi.book_uri = ?`,
        [scope.language, scope.interfaceLanguage, ...stems, scopedOwnerId, scopedProfileId, bookUri],
        (_, result) => {
          resolve(result.rows._array);
        },
        (_, error) => {
          console.error('[Database] Error querying highlight surfaces from book_index:', error);
          reject(error);
        }
      );
    });
  });

  const rowsByKey = new Map();
  const chunkRows = await Promise.all(chunkValues(uniqueStems).map(queryChunk));
  chunkRows.flat().forEach((row) => {
    const key = `${row.surface}|${row.stem}`;
    if (!rowsByKey.has(key)) {
      rowsByKey.set(key, row);
    }
  });

  return [...rowsByKey.values()];
};

export const lookupBookLevelSurfaces = (
  ownerId,
  bookUri,
  minimumRank,
  scopeOrInterfaceLanguage = 'en',
  options = {}
) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scope = normalizeDictionaryCacheScope(scopeOrInterfaceLanguage, options);
  const scopedProfileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, scope.language);
  const numericRank = Number(minimumRank);

  return new Promise((resolve, reject) => {
    if (!bookUri || !Number.isFinite(numericRank)) {
      return resolve([]);
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT bi.surface,
                dc.stem,
                dc.level_rank,
                dc.difficulty_percentile,
                dc.zipf,
                dc.loanword,
                dc.level_label,
                dc.level_system,
                dc.level_source,
                dc.ipa,
                COUNT(*) OVER (PARTITION BY dc.stem) AS stem_count
         FROM dictionary_cache dc
         JOIN book_index bi ON bi.stem_id = dc.id
         WHERE dc.language = ?
           AND (dc.level_rank IS NULL OR dc.level_rank >= ?)
           AND bi.owner_id = ?
           AND bi.profile_id = ?
           AND bi.book_uri = ?
           -- Only words the dictionary can explain: a word with no entry (a
           -- name, a jieba compound like 看着, a stem KRDICT does not
           -- know) would be underlined as hardest and open an empty
           -- panel. Any interface language counts; the tap looks it up live.
           AND EXISTS (
             SELECT 1 FROM dictionary_cache d2
             WHERE d2.language = dc.language
               AND d2.stem = dc.stem
               AND (TRIM(COALESCE(d2.definition, '')) != '' OR TRIM(COALESCE(d2.gloss, '')) != '')
           )
           -- English names (Dickens, London) can be tapped but are not graded.
           AND COALESCE(dc.pos, '') != 'name'
           -- Nor through another word: a name that once opened a sentence
           -- was also indexed as a common noun ("Rachel" -> rachel), and that
           -- entry must not underline the name.
           AND NOT EXISTS (
             SELECT 1 FROM book_index bn
             JOIN dictionary_cache dn ON dn.id = bn.stem_id
             WHERE bn.owner_id = bi.owner_id
               AND bn.profile_id = bi.profile_id
               AND bn.book_uri = bi.book_uri
               AND bn.surface = bi.surface
               AND dn.pos = 'name'
           )
         ORDER BY LENGTH(bi.surface) DESC, bi.surface ASC`,
        [scope.language, numericRank, scopedOwnerId, scopedProfileId, bookUri],
        (_, result) => {
          resolve(result.rows._array);
        },
        (_, error) => {
          console.error('[Database] Error querying level surfaces from book_index:', error);
          reject(error);
        }
      );
    });
  });
};

// Every word surface in the book with its reading (dc.ipa: pinyin for Chinese),
// short gloss and definition, for the reader's pinyin / translation annotations. A surface
// can have rows in several interface languages; the caller picks one.
export const lookupBookAnnotationSurfaces = (
  ownerId,
  bookUri,
  scopeOrInterfaceLanguage = 'en',
  options = {}
) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scope = normalizeDictionaryCacheScope(scopeOrInterfaceLanguage, options);
  const scopedProfileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, scope.language);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      return resolve([]);
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT DISTINCT bi.surface,
                dc.stem,
                dc.ipa,
                dc.gloss,
                dc.definition,
                dc.interface_language,
                dc.language
         FROM dictionary_cache dc
         JOIN book_index bi ON bi.stem_id = dc.id
         WHERE dc.language = ?
           AND bi.owner_id = ?
           AND bi.profile_id = ?
           AND bi.book_uri = ?`,
        [scope.language, scopedOwnerId, scopedProfileId, bookUri],
        (_, result) => {
          resolve(result.rows._array);
        },
        (_, error) => {
          console.error('[Database] Error querying annotation surfaces from book_index:', error);
          reject(error);
        }
      );
    });
  });
};

// How many of the book's indexed words have dictionary rows in one interface
// language. Zero after a language switch means the book's translations were
// all fetched in another language and should be fetched again.
export const countBookRowsInInterfaceLanguage = (
  ownerId,
  bookUri,
  scopeOrInterfaceLanguage = 'en',
  options = {}
) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scope = normalizeDictionaryCacheScope(scopeOrInterfaceLanguage, options);
  const scopedProfileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, scope.language);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      resolve(0);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT COUNT(*) AS n
         FROM dictionary_cache dc
         JOIN book_index bi ON bi.stem_id = dc.id
         WHERE dc.language = ?
           AND dc.interface_language = ?
           AND bi.owner_id = ?
           AND bi.profile_id = ?
           AND bi.book_uri = ?`,
        [scope.language, scope.interfaceLanguage, scopedOwnerId, scopedProfileId, bookUri],
        (_, result) => resolve(Number(result.rows.item(0)?.n) || 0),
        (_, error) => {
          console.error('[Database] Error counting book rows by interface language:', error);
          reject(error);
        }
      );
    });
  });
};

// Forget which chapters were preprocessed, so they run again (e.g. in a new
// interface language). The book's word index stays, so underlines remain
// while the chapters are fetched again.
export const resetBookPreprocessChapters = (ownerId, bookUri, options = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scopedProfileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, options.language ?? 'ko');

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      resolve(0);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        'DELETE FROM book_preprocess_chapters WHERE owner_id = ? AND profile_id = ? AND book_uri = ?',
        [scopedOwnerId, scopedProfileId, bookUri],
        (_, result) => resolve(result.rowsAffected),
        (_, error) => {
          console.error(`[Database] Error resetting preprocess chapters for "${bookUri}":`, error);
          reject(error);
        }
      );
    });
  });
};

// Difficulty phase 2: what the reader has done with each of a book's words —
// lookups (count + latest), exposures, graded reviews, saves — grouped per
// stem, for services/wordEvidence.js. Only this profile's events for stems
// that occur in the book.
export const lookupBookWordEvidence = (ownerId, bookUri, scopeOrInterfaceLanguage = 'en', options = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scope = normalizeDictionaryCacheScope(scopeOrInterfaceLanguage, options);
  const scopedProfileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, scope.language);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      return resolve([]);
    }
    db.transaction(tx => {
      tx.executeSql(
        `SELECT e.stem, e.event_type, e.outcome, COUNT(*) AS n, MAX(e.created_at) AS last_at
         FROM interaction_events e
         WHERE e.owner_id = ?
           AND e.profile_id = ?
           AND e.language = ?
           AND e.deleted_at IS NULL
           AND e.stem IN (
             SELECT dc.stem FROM book_index bi
             JOIN dictionary_cache dc ON dc.id = bi.stem_id
             WHERE bi.owner_id = ? AND bi.profile_id = ? AND bi.book_uri = ?
           )
         GROUP BY e.stem, e.event_type, e.outcome`,
        [scopedOwnerId, scopedProfileId, scope.language, scopedOwnerId, scopedProfileId, bookUri],
        (_, result) => resolve(result.rows._array),
        (_, error) => {
          console.error('[Database] Error querying word evidence for book:', error);
          reject(error);
        }
      );
    });
  });
};

/**
 * lookupKnowledgeEvidence — the reader's signals for every word in a language,
 * one row per (stem, event type, outcome, day), for the level engine's
 * per-word knowledge (services/levelEngine.js buildWordKnowledge). All words,
 * not only the book's: a Korean word family or a Chinese character shares
 * knowledge with words outside the book.
 */
export const lookupKnowledgeEvidence = (ownerId, language = 'ko', options = {}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const scopedProfileId = resolveProfileId(options.profileId ?? options.profile_id ?? null, normalizedLanguage);
  return new Promise((resolve, reject) => {
    db.transaction(tx => {
      tx.executeSql(
        `SELECT stem, event_type, outcome, substr(created_at, 1, 10) AS day,
                COUNT(*) AS n, MAX(created_at) AS last_at
         FROM interaction_events
         WHERE owner_id = ? AND profile_id = ? AND language = ?
           AND deleted_at IS NULL AND stem IS NOT NULL
           AND event_type IN ('lookup', 'exposure', 'review', 'check', 'save', 'unsave')
         GROUP BY stem, event_type, outcome, day`,
        [scopedOwnerId, scopedProfileId, normalizedLanguage],
        (_, result) => resolve(result.rows._array ?? []),
        (_, error) => {
          console.error('[Database] Error querying knowledge evidence:', error);
          reject(error);
        }
      );
    });
  });
};

/**
 * getBookLookupWords — the words (as tapped) the reader has looked up in a
 * book or song, for the reader's dotted "tapped" underlines.
 */
export const getBookLookupWords = async ({ ownerId, profileId, language = 'ko', bookUri } = {}) => {
  if (!bookUri) return [];
  const normalizedLanguage = normalizeBookLanguage(language) || 'ko';
  const rows = await runSelect(
    `SELECT word, MAX(created_at) AS at FROM interaction_events
     WHERE owner_id = ? AND profile_id = ? AND language = ? AND source_book_uri = ?
       AND event_type = 'lookup' AND deleted_at IS NULL AND word IS NOT NULL
     GROUP BY word`,
    [resolveOwnerId(ownerId), resolveProfileId(profileId, normalizedLanguage), normalizedLanguage, bookUri]
  );
  return rows.map((row) => row.word).filter(Boolean);
};

export const getBookPreprocessMeta = (
  ownerId,
  bookUri,
  preprocessVersion = PREPROCESS_VERSION,
  profileId = null
) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scopedProfileId = resolveProfileId(profileId);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      resolve(null);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT owner_id, profile_id, book_uri, status, preprocess_version, started_at, completed_at, surface_count,
                book_level, book_level_rank, book_level_system, book_level_source, book_level_stats
         FROM book_preprocess_meta
         WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND preprocess_version = ?
         LIMIT 1`,
        [scopedOwnerId, scopedProfileId, bookUri, preprocessVersion],
        (_, result) => {
          resolve(result.rows.length > 0 ? result.rows.item(0) : null);
        },
        (_, error) => {
          console.error(`[Database] Error reading preprocess meta for "${bookUri}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const markBookPreprocessMeta = ({
  ownerId = GUEST_OWNER_ID,
  profileId = null,
  bookUri,
  status = 'partial',
  surfaceCount = 0,
  preprocessVersion = PREPROCESS_VERSION,
  startedAt = new Date().toISOString(),
  completedAt = null,
  bookLevel = null,
}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scopedProfileId = resolveProfileId(profileId);
  const storedBookLevel = normalizeBookLevelForStorage(bookLevel);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      resolve();
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `INSERT OR REPLACE INTO book_preprocess_meta (
          owner_id, profile_id, book_uri, status, preprocess_version, started_at, completed_at, surface_count,
          book_level, book_level_rank, book_level_system, book_level_source, book_level_stats
        )
         VALUES (?, ?, ?, ?, ?, COALESCE(
           (SELECT started_at FROM book_preprocess_meta WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND preprocess_version = ?),
           ?
         ), ?, ?, COALESCE(?, (
           SELECT book_level FROM book_preprocess_meta WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND preprocess_version = ?
         )), COALESCE(?, (
           SELECT book_level_rank FROM book_preprocess_meta WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND preprocess_version = ?
         )), COALESCE(?, (
           SELECT book_level_system FROM book_preprocess_meta WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND preprocess_version = ?
         )), COALESCE(?, (
           SELECT book_level_source FROM book_preprocess_meta WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND preprocess_version = ?
         )), COALESCE(?, (
           SELECT book_level_stats FROM book_preprocess_meta WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND preprocess_version = ?
         )))`,
        [
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          status,
          preprocessVersion,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          preprocessVersion,
          startedAt,
          completedAt,
          surfaceCount,
          storedBookLevel.level,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          preprocessVersion,
          storedBookLevel.rank,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          preprocessVersion,
          storedBookLevel.system,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          preprocessVersion,
          storedBookLevel.source,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          preprocessVersion,
          storedBookLevel.statsJson,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          preprocessVersion,
        ],
        () => resolve(),
        (_, error) => {
          console.error(`[Database] Error marking preprocess meta for "${bookUri}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const getBookPreprocessChapter = (
  ownerId,
  bookUri,
  spineIndex,
  preprocessVersion = PREPROCESS_VERSION,
  profileId = null
) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scopedProfileId = resolveProfileId(profileId);

  return new Promise((resolve, reject) => {
    if (!bookUri || !Number.isInteger(spineIndex)) {
      resolve(null);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT owner_id, profile_id, book_uri, spine_index, status, surface_count,
                book_level, book_level_rank, book_level_system, book_level_source, book_level_stats,
                completed_at, preprocess_version
         FROM book_preprocess_chapters
         WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND spine_index = ? AND preprocess_version = ?
         LIMIT 1`,
        [scopedOwnerId, scopedProfileId, bookUri, spineIndex, preprocessVersion],
        (_, result) => {
          resolve(result.rows.length > 0 ? result.rows.item(0) : null);
        },
        (_, error) => {
          console.error(
            `[Database] Error reading preprocess chapter ${spineIndex} for "${bookUri}":`,
            error
          );
          reject(error);
        }
      );
    });
  });
};

export const getBookPreprocessChapters = (
  ownerId,
  bookUri,
  preprocessVersion = PREPROCESS_VERSION,
  profileId = null
) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scopedProfileId = resolveProfileId(profileId);

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      resolve([]);
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `SELECT owner_id, profile_id, book_uri, spine_index, status, surface_count,
                book_level, book_level_rank, book_level_system, book_level_source, book_level_stats,
                completed_at, preprocess_version
         FROM book_preprocess_chapters
         WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND preprocess_version = ?
         ORDER BY spine_index ASC`,
        [scopedOwnerId, scopedProfileId, bookUri, preprocessVersion],
        (_, result) => {
          resolve(result.rows._array);
        },
        (_, error) => {
          console.error(`[Database] Error reading preprocess chapters for "${bookUri}":`, error);
          reject(error);
        }
      );
    });
  });
};

export const markBookPreprocessChapter = ({
  ownerId = GUEST_OWNER_ID,
  profileId = null,
  bookUri,
  spineIndex,
  status,
  surfaceCount = 0,
  preprocessVersion = PREPROCESS_VERSION,
  completedAt = null,
  bookLevel = null,
}) => {
  const scopedOwnerId = resolveOwnerId(ownerId);
  const scopedProfileId = resolveProfileId(profileId);
  const storedBookLevel = normalizeBookLevelForStorage(bookLevel);

  return new Promise((resolve, reject) => {
    if (!bookUri || !Number.isInteger(spineIndex)) {
      resolve();
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        `INSERT OR REPLACE INTO book_preprocess_chapters (
          owner_id, profile_id, book_uri, spine_index, status, surface_count,
          book_level, book_level_rank, book_level_system, book_level_source, book_level_stats,
          completed_at, preprocess_version
        )
         VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, (
           SELECT book_level FROM book_preprocess_chapters WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND spine_index = ? AND preprocess_version = ?
         )), COALESCE(?, (
           SELECT book_level_rank FROM book_preprocess_chapters WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND spine_index = ? AND preprocess_version = ?
         )), COALESCE(?, (
           SELECT book_level_system FROM book_preprocess_chapters WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND spine_index = ? AND preprocess_version = ?
         )), COALESCE(?, (
           SELECT book_level_source FROM book_preprocess_chapters WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND spine_index = ? AND preprocess_version = ?
         )), COALESCE(?, (
           SELECT book_level_stats FROM book_preprocess_chapters WHERE owner_id = ? AND profile_id = ? AND book_uri = ? AND spine_index = ? AND preprocess_version = ?
         )), ?, ?)`,
        [
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          spineIndex,
          status,
          surfaceCount,
          storedBookLevel.level,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          spineIndex,
          preprocessVersion,
          storedBookLevel.rank,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          spineIndex,
          preprocessVersion,
          storedBookLevel.system,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          spineIndex,
          preprocessVersion,
          storedBookLevel.source,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          spineIndex,
          preprocessVersion,
          storedBookLevel.statsJson,
          scopedOwnerId,
          scopedProfileId,
          bookUri,
          spineIndex,
          preprocessVersion,
          completedAt,
          preprocessVersion,
        ],
        () => resolve(),
        (_, error) => {
          console.error(
            `[Database] Error marking preprocess chapter ${spineIndex} for "${bookUri}":`,
            error
          );
          reject(error);
        }
      );
    });
  });
};

/**
 * isBookPreprocessed
 * Returns true only when the preprocess metadata says the current version
 * completed. Individual book_index rows can exist while the book is still
 * partially cached.
 *
 * @param {string} bookUri
 * @returns {Promise<boolean>}
 */
export const isBookPreprocessed = async (bookUri, options = {}) => {
  const meta = await getBookPreprocessMeta(
    resolveOwnerId(options),
    bookUri,
    PREPROCESS_VERSION,
    options.profileId ?? options.profile_id ?? options
  );
  return meta?.status === 'complete';
};

/**
 * insertBookIndexEntries
 * Bulk-insert surface→stem_id mappings for a book after preprocessing completes.
 * Uses INSERT OR IGNORE so re-running on the same book is safe.
 *
 * @param {string} bookUri
 * @param {Array<{surface: string, stem_id: number}>} entries
 */
/**
 * logDatabaseSnapshot
 * Logs row counts and sample rows from all three tables to the console.
 * Call this after book preprocessing completes to inspect the DB state.
 *
 * @param {string} [bookUri] - If provided, scopes book_index sample to this book
 */
export const logDatabaseSnapshot = async (bookUri) => {
    if (!__DEV__) return;

    const vocabCount = await getDictionaryCacheCount();
    console.log('[DB Snapshot] dictionary_cache rows:', vocabCount);
    // whatever else you want to inspect
};

export const insertBookIndexEntries = (bookUri, entries, options = {}) => {
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, options.language ?? 'ko');

  return new Promise((resolve, reject) => {
    if (!entries || entries.length === 0) {
      return resolve();
    }
    db.transaction(
      tx => {
        entries.forEach(({ surface, stem_id }) => {
          tx.executeSql(
            `INSERT OR IGNORE INTO book_index (owner_id, profile_id, book_uri, surface, stem_id) VALUES (?, ?, ?, ?, ?)`,
            [ownerId, profileId, bookUri, surface, stem_id]
          );
        });
      },
      (error) => {
        console.error(`[Database] Error inserting book_index for "${bookUri}":`, error);
        reject(error);
      },
      () => resolve()
    );
  });
};

export const deleteBookIndexEntries = (bookUri, options = {}) => {
  const ownerId = resolveOwnerId(options);
  const profileId = resolveProfileId(options.profileId ?? options.profile_id ?? options, options.language ?? 'ko');

  return new Promise((resolve, reject) => {
    if (!bookUri) {
      resolve();
      return;
    }

    db.transaction(tx => {
      tx.executeSql(
        'DELETE FROM book_index WHERE owner_id = ? AND profile_id = ? AND book_uri = ?',
        [ownerId, profileId, bookUri],
        () => {},
        (_, error) => {
          console.error(`[Database] Error deleting book_index rows for "${bookUri}":`, error);
          reject(error);
        }
      );
      tx.executeSql(
        'DELETE FROM book_preprocess_chapters WHERE owner_id = ? AND profile_id = ? AND book_uri = ?',
        [ownerId, profileId, bookUri],
        () => {},
        (_, error) => {
          console.error(`[Database] Error deleting preprocess chapter rows for "${bookUri}":`, error);
          reject(error);
        }
      );
      tx.executeSql(
        'DELETE FROM book_preprocess_meta WHERE owner_id = ? AND profile_id = ? AND book_uri = ?',
        [ownerId, profileId, bookUri],
        (_, result) => resolve(result.rowsAffected),
        (_, error) => {
          console.error(`[Database] Error deleting preprocess meta for "${bookUri}":`, error);
          reject(error);
        }
      );
    });
  });
};
