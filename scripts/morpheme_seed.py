"""
Curated morpheme seed list for the English word-breakdown feature.

This is hand-curated (not mined from etymology prose) so that meanings are
short, learner-friendly, and reliably correct. It replaces/supersedes the
previous tiny CANONICAL_MORPHEME_GLOSSES list in build_en_dict_db.py.

Each entry:
  key:        canonical lookup form. Prefixes end in "-", suffixes start
              with "-". Bound roots have no dash (they're not affixed,
              they're the root itself, e.g. "spect" not "-spect-").
  display:    how it should render in the UI. Usually same as key.
  type:       "prefix" | "suffix" | "bound_root"
  language:   origin language, for grouping/labeling (kept short)
  meaning:    SHORT learner-facing gloss. Hard ceiling ~40 chars.
              No semicolon-stacked academic definitions.
  aliases:    spelling/assimilation variants that should resolve to this
              same entry (e.g. Latin "in-" assimilates to "il-/im-/ir-"
              before certain consonants). Aliases are looked up the same
              way but display using the alias's own surface form.
  source:     "curated_seed_v1" for everything in this file.
  confidence: "high" for all curated entries (this is the point).

Design notes:
- Meanings are written for a learner, not a linguist. Prefer "not" over
  "negation of", prefer "across" over "Latin trans, denoting movement
  through or beyond".
- Where a root has multiple senses depending on era/path of borrowing
  (e.g. "duc-" can appear as "duct" or "duce"), we list ONE primary
  meaning. We are not trying to capture full etymological nuance, only
  the meaning a learner needs to connect the word family.
- Bound roots are picked because they recur across multiple common
  English words (this is the cross-word-linking value), not because
  they are etymologically exhaustive. A root that only appears in one
  obscure word doesn't earn a slot here yet.

Known ambiguous-spelling cases (kept deliberately, not bugs):
  - "in-" can mean "not" (inactive) or "in/into" (inject). We keep only
    "not" as the primary entry; the locative sense lives under "en-".
  - "a-"/"an-" mean "not" (atypical) but "a-" is also an alias of "ab-"
    meaning "away from" (avert). Both entries are kept; a decomposition
    algorithm must use word-level validation (does the rest of the word
    reconstruct a known root/word) to pick the right one, not just the
    affix in isolation.
  - "di-" means "apart" (an alias of "dis-") but also "two" (digraph) as
    its own Greek prefix entry.
  - "ex-" (Latin, "out; former") and "ec-" (Greek, alias "ex-") overlap.
  - "-ant" merges two related senses (agent noun: servant; adjective:
    pleasant) under one "one who/that does" gloss rather than splitting,
    since the senses are close enough that one short gloss covers both
    well enough for a learner.
"""

# ---------------------------------------------------------------------------
# PREFIXES
# ---------------------------------------------------------------------------
PREFIXES = [
    # Latin negation / reversal
    {"key": "a-", "language": "Latin/Greek", "meaning": "not; without",
     "aliases": ["an-"]},
    {"key": "in-", "language": "Latin", "meaning": "not",
     "aliases": ["il-", "im-", "ir-"]},
    # NOTE: "in-" is genuinely ambiguous by surface form alone — it can also
    # mean "in; into" (inject, include). We deliberately keep only the
    # negation sense here since it's far more productive in modern
    # vocabulary (inactive, incomplete, inability...). The locative sense
    # is covered separately under "en-" below, and individual words using
    # the locative "in-" will still get correct meaning via their bound
    # root (e.g. "inject" -> root "ject"/"jact": to throw).
    {"key": "non-", "language": "Latin", "meaning": "not"},
    {"key": "un-", "language": "English", "meaning": "not; reverse of"},
    {"key": "dis-", "language": "Latin", "meaning": "apart; not; opposite of",
     "aliases": ["di-", "dif-"]},
    {"key": "de-", "language": "Latin", "meaning": "down; away; reverse of"},
    {"key": "anti-", "language": "Greek", "meaning": "against"},
    {"key": "contra-", "language": "Latin", "meaning": "against",
     "aliases": ["counter-"]},
    {"key": "mal-", "language": "Latin", "meaning": "bad; wrongly",
     "aliases": ["male-"]},
    {"key": "mis-", "language": "English", "meaning": "wrongly; badly"},
    {"key": "pseudo-", "language": "Greek", "meaning": "false; fake"},

    # Latin direction / position
    {"key": "ab-", "language": "Latin", "meaning": "away from",
     "aliases": ["abs-", "a-"]},
    {"key": "ad-", "language": "Latin", "meaning": "to; toward",
     "aliases": ["ac-", "af-", "ag-", "al-", "an-", "ap-", "ar-", "as-", "at-"]},
    {"key": "ante-", "language": "Latin", "meaning": "before"},
    {"key": "circum-", "language": "Latin", "meaning": "around"},
    {"key": "co-", "language": "Latin", "meaning": "together; with",
     "aliases": ["com-", "con-", "col-", "cor-"]},
    {"key": "ex-", "language": "Latin", "meaning": "out; former",
     "aliases": ["e-", "ef-"]},
    {"key": "extra-", "language": "Latin", "meaning": "beyond; outside"},
    {"key": "infra-", "language": "Latin", "meaning": "below"},
    {"key": "inter-", "language": "Latin", "meaning": "between"},
    {"key": "intra-", "language": "Latin", "meaning": "within"},
    {"key": "ob-", "language": "Latin", "meaning": "against; toward",
     "aliases": ["oc-", "of-", "op-"]},
    {"key": "per-", "language": "Latin", "meaning": "through; thoroughly"},
    {"key": "post-", "language": "Latin", "meaning": "after"},
    {"key": "pre-", "language": "Latin", "meaning": "before"},
    {"key": "pro-", "language": "Latin", "meaning": "forward; in favor of"},
    {"key": "re-", "language": "Latin", "meaning": "again; back"},
    {"key": "retro-", "language": "Latin", "meaning": "backward"},
    {"key": "sub-", "language": "Latin", "meaning": "under; below",
     "aliases": ["suc-", "suf-", "sug-", "sup-", "sus-"]},
    {"key": "super-", "language": "Latin", "meaning": "above; beyond",
     "aliases": ["sur-"]},
    {"key": "trans-", "language": "Latin", "meaning": "across",
     "aliases": ["tra-"]},
    {"key": "ultra-", "language": "Latin", "meaning": "beyond; extremely"},

    # Greek direction / position
    {"key": "amphi-", "language": "Greek", "meaning": "both; around"},
    {"key": "ana-", "language": "Greek", "meaning": "up; back; again"},
    {"key": "apo-", "language": "Greek", "meaning": "away from"},
    {"key": "cata-", "language": "Greek", "meaning": "down",
     "aliases": ["cat-", "kata-"]},
    {"key": "dia-", "language": "Greek", "meaning": "through; across"},
    {"key": "ec-", "language": "Greek", "meaning": "out of",
     "aliases": ["ex-"]},
    {"key": "en-", "language": "Greek", "meaning": "in; into",
     "aliases": ["em-"]},
    {"key": "endo-", "language": "Greek", "meaning": "inside"},
    {"key": "epi-", "language": "Greek", "meaning": "upon; above",
     "aliases": ["ep-"]},
    {"key": "exo-", "language": "Greek", "meaning": "outside"},
    {"key": "hyper-", "language": "Greek", "meaning": "over; excessive"},
    {"key": "hypo-", "language": "Greek", "meaning": "under; below normal"},
    {"key": "meta-", "language": "Greek", "meaning": "beyond; changed"},
    {"key": "para-", "language": "Greek", "meaning": "beside; beyond"},
    {"key": "peri-", "language": "Greek", "meaning": "around"},
    {"key": "syn-", "language": "Greek", "meaning": "together; with",
     "aliases": ["sym-", "syl-", "sys-"]},

    # Number / amount
    {"key": "uni-", "language": "Latin", "meaning": "one"},
    {"key": "mono-", "language": "Greek", "meaning": "one; single"},
    {"key": "bi-", "language": "Latin", "meaning": "two"},
    {"key": "di-", "language": "Greek", "meaning": "two"},
    {"key": "duo-", "language": "Latin", "meaning": "two"},
    {"key": "tri-", "language": "Latin/Greek", "meaning": "three"},
    {"key": "quad-", "language": "Latin", "meaning": "four",
     "aliases": ["quadr-", "quadri-"]},
    {"key": "tetra-", "language": "Greek", "meaning": "four"},
    {"key": "penta-", "language": "Greek", "meaning": "five"},
    {"key": "quint-", "language": "Latin", "meaning": "five",
     "aliases": ["quinque-"]},
    {"key": "hexa-", "language": "Greek", "meaning": "six"},
    {"key": "sex-", "language": "Latin", "meaning": "six"},
    {"key": "hepta-", "language": "Greek", "meaning": "seven"},
    {"key": "sept-", "language": "Latin", "meaning": "seven"},
    {"key": "octa-", "language": "Greek", "meaning": "eight",
     "aliases": ["octo-"]},
    {"key": "deca-", "language": "Greek", "meaning": "ten"},
    {"key": "deci-", "language": "Latin", "meaning": "ten"},
    {"key": "centi-", "language": "Latin", "meaning": "hundred"},
    {"key": "milli-", "language": "Latin", "meaning": "thousand"},
    {"key": "kilo-", "language": "Greek", "meaning": "thousand"},
    {"key": "multi-", "language": "Latin", "meaning": "many"},
    {"key": "poly-", "language": "Greek", "meaning": "many"},
    {"key": "omni-", "language": "Latin", "meaning": "all"},
    {"key": "pan-", "language": "Greek", "meaning": "all"},
    {"key": "semi-", "language": "Latin", "meaning": "half"},
    {"key": "hemi-", "language": "Greek", "meaning": "half"},
    {"key": "demi-", "language": "French", "meaning": "half"},

    # Size / degree
    {"key": "macro-", "language": "Greek", "meaning": "large"},
    {"key": "micro-", "language": "Greek", "meaning": "small"},
    {"key": "mega-", "language": "Greek", "meaning": "large; great"},
    {"key": "mini-", "language": "Latin", "meaning": "small"},
    {"key": "maxi-", "language": "Latin", "meaning": "large"},
    {"key": "magni-", "language": "Latin", "meaning": "great; large"},

    # Self / together / other
    {"key": "auto-", "language": "Greek", "meaning": "self"},
    {"key": "homo-", "language": "Greek", "meaning": "same"},
    {"key": "hetero-", "language": "Greek", "meaning": "different"},
    {"key": "iso-", "language": "Greek", "meaning": "equal"},
    {"key": "neo-", "language": "Greek", "meaning": "new"},
    {"key": "proto-", "language": "Greek", "meaning": "first; original"},
    {"key": "eu-", "language": "Greek", "meaning": "good; well"},
    {"key": "dys-", "language": "Greek", "meaning": "bad; difficult"},

    # English native prefixes
    {"key": "be-", "language": "English", "meaning": "make; cause to be"},
    {"key": "fore-", "language": "English", "meaning": "before; front"},
    {"key": "out-", "language": "English", "meaning": "beyond; more than"},
    {"key": "over-", "language": "English", "meaning": "too much; above"},
    {"key": "under-", "language": "English", "meaning": "too little; below"},
    {"key": "up-", "language": "English", "meaning": "upward; higher"},
    {"key": "with-", "language": "English", "meaning": "against; back"},
    {"key": "after-", "language": "English", "meaning": "after; behind"},
    {"key": "mid-", "language": "English", "meaning": "middle"},
    {"key": "self-", "language": "English", "meaning": "of oneself"},

    # Tech / science domains (common enough to be worth it)
    {"key": "tele-", "language": "Greek", "meaning": "distant"},
    {"key": "geo-", "language": "Greek", "meaning": "earth"},
    {"key": "bio-", "language": "Greek", "meaning": "life"},
    {"key": "chrono-", "language": "Greek", "meaning": "time"},
    {"key": "thermo-", "language": "Greek", "meaning": "heat",
     "aliases": ["therm-"]},
    {"key": "psycho-", "language": "Greek", "meaning": "mind",
     "aliases": ["psych-"]},
    {"key": "neuro-", "language": "Greek", "meaning": "nerve"},
    {"key": "photo-", "language": "Greek", "meaning": "light"},
    {"key": "phono-", "language": "Greek", "meaning": "sound",
     "aliases": ["phon-"]},
    {"key": "audio-", "language": "Latin", "meaning": "hearing; sound"},
    {"key": "video-", "language": "Latin", "meaning": "sight; vision"},
    {"key": "aero-", "language": "Greek", "meaning": "air"},
    {"key": "hydro-", "language": "Greek", "meaning": "water"},
    {"key": "aqua-", "language": "Latin", "meaning": "water"},
    {"key": "agro-", "language": "Greek", "meaning": "field; farming"},
    {"key": "astro-", "language": "Greek", "meaning": "star"},
    {"key": "cosmo-", "language": "Greek", "meaning": "universe; world"},
    {"key": "techno-", "language": "Greek", "meaning": "skill; craft"},
]

# ---------------------------------------------------------------------------
# SUFFIXES
# ---------------------------------------------------------------------------
SUFFIXES = [
    # Noun-forming: state / quality / act
    {"key": "-ance", "language": "Latin", "meaning": "state; quality",
     "aliases": ["-ence"]},
    {"key": "-ancy", "language": "Latin", "meaning": "state; quality",
     "aliases": ["-ency"]},
    {"key": "-tion", "language": "Latin", "meaning": "action; result",
     "aliases": ["-sion", "-ation", "-ition"]},
    {"key": "-ment", "language": "Latin", "meaning": "result; process"},
    {"key": "-ness", "language": "English", "meaning": "state; quality"},
    {"key": "-ity", "language": "Latin", "meaning": "state; quality",
     "aliases": ["-ty"]},
    {"key": "-ism", "language": "Greek", "meaning": "belief; system"},
    {"key": "-dom", "language": "English", "meaning": "state; territory"},
    {"key": "-hood", "language": "English", "meaning": "state; group"},
    {"key": "-ship", "language": "English", "meaning": "state; skill"},
    {"key": "-age", "language": "French", "meaning": "result; collection"},
    {"key": "-ery", "language": "French", "meaning": "place; activity",
     "aliases": ["-ry"]},
    {"key": "-cy", "language": "Latin", "meaning": "state; rank"},
    {"key": "-th", "language": "English", "meaning": "act; state"},
    {"key": "-ure", "language": "Latin", "meaning": "act; result"},

    # Noun-forming: person / agent
    {"key": "-er", "language": "English", "meaning": "person; thing that does"},
    {"key": "-or", "language": "Latin", "meaning": "person; thing that does"},
    {"key": "-ist", "language": "Greek", "meaning": "person who practices"},
    {"key": "-ian", "language": "Latin", "meaning": "person related to",
     "aliases": ["-an"]},
    {"key": "-ee", "language": "French", "meaning": "person affected by"},
    {"key": "-eer", "language": "French", "meaning": "person who does"},
    {"key": "-ant", "language": "Latin", "meaning": "one who/that does",
     "aliases": ["-ent"]},
    {"key": "-ess", "language": "French", "meaning": "female person"},
    {"key": "-ster", "language": "English", "meaning": "person associated with"},
    {"key": "-arian", "language": "Latin", "meaning": "person who believes/practices"},

    # Noun-forming: small / diminutive
    {"key": "-let", "language": "French", "meaning": "small"},
    {"key": "-ling", "language": "English", "meaning": "small; young"},
    {"key": "-ette", "language": "French", "meaning": "small"},
    {"key": "-ule", "language": "Latin", "meaning": "small"},
    {"key": "-cule", "language": "Latin", "meaning": "very small"},

    # Noun-forming: field of study / collection
    {"key": "-ology", "language": "Greek", "meaning": "study of"},
    {"key": "-graphy", "language": "Greek", "meaning": "writing; recording"},
    {"key": "-onomy", "language": "Greek", "meaning": "system; management"},
    {"key": "-metry", "language": "Greek", "meaning": "measurement"},
    {"key": "-archy", "language": "Greek", "meaning": "rule; government"},
    {"key": "-cracy", "language": "Greek", "meaning": "rule; government"},
    {"key": "-phobia", "language": "Greek", "meaning": "fear of"},
    {"key": "-philia", "language": "Greek", "meaning": "love of"},
    {"key": "-mania", "language": "Greek", "meaning": "obsession with"},
    {"key": "-pathy", "language": "Greek", "meaning": "feeling; suffering"},

    # Adjective-forming
    {"key": "-able", "language": "Latin", "meaning": "able to be",
     "aliases": ["-ible"]},
    {"key": "-al", "language": "Latin", "meaning": "relating to",
     "aliases": ["-ial"]},
    {"key": "-ic", "language": "Greek", "meaning": "relating to",
     "aliases": ["-ical"]},
    {"key": "-ive", "language": "Latin", "meaning": "tending to"},
    {"key": "-ous", "language": "Latin", "meaning": "full of",
     "aliases": ["-ose"]},
    {"key": "-ful", "language": "English", "meaning": "full of"},
    {"key": "-less", "language": "English", "meaning": "without"},
    {"key": "-ish", "language": "English", "meaning": "somewhat like"},
    {"key": "-like", "language": "English", "meaning": "similar to"},
    {"key": "-some", "language": "English", "meaning": "tending to cause"},
    {"key": "-ary", "language": "Latin", "meaning": "relating to"},
    {"key": "-ory", "language": "Latin", "meaning": "relating to; place for"},
    {"key": "-id", "language": "Latin", "meaning": "having the quality of"},
    {"key": "-esque", "language": "French", "meaning": "in the style of"},

    # Verb-forming
    {"key": "-ize", "language": "Greek", "meaning": "make; become",
     "aliases": ["-ise"]},
    {"key": "-ify", "language": "Latin", "meaning": "make; cause to become",
     "aliases": ["-fy"]},
    {"key": "-ate", "language": "Latin", "meaning": "make; act on"},
    {"key": "-en", "language": "English", "meaning": "make; become"},

    # Adverb-forming
    {"key": "-ly", "language": "English", "meaning": "in a certain way"},
    {"key": "-ward", "language": "English", "meaning": "in the direction of",
     "aliases": ["-wards"]},
    {"key": "-wise", "language": "English", "meaning": "in the manner of"},

    # Verb inflection (kept minimal; mostly grammar, not vocabulary)
    {"key": "-ing", "language": "English", "meaning": "ongoing action"},
    {"key": "-ed", "language": "English", "meaning": "past action; having"},
]

# ---------------------------------------------------------------------------
# BOUND ROOTS (Latin / Greek roots that recur across common English words
# but are not standalone English words themselves)
# ---------------------------------------------------------------------------
BOUND_ROOTS = [
    # Motion / position
    {"key": "duc", "language": "Latin", "meaning": "to lead",
     "aliases": ["duct", "duce"]},
    {"key": "mit", "language": "Latin", "meaning": "to send",
     "aliases": ["miss", "mis"]},
    {"key": "pon", "language": "Latin", "meaning": "to put; place",
     "aliases": ["pos", "posit"]},
    {"key": "port", "language": "Latin", "meaning": "to carry"},
    {"key": "pel", "language": "Latin", "meaning": "to push; drive",
     "aliases": ["puls"]},
    {"key": "tract", "language": "Latin", "meaning": "to pull; drag",
     "aliases": ["trah"]},
    {"key": "ven", "language": "Latin", "meaning": "to come",
     "aliases": ["vent"]},
    {"key": "ced", "language": "Latin", "meaning": "to go; yield",
     "aliases": ["ceed", "cess"]},
    {"key": "grad", "language": "Latin", "meaning": "to step; go",
     "aliases": ["gress"]},
    {"key": "vert", "language": "Latin", "meaning": "to turn",
     "aliases": ["vers"]},
    {"key": "vol", "language": "Latin", "meaning": "to fly",
     "aliases": ["volv", "volut"]},
    {"key": "curr", "language": "Latin", "meaning": "to run",
     "aliases": ["curs"]},
    {"key": "migr", "language": "Latin", "meaning": "to move; travel"},
    {"key": "vad", "language": "Latin", "meaning": "to go; walk",
     "aliases": ["vas"]},
    {"key": "her", "language": "Latin", "meaning": "to stick",
     "aliases": ["hes"]},

    # Speaking / thought / knowledge
    {"key": "dict", "language": "Latin", "meaning": "to say; speak"},
    {"key": "loqu", "language": "Latin", "meaning": "to speak",
     "aliases": ["locut"]},
    {"key": "voc", "language": "Latin", "meaning": "to call; voice",
     "aliases": ["vok"]},
    {"key": "claim", "language": "Latin", "meaning": "to shout; declare",
     "aliases": ["clam"]},
    {"key": "spect", "language": "Latin", "meaning": "to look; see",
     "aliases": ["spec", "spic"]},
    {"key": "vid", "language": "Latin", "meaning": "to see",
     "aliases": ["vis"]},
    {"key": "scrib", "language": "Latin", "meaning": "to write",
     "aliases": ["script"]},
    {"key": "graph", "language": "Greek", "meaning": "to write; draw"},
    {"key": "log", "language": "Greek", "meaning": "word; speech; study"},
    {"key": "nounc", "language": "Latin", "meaning": "to announce",
     "aliases": ["nunc"]},
    {"key": "sci", "language": "Latin", "meaning": "to know"},
    {"key": "gnos", "language": "Greek", "meaning": "to know",
     "aliases": ["gno"]},
    {"key": "doc", "language": "Latin", "meaning": "to teach",
     "aliases": ["doct"]},
    {"key": "sens", "language": "Latin", "meaning": "to feel; perceive",
     "aliases": ["sent"]},
    {"key": "put", "language": "Latin", "meaning": "to think; reckon"},
    {"key": "cogn", "language": "Latin", "meaning": "to know"},
    {"key": "phon", "language": "Greek", "meaning": "sound; voice"},
    {"key": "phas", "language": "Greek", "meaning": "to speak",
     "aliases": ["phat"]},

    # Holding / taking / making
    {"key": "cept", "language": "Latin", "meaning": "to take; seize",
     "aliases": ["capt", "ceiv", "ceit"]},
    {"key": "tain", "language": "Latin", "meaning": "to hold",
     "aliases": ["ten", "tent"]},
    {"key": "fer", "language": "Latin", "meaning": "to carry; bring"},
    {"key": "fac", "language": "Latin", "meaning": "to make; do",
     "aliases": ["fact", "fect", "fic"]},
    {"key": "struct", "language": "Latin", "meaning": "to build",
     "aliases": ["stru"]},
    {"key": "gen", "language": "Latin/Greek", "meaning": "to produce; birth",
     "aliases": ["gener"]},
    {"key": "creat", "language": "Latin", "meaning": "to make; bring forth"},
    {"key": "form", "language": "Latin", "meaning": "shape"},
    {"key": "string", "language": "Latin", "meaning": "to bind tightly",
     "aliases": ["strict"]},
    {"key": "jung", "language": "Latin", "meaning": "to join",
     "aliases": ["junct"]},
    {"key": "nect", "language": "Latin", "meaning": "to bind; tie"},
    {"key": "sect", "language": "Latin", "meaning": "to cut"},
    {"key": "scind", "language": "Latin", "meaning": "to cut; split",
     "aliases": ["sciss"]},
    {"key": "rupt", "language": "Latin", "meaning": "to break"},
    {"key": "frag", "language": "Latin", "meaning": "to break",
     "aliases": ["fract"]},
    {"key": "solv", "language": "Latin", "meaning": "to loosen; release",
     "aliases": ["solut"]},
    {"key": "clud", "language": "Latin", "meaning": "to close; shut",
     "aliases": ["clus", "claus"]},
    {"key": "pend", "language": "Latin", "meaning": "to hang; weigh",
     "aliases": ["pens"]},
    {"key": "ject", "language": "Latin", "meaning": "to throw",
     "aliases": ["jact"]},

    # Sending / movement of body
    {"key": "mov", "language": "Latin", "meaning": "to move",
     "aliases": ["mot", "mob"]},
    {"key": "act", "language": "Latin", "meaning": "to do; drive",
     "aliases": ["ag"]},
    {"key": "flect", "language": "Latin", "meaning": "to bend",
     "aliases": ["flex"]},
    {"key": "loc", "language": "Latin", "meaning": "place"},
    {"key": "sist", "language": "Latin", "meaning": "to stand"},
    {"key": "stit", "language": "Latin", "meaning": "to stand; set up"},
    {"key": "stat", "language": "Latin", "meaning": "to stand; stay"},
    {"key": "sta", "language": "Latin", "meaning": "to stand"},

    # Life / people / measure
    {"key": "viv", "language": "Latin", "meaning": "to live",
     "aliases": ["vit"]},
    {"key": "mort", "language": "Latin", "meaning": "death"},
    {"key": "anim", "language": "Latin", "meaning": "life; spirit"},
    {"key": "corp", "language": "Latin", "meaning": "body"},
    {"key": "soci", "language": "Latin", "meaning": "companion; group"},
    {"key": "pop", "language": "Latin", "meaning": "people"},
    {"key": "dem", "language": "Greek", "meaning": "people"},
    {"key": "anthrop", "language": "Greek", "meaning": "human"},
    {"key": "patr", "language": "Latin/Greek", "meaning": "father"},
    {"key": "matr", "language": "Latin", "meaning": "mother"},
    {"key": "frat", "language": "Latin", "meaning": "brother"},
    {"key": "metr", "language": "Greek", "meaning": "measure"},
    {"key": "numer", "language": "Latin", "meaning": "number"},
    {"key": "equ", "language": "Latin", "meaning": "equal"},
    {"key": "ident", "language": "Latin", "meaning": "same"},

    # Feeling / value / quality
    {"key": "am", "language": "Latin", "meaning": "to love",
     "aliases": ["amor"]},
    {"key": "bene", "language": "Latin", "meaning": "good; well"},
    {"key": "mal", "language": "Latin", "meaning": "bad"},
    {"key": "ver", "language": "Latin", "meaning": "true"},
    {"key": "just", "language": "Latin", "meaning": "right; lawful"},
    {"key": "leg", "language": "Latin", "meaning": "law",
     "aliases": ["legis"]},
    {"key": "jud", "language": "Latin", "meaning": "judge",
     "aliases": ["judic"]},
    {"key": "cred", "language": "Latin", "meaning": "to believe; trust"},
    {"key": "fid", "language": "Latin", "meaning": "trust; faith"},
    {"key": "grat", "language": "Latin", "meaning": "pleasing; thankful"},
    {"key": "val", "language": "Latin", "meaning": "worth; strength"},
    {"key": "pot", "language": "Latin", "meaning": "power",
     "aliases": ["poss"]},
    {"key": "domin", "language": "Latin", "meaning": "to rule; control"},
    {"key": "reg", "language": "Latin", "meaning": "to rule; direct",
     "aliases": ["rect"]},

    # Greek science / philosophy roots
    {"key": "bio", "language": "Greek", "meaning": "life"},
    {"key": "psych", "language": "Greek", "meaning": "mind; soul"},
    {"key": "soph", "language": "Greek", "meaning": "wisdom"},
    {"key": "path", "language": "Greek", "meaning": "feeling; suffering"},
    {"key": "morph", "language": "Greek", "meaning": "shape; form"},
    {"key": "the", "language": "Greek", "meaning": "god",
     "aliases": ["theo"]},
    {"key": "cosm", "language": "Greek", "meaning": "universe; order"},
    {"key": "chron", "language": "Greek", "meaning": "time"},
    {"key": "therm", "language": "Greek", "meaning": "heat"},
    {"key": "phys", "language": "Greek", "meaning": "nature; body"},
    {"key": "chrom", "language": "Greek", "meaning": "color"},
    {"key": "phot", "language": "Greek", "meaning": "light"},
    {"key": "dyn", "language": "Greek", "meaning": "power",
     "aliases": ["dynam"]},
    {"key": "techn", "language": "Greek", "meaning": "skill; craft"},
    {"key": "trop", "language": "Greek", "meaning": "turning; change"},
    {"key": "scop", "language": "Greek", "meaning": "to look; watch"},
    {"key": "phil", "language": "Greek", "meaning": "love"},
    {"key": "phob", "language": "Greek", "meaning": "fear"},
    {"key": "pathy", "language": "Greek", "meaning": "feeling"},

    # Body parts (common in medical/anatomical vocabulary)
    {"key": "cord", "language": "Latin", "meaning": "heart"},
    {"key": "card", "language": "Greek", "meaning": "heart"},
    {"key": "derm", "language": "Greek", "meaning": "skin"},
    {"key": "ped", "language": "Latin", "meaning": "foot"},
    {"key": "pod", "language": "Greek", "meaning": "foot"},
    {"key": "man", "language": "Latin", "meaning": "hand",
     "aliases": ["manu"]},
    {"key": "ocul", "language": "Latin", "meaning": "eye"},
    {"key": "opt", "language": "Greek", "meaning": "eye; sight"},
    {"key": "aud", "language": "Latin", "meaning": "to hear"},
    {"key": "or", "language": "Latin", "meaning": "mouth"},
    {"key": "dent", "language": "Latin", "meaning": "tooth"},
    {"key": "odont", "language": "Greek", "meaning": "tooth"},
    {"key": "cap", "language": "Latin", "meaning": "head",
     "aliases": ["capit"]},
    {"key": "cephal", "language": "Greek", "meaning": "head"},
]

ALL_MORPHEMES = PREFIXES + SUFFIXES + BOUND_ROOTS
