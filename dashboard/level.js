// Noeul admin: Level model page.
//
// Data comes from one Supabase RPC, public.admin_level_model(p_user,
// p_language, p_days) (supabase/user_ability_log.sql), which reads the
// ability log the app writes for every change to a reader's level
// (frontend/services/levelEngine.js). Same sign-in and admin check as the
// overview page; the session is shared through localStorage.
(function () {
  const { formatCount, el } = window.NoeulCharts;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const PREFS_KEY = 'noeul-admin-level-prefs';
  const params = new URLSearchParams(window.location.search);
  const demoMode = params.has('demo');
  const config = window.NOEUL_DASHBOARD_CONFIG;
  const $ = (id) => document.getElementById(id);

  const SIGNALS = {
    lookup: 'Looked up',
    pass: 'Read past',
    review: 'Review',
    check: 'Word check',
    pseudo: 'Made-up word',
    seed: 'Level picker',
    check_seed: 'Word check result',
  };
  const LANGUAGES = { ko: 'Korean', zh: 'Chinese', en: 'English' };
  // Bands per language on the −3…+3 scale (frontend/constants/proficiencyLevels).
  const BAND_COUNT = { ko: 6, zh: 7, en: 6 };
  const BAND_NAME = { ko: 'level', zh: 'HSK', en: 'CEFR band' };

  const readPrefs = () => {
    try { return JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
  };
  const writePrefs = () => {
    try {
      window.localStorage.setItem(PREFS_KEY, JSON.stringify({
        days: state.days, language: state.language, user: state.user,
      }));
    } catch { /* storage unavailable */ }
  };

  const saved = readPrefs();
  const state = {
    days: [7, 30, 90].includes(saved.days) ? saved.days : 30,
    language: typeof saved.language === 'string' ? saved.language : '',
    user: params.get('user') || saved.user || '',
    client: null,
    data: null,
    loading: false,
    logSignal: '',
    logQuery: '',
  };

  // ─── Formatting ───────────────────────────────────────────────────────────

  const num = (value, digits = 2) => (value == null || Number.isNaN(Number(value)) ? '–' : Number(value).toFixed(digits));
  const signed = (value, digits = 2) => {
    if (value == null || Number.isNaN(Number(value))) return '–';
    const v = Number(Number(value).toFixed(digits));
    return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;
  };
  const pct = (value) => (value == null ? '–' : `${Math.round(Number(value) * 100)}%`);
  const sd = (variance) => (variance == null ? null : Math.sqrt(Math.max(0, Number(variance))));
  const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–');
  const relative = (iso) => {
    if (!iso) return '–';
    const minutes = (Date.now() - new Date(iso).getTime()) / 60000;
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${Math.round(minutes)} min ago`;
    if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
    return `${Math.round(minutes / 1440)} d ago`;
  };
  const bandOf = (theta, language) => {
    const k = BAND_COUNT[language];
    if (!k || theta == null) return null;
    return 1 + ((Number(theta) + 3) / 6) * (k - 1);
  };
  const levelText = (theta, language) => {
    const band = bandOf(theta, language);
    return band == null ? num(theta) : `${num(theta)}  (≈ ${BAND_NAME[language]} ${band.toFixed(1)})`;
  };
  const readerName = (row) => row.email || (row.is_anonymous ? `guest ${String(row.user_id).slice(0, 8)}` : String(row.user_id).slice(0, 8));

  const svgEl = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value != null) node.setAttribute(key, String(value));
    });
    return node;
  };
  const svgText = (attrs, text) => {
    const node = svgEl('text', attrs);
    node.textContent = text;
    return node;
  };

  const cardHead = (title, subtitle, extra = null) => el('div', { className: 'card-head' }, [
    el('div', {}, [
      el('h3', { className: 'card-title', text: title }),
      subtitle ? el('p', { className: 'card-sub', text: subtitle }) : null,
    ]),
    extra,
  ]);

  const table = (columns, rows, emptyText, { tall = false, onRow = null, selected = null } = {}) => {
    if (!rows.length) return el('div', { className: 'empty-state', text: emptyText });
    return el('div', { className: `table-wrap${tall ? ' tall' : ''}` }, el('table', {}, [
      el('thead', {}, el('tr', {}, columns.map((c) => el('th', { className: c.num ? 'num' : '', text: c.label })))),
      el('tbody', {}, rows.map((row) => {
        const tr = el('tr', {
          className: [onRow ? 'clickable' : '', selected && selected(row) ? 'selected' : ''].join(' ').trim() || null,
          tabindex: onRow ? '0' : null,
        }, columns.map((c) => {
          const value = c.render(row);
          const cell = el('td', { className: [c.num ? 'num' : '', c.nowrap ? 'nowrap' : ''].join(' ').trim() || null });
          if (value instanceof Node) cell.appendChild(value);
          else cell.textContent = value == null ? '–' : String(value);
          return cell;
        }));
        if (onRow) {
          tr.addEventListener('click', () => onRow(row));
          tr.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onRow(row);
            }
          });
        }
        return tr;
      })),
    ]));
  };

  const tableToggle = (container, buildTable) => {
    const holder = el('div', { className: 'hidden' });
    const button = el('button', { className: 'table-toggle', type: 'button', 'aria-expanded': 'false', text: 'Show as table' });
    button.addEventListener('click', () => {
      const open = holder.classList.toggle('hidden') === false;
      button.setAttribute('aria-expanded', String(open));
      button.textContent = open ? 'Hide table' : 'Show as table';
      if (open && !holder.firstChild) holder.appendChild(buildTable());
    });
    container.append(button, holder);
  };

  function makeTooltip(container) {
    const tip = el('div', { className: 'tooltip hidden', role: 'status' });
    container.appendChild(tip);
    return {
      show(title, lines, x, y) {
        tip.replaceChildren(
          el('div', { className: 'tooltip-title', text: title }),
          ...lines.map((line) => el('div', { className: 'tooltip-row' }, [
            line.color ? el('span', { className: 'key-line', style: `background:${line.color}` }) : null,
            el('strong', { text: line.value }),
            el('span', { text: line.label }),
          ]))
        );
        tip.classList.remove('hidden');
        const left = x + 14 + tip.offsetWidth > container.clientWidth ? Math.max(0, x - 14 - tip.offsetWidth) : x + 14;
        tip.style.left = `${left}px`;
        tip.style.top = `${Math.max(0, y - 10)}px`;
      },
      hide() { tip.classList.add('hidden'); },
    };
  }

  // ─── Readers ──────────────────────────────────────────────────────────────

  function readersFor(data) {
    return (data.users || []).filter((row) => !state.language || row.language === state.language);
  }

  function renderReaders(data) {
    const rows = readersFor(data);
    const columns = [
      { label: 'Reader', render: (r) => readerName(r) },
      { label: 'Language', render: (r) => LANGUAGES[r.language] || r.language },
      { label: 'Level', num: true, nowrap: true, render: (r) => levelText(r.theta, r.language) },
      { label: '±', num: true, render: (r) => num(sd(r.variance)) },
      { label: 'Moved', num: true, render: (r) => signed(r.drift) },
      { label: 'Lookups', num: true, render: (r) => formatCount(r.lookups) },
      { label: 'Read past', num: true, render: (r) => formatCount(r.passes) },
      { label: 'Checks', num: true, render: (r) => formatCount(r.checks) },
      { label: 'Lookup rate', num: true, render: (r) => pct(r.lookup_rate) },
      { label: 'Last active', nowrap: true, render: (r) => relative(r.last_at) },
    ];
    $('readers').replaceChildren(
      cardHead(`${rows.length} reader${rows.length === 1 ? '' : 's'}`, `Moved = net level change from signals in the last ${data.range.days} days. Lookup rate = how often the reader looks up a word they don't know.`),
      table(columns, rows, 'No reader has a level yet. Readers appear once the app uploads its first level changes.', {
        tall: true,
        onRow: (row) => selectReader(row.user_id, row.language),
        selected: (row) => row.user_id === state.user && (!state.language || row.language === state.language),
      })
    );

    const select = $('user-control');
    const seen = new Set();
    const options = [el('option', { value: '', text: 'Pick a reader' })];
    (data.users || []).forEach((row) => {
      if (seen.has(row.user_id)) return;
      seen.add(row.user_id);
      options.push(el('option', { value: row.user_id, text: readerName(row) }));
    });
    select.replaceChildren(...options);
    select.value = state.user;
  }

  function selectReader(userId, language) {
    state.user = userId;
    if (language) {
      state.language = language;
      $('language-control').value = language;
    }
    writePrefs();
    load();
  }

  // ─── Selected reader ──────────────────────────────────────────────────────

  function renderReader(data) {
    const section = $('reader-section');
    const log = (data.log || []).filter((row) => row.theta_after != null || row.signal === 'pseudo');
    if (!state.user) {
      section.classList.add('hidden');
      return;
    }
    section.classList.remove('hidden');
    const info = (data.users || []).find((row) => row.user_id === state.user && (!state.language || row.language === state.language))
      || (data.users || []).find((row) => row.user_id === state.user);
    const language = state.language || info?.language || '';
    $('reader-h').textContent = info ? readerName(info) : 'Reader';
    $('reader-sub').textContent = `${LANGUAGES[language] || 'All languages'} · ${formatCount(log.length)} level changes in the last ${data.range.days} days${log.length >= 5000 ? ' (newest 5,000 shown)' : ''}.`;

    const last = log.length ? log[log.length - 1] : null;
    const first = log.length ? log[0] : null;
    const theta = last?.theta_after ?? info?.theta;
    const variance = last?.var_after ?? info?.variance;
    const counts = log.reduce((acc, row) => ({ ...acc, [row.signal]: (acc[row.signal] || 0) + 1 }), {});
    const tile = (label, value, foot) => el('div', { className: 'tile' }, [
      el('div', { className: 'tile-label', text: label }),
      el('div', { className: 'tile-value', text: value }),
      el('div', { className: 'tile-foot', text: foot }),
    ]);
    $('reader-tiles').replaceChildren(
      tile('Level now', num(theta), bandOf(theta, language) != null ? `≈ ${BAND_NAME[language]} ${bandOf(theta, language).toFixed(1)} · ± ${num(sd(variance))}` : `± ${num(sd(variance))}`),
      tile('Change in range', signed(first && last ? last.theta_after - first.theta_before : null), first ? `from ${num(first.theta_before)}` : 'No changes yet'),
      tile('Lookup rate', pct(last?.lookup_rate ?? info?.lookup_rate), 'P(look up | word unknown), learned'),
      tile('Signals', formatCount(log.length), `${formatCount(counts.lookup || 0)} lookups · ${formatCount(counts.pass || 0)} read past · ${formatCount((counts.check || 0) + (counts.pseudo || 0))} checks`)
    );

    renderLevelChart($('chart-level'), log);
    renderContributions($('contributions'), log);
    renderLog($('log'), log);
  }

  function renderLevelChart(card, log) {
    card.replaceChildren(cardHead('Level over time', 'The line is the level after each signal; the band is ± one standard deviation.'));
    const points = log.filter((row) => row.theta_after != null).map((row) => ({
      ...row,
      t: new Date(row.created_at).getTime(),
      sd: sd(row.var_after) ?? 0,
    }));
    const holder = el('div', { className: 'chart' });
    card.appendChild(holder);
    const width = holder.clientWidth || 600;
    const height = 220;
    const margin = { top: 10, right: 16, bottom: 24, left: 40 };
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Level over time' });
    holder.appendChild(svg);
    if (points.length === 0) {
      svg.appendChild(svgText({ class: 'empty', x: width / 2, y: height / 2, 'text-anchor': 'middle' }, 'No level changes in this range'));
      return;
    }
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const t0 = points[0].t;
    const t1 = Math.max(points[points.length - 1].t, t0 + 60000);
    const xAt = (t) => margin.left + ((t - t0) / (t1 - t0)) * plotW;
    const yAt = (v) => margin.top + ((3 - Math.max(-3, Math.min(3, v))) / 6) * plotH;

    [-3, -1.5, 0, 1.5, 3].forEach((v, i) => {
      const y = Math.round(yAt(v)) + 0.5;
      svg.appendChild(svgEl('line', { class: i === 0 ? 'base-line' : 'grid-line', x1: margin.left, x2: width - margin.right, y1: y, y2: y }));
      svg.appendChild(svgText({ class: 'axis-text', x: margin.left - 8, y: y + 4, 'text-anchor': 'end' }, v > 0 ? `+${v}` : String(v)));
    });
    const ticks = width < 420 ? 2 : 4;
    for (let i = 0; i <= ticks; i += 1) {
      const t = t0 + ((t1 - t0) * i) / ticks;
      svg.appendChild(svgText({
        class: 'axis-text', x: xAt(t), y: height - 6, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle',
      }, new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })));
    }

    const upper = points.map((p) => `${xAt(p.t)},${yAt(p.theta_after + p.sd)}`);
    const lower = points.map((p) => `${xAt(p.t)},${yAt(p.theta_after - p.sd)}`).reverse();
    svg.appendChild(svgEl('polygon', { points: [...upper, ...lower].join(' '), fill: 'var(--area-1)', stroke: 'none' }));
    svg.appendChild(svgEl('polyline', {
      class: 'series-line', stroke: 'var(--series-1)', points: points.map((p) => `${xAt(p.t)},${yAt(p.theta_after)}`).join(' '),
    }));
    // Resets of the level (picker, word check) as hollow markers.
    points.filter((p) => p.signal === 'seed' || p.signal === 'check_seed').forEach((p) => {
      svg.appendChild(svgEl('circle', { cx: xAt(p.t), cy: yAt(p.theta_after), r: 4.5, fill: 'var(--surface-1)', stroke: 'var(--series-1)', 'stroke-width': 2 }));
    });

    const cross = svgEl('line', { class: 'crosshair hidden', y1: margin.top, y2: height - margin.bottom });
    const dot = svgEl('circle', { class: 'dot hidden', r: 4, fill: 'var(--series-1)' });
    svg.append(cross, dot);
    const tip = makeTooltip(holder);
    const hit = svgEl('rect', { x: margin.left, y: margin.top, width: plotW, height: plotH, fill: 'transparent' });
    svg.appendChild(hit);
    const nearest = (x) => {
      const t = t0 + ((x - margin.left) / plotW) * (t1 - t0);
      let best = points[0];
      points.forEach((p) => { if (Math.abs(p.t - t) < Math.abs(best.t - t)) best = p; });
      return best;
    };
    const showAt = (clientX) => {
      const rect = svg.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * width;
      const p = nearest(x);
      const px = xAt(p.t);
      const py = yAt(p.theta_after);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.classList.remove('hidden');
      dot.setAttribute('cx', px); dot.setAttribute('cy', py); dot.classList.remove('hidden');
      const lines = [
        { color: 'var(--series-1)', value: `${num(p.theta_after)} ± ${num(p.sd)}`, label: 'level after' },
        { value: signed(p.theta_after - p.theta_before), label: SIGNALS[p.signal] || p.signal },
      ];
      if (p.word) lines.push({ value: p.word, label: p.p_known != null ? `P(known) was ${pct(p.p_known)}` : '' });
      tip.show(when(p.created_at), lines, (px / width) * rect.width, (py / height) * rect.height);
    };
    hit.addEventListener('mousemove', (event) => showAt(event.clientX));
    hit.addEventListener('mouseleave', () => { tip.hide(); cross.classList.add('hidden'); dot.classList.add('hidden'); });

    tableToggle(card, () => table([
      { label: 'Time', nowrap: true, render: (p) => when(p.created_at) },
      { label: 'Signal', render: (p) => SIGNALS[p.signal] || p.signal },
      { label: 'Word', render: (p) => p.word },
      { label: 'Level', num: true, render: (p) => num(p.theta_after) },
      { label: '±', num: true, render: (p) => num(p.sd) },
    ], points.slice(-300).reverse(), 'No rows', { tall: true }));
  }

  function renderContributions(card, log) {
    card.replaceChildren(cardHead('What moved the level', 'Net change from each kind of signal in the range, and how many there were.'));
    const groups = {};
    log.forEach((row) => {
      if (row.signal === 'seed' || row.signal === 'check_seed' || row.signal === 'pseudo') return;
      const g = groups[row.signal] || (groups[row.signal] = { signal: row.signal, total: 0, n: 0 });
      g.total += Number(row.theta_after) - Number(row.theta_before);
      g.n += 1;
    });
    const rows = Object.values(groups).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
    if (!rows.length) {
      card.appendChild(el('div', { className: 'empty-state', text: 'No signals in this range.' }));
      return;
    }
    const max = Math.max(...rows.map((r) => Math.abs(r.total)), 0.01);
    const list = el('div', { className: 'diverging-list' }, rows.map((r) => {
      const share = (Math.abs(r.total) / max) * 50;
      const fill = el('div', {
        className: `div-fill ${r.total >= 0 ? 'up' : 'down'}`,
        style: r.total >= 0 ? `left:50%;width:${share}%` : `right:50%;width:${share}%`,
      });
      return el('div', { className: 'div-row' }, [
        el('span', { className: 'div-label', text: SIGNALS[r.signal] || r.signal }),
        el('div', { className: 'div-track', role: 'img', 'aria-label': `${SIGNALS[r.signal]}: ${signed(r.total)}` }, [el('div', { className: 'div-axis' }), fill]),
        el('span', { className: 'div-value', text: signed(r.total) }),
        el('span', { className: 'div-count muted', text: `${formatCount(r.n)}×` }),
      ]);
    }));
    card.appendChild(list);
  }

  function renderLog(card, log) {
    const rows = log.slice().reverse().filter((row) => {
      if (state.logSignal && row.signal !== state.logSignal) return false;
      if (!state.logQuery) return true;
      const q = state.logQuery.toLowerCase();
      return [row.word, row.stem, row.source_book_uri].some((v) => String(v || '').toLowerCase().includes(q));
    });

    const signalSelect = el('select', { className: 'select', 'aria-label': 'Signal' }, [
      el('option', { value: '', text: 'All signals' }),
      ...Object.entries(SIGNALS).map(([key, label]) => el('option', { value: key, text: label })),
    ]);
    signalSelect.value = state.logSignal;
    signalSelect.addEventListener('change', () => { state.logSignal = signalSelect.value; renderLog(card, log); });
    const search = el('input', { className: 'search', type: 'search', placeholder: 'Word or book', 'aria-label': 'Filter by word or book', value: state.logQuery });
    search.addEventListener('input', () => {
      state.logQuery = search.value.trim();
      renderLog(card, log);
      const again = card.querySelector('input.search');
      again.focus();
      again.setSelectionRange(again.value.length, again.value.length);
    });

    const columns = [
      { label: 'Time', nowrap: true, render: (r) => when(r.created_at) },
      { label: 'Signal', nowrap: true, render: (r) => SIGNALS[r.signal] || r.signal },
      { label: 'Word', nowrap: true, render: (r) => r.word && r.stem && r.word !== r.stem ? `${r.word} (${r.stem})` : (r.word || r.stem) },
      { label: 'Difficulty', num: true, render: (r) => num(r.difficulty) },
      { label: 'P(known) before', num: true, render: (r) => pct(r.p_known) },
      { label: 'Change', num: true, render: (r) => (r.theta_after == null ? '–' : signed(r.theta_after - r.theta_before, 3)) },
      { label: 'Level after', num: true, render: (r) => num(r.theta_after) },
      { label: '±', num: true, render: (r) => num(sd(r.var_after)) },
      { label: 'Why', render: (r) => describeDetails(r) },
    ];

    let summary = null;
    if (state.logQuery && rows.length) {
      const word = rows.filter((r) => r.word || r.stem);
      const lookups = word.filter((r) => r.signal === 'lookup').length;
      const passes = word.filter((r) => r.signal === 'pass').length;
      const checks = word.filter((r) => r.signal === 'check');
      summary = el('p', { className: 'card-sub' }, [
        `“${state.logQuery}”: ${lookups} lookup${lookups === 1 ? '' : 's'}, ${passes} read past`,
        checks.length ? `, word check said ${checks[0].outcome ? '“know”' : '“don’t know”'}` : '',
        word.length ? `. Latest P(known) before a signal: ${pct(word[0].p_known)}.` : '.',
      ]);
    }

    card.replaceChildren(
      cardHead('Why it moved', 'Every level change, newest first. Search a word to see its whole history.', el('div', { className: 'log-filters' }, [signalSelect, search])),
      summary || el('span'),
      table(columns, rows.slice(0, 500), 'No changes match.', { tall: true }),
      rows.length > 500 ? el('p', { className: 'card-sub', text: `Showing the newest 500 of ${formatCount(rows.length)}.` }) : el('span')
    );
  }

  function describeDetails(row) {
    const d = row.details || {};
    const parts = [];
    if (d.levelRank != null) parts.push(`level ${d.levelRank}`);
    if (d.percentile != null) parts.push(`pct ${Number(d.percentile).toFixed(2)}`);
    if (d.zipf != null) parts.push(`zipf ${Number(d.zipf).toFixed(1)}`);
    if (d.loanword) parts.push('loanword');
    if (d.dwellSeconds) parts.push(`${Math.round(d.dwellSeconds)} s on page`);
    if (d.nearestRank != null) parts.push(`picked rank ${d.nearestRank}`);
    if (d.answered != null) parts.push(`${d.answered} answers`);
    if (row.signal === 'lookup' || row.signal === 'pass') parts.push(`lookup rate ${pct(row.lookup_rate)}`);
    if (row.signal === 'pseudo') parts.push(`guess rate ${pct(row.guess_rate)}`);
    return parts.join(' · ');
  }

  // ─── Calibration ──────────────────────────────────────────────────────────

  const CAL_SERIES = [
    { key: 'check', label: 'Word check: said “know”', color: 'var(--series-1)', signals: ['check'] },
    { key: 'lookup', label: 'Reading: looked the word up', color: 'var(--series-2)', signals: ['lookup', 'pass'] },
    { key: 'review', label: 'Review: recalled the word', color: 'var(--series-3)', signals: ['review'] },
  ];

  function calibrationSeries(data) {
    return CAL_SERIES.map((series) => {
      const bins = new Map();
      (data.calibration || []).filter((row) => series.signals.includes(row.signal)).forEach((row) => {
        const b = bins.get(row.bin) || { bin: row.bin, n: 0, predicted: 0, observed: 0 };
        const n = Number(row.n) || 0;
        b.predicted += Number(row.predicted) * n;
        b.observed += Number(row.observed) * n;
        b.n += n;
        bins.set(row.bin, b);
      });
      const points = Array.from(bins.values())
        .filter((b) => b.n > 0)
        .map((b) => ({ bin: b.bin, n: b.n, predicted: b.predicted / b.n, observed: b.observed / b.n }))
        .sort((a, b) => a.predicted - b.predicted);
      const total = points.reduce((sum, p) => sum + p.n, 0);
      const error = total ? points.reduce((sum, p) => sum + p.n * Math.abs(p.predicted - p.observed), 0) / total : null;
      return { ...series, points, total, error };
    });
  }

  function renderCalibration(data) {
    const card = $('calibration');
    const series = calibrationSeries(data);
    card.replaceChildren(cardHead(
      'Predicted vs what happened',
      'Word checks are the cleanest test. Reading groups lookups with words read past (the chance the reader looks a word up); only some read-past words are logged, so treat that line as a rough guide.'
    ));
    const legend = el('div', { className: 'legend' }, series.map((s) => el('span', { className: 'legend-item' }, [
      el('span', { className: 'key-line', style: `background:${s.color}` }),
      `${s.label} (${formatCount(s.total)}${s.error != null ? `, off by ${Math.round(s.error * 100)} pts on average` : ''})`,
    ])));
    card.appendChild(legend);
    const holder = el('div', { className: 'chart chart-square' });
    card.appendChild(holder);
    const width = Math.min(holder.clientWidth || 520, 560);
    const height = 300;
    const margin = { top: 12, right: 16, bottom: 36, left: 44 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const xAt = (v) => margin.left + v * plotW;
    const yAt = (v) => margin.top + (1 - v) * plotH;
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Calibration: predicted chance against observed rate' });
    holder.appendChild(svg);
    [0, 0.25, 0.5, 0.75, 1].forEach((v, i) => {
      const y = Math.round(yAt(v)) + 0.5;
      svg.appendChild(svgEl('line', { class: i === 0 ? 'base-line' : 'grid-line', x1: margin.left, x2: width - margin.right, y1: y, y2: y }));
      svg.appendChild(svgText({ class: 'axis-text', x: margin.left - 8, y: y + 4, 'text-anchor': 'end' }, `${v * 100}%`));
      svg.appendChild(svgText({ class: 'axis-text', x: xAt(v), y: height - 18, 'text-anchor': i === 0 ? 'start' : i === 4 ? 'end' : 'middle' }, `${v * 100}%`));
    });
    svg.appendChild(svgText({ class: 'axis-text', x: margin.left + plotW / 2, y: height - 2, 'text-anchor': 'middle' }, 'Predicted chance'));
    svg.appendChild(svgEl('line', { class: 'ref-line', x1: xAt(0), y1: yAt(0), x2: xAt(1), y2: yAt(1), 'stroke-dasharray': '4 4' }));

    const tip = makeTooltip(holder);
    const any = series.some((s) => s.points.length);
    if (!any) {
      svg.appendChild(svgText({ class: 'empty', x: width / 2, y: height / 2, 'text-anchor': 'middle' }, 'No signals with a prediction yet'));
    }
    series.forEach((s) => {
      if (s.points.length > 1) {
        svg.appendChild(svgEl('polyline', {
          class: 'series-line', stroke: s.color, points: s.points.map((p) => `${xAt(p.predicted)},${yAt(p.observed)}`).join(' '),
        }));
      }
      s.points.forEach((p) => {
        const dot = svgEl('circle', { class: 'dot', cx: xAt(p.predicted), cy: yAt(p.observed), r: 5, fill: s.color });
        svg.appendChild(dot);
        const hit = svgEl('circle', { cx: xAt(p.predicted), cy: yAt(p.observed), r: 12, fill: 'transparent', tabindex: '0' });
        const show = () => {
          const rect = svg.getBoundingClientRect();
          tip.show(s.label, [
            { color: s.color, value: pct(p.predicted), label: 'predicted' },
            { value: pct(p.observed), label: 'happened' },
            { value: formatCount(p.n), label: 'signals' },
          ], (xAt(p.predicted) / width) * rect.width, (yAt(p.observed) / height) * rect.height);
        };
        hit.addEventListener('mouseenter', show);
        hit.addEventListener('focus', show);
        hit.addEventListener('mouseleave', () => tip.hide());
        hit.addEventListener('blur', () => tip.hide());
        svg.appendChild(hit);
      });
    });

    tableToggle(card, () => table([
      { label: 'Signal', render: (r) => r.label },
      { label: 'Predicted', num: true, render: (r) => pct(r.predicted) },
      { label: 'Happened', num: true, render: (r) => pct(r.observed) },
      { label: 'Signals', num: true, render: (r) => formatCount(r.n) },
    ], series.flatMap((s) => s.points.map((p) => ({ ...p, label: s.label }))), 'No rows'));
  }

  // ─── Data & auth ──────────────────────────────────────────────────────────

  function render(data) {
    state.data = data;
    renderReaders(data);
    renderReader(data);
    renderCalibration(data);
    $('updated-at').textContent = `Updated ${new Date(data.generated_at).toLocaleTimeString()}`;
  }

  const showError = (message) => {
    $('error-banner').textContent = message || '';
    $('error-banner').classList.toggle('hidden', !message);
  };

  async function load() {
    if (state.loading) return;
    state.loading = true;
    $('content').classList.add('is-loading');
    try {
      if (demoMode) {
        render(window.NoeulLevelDemo.build({ days: state.days, language: state.language, user: state.user }));
        showError('');
        return;
      }
      const { data, error } = await state.client.rpc('admin_level_model', {
        p_user: state.user || null,
        p_language: state.language || null,
        p_days: state.days,
      });
      if (error) {
        if (error.code === '42501') {
          showError('This account is not an admin. Add it to admin_users in Supabase.');
          return;
        }
        if (error.code === 'PGRST202' || /admin_level_model/.test(error.message || '')) {
          showError('The level model function is missing. Apply supabase/user_ability_log.sql in the Supabase SQL editor.');
          return;
        }
        throw error;
      }
      showError('');
      render(data);
    } catch (error) {
      showError(`Could not load data: ${error?.message || error}.`);
    } finally {
      state.loading = false;
      $('content').classList.remove('is-loading');
    }
  }

  function syncControls() {
    document.querySelectorAll('#range-control button').forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.days) === state.days));
    });
    $('language-control').value = state.language;
  }

  function wire() {
    document.querySelectorAll('#range-control button').forEach((button) => {
      button.addEventListener('click', () => {
        state.days = Number(button.dataset.days);
        writePrefs();
        syncControls();
        load();
      });
    });
    $('language-control').addEventListener('change', (event) => {
      state.language = event.target.value;
      writePrefs();
      load();
    });
    $('user-control').addEventListener('change', (event) => {
      state.user = event.target.value;
      writePrefs();
      load();
    });
    $('refresh-btn').addEventListener('click', () => load());
    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { if (state.data) render(state.data); }, 150);
    });
  }

  async function init() {
    wire();
    syncControls();
    const show = () => {
      $('signin-view').classList.add('hidden');
      $('dashboard-view').classList.remove('hidden');
      $('demo-banner').classList.toggle('hidden', !demoMode);
      if (demoMode) $('nav-overview').setAttribute('href', './?demo=1');
      load();
    };
    if (demoMode) {
      show();
      return;
    }
    if (!config?.supabaseUrl || !config?.supabaseAnonKey || !window.supabase) {
      $('signin-view').classList.remove('hidden');
      return;
    }
    state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, storageKey: 'noeul-admin-auth' },
    });
    const { data } = await state.client.auth.getSession();
    if (data?.session) show();
    else $('signin-view').classList.remove('hidden');
  }

  init();
})();
