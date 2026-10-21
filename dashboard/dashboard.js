// Noeul admin dashboard.
//
// Data comes from one Supabase RPC, public.admin_dashboard(p_days,
// p_environment) (supabase/app_telemetry.sql). The page signs in with the
// project's public anon key; the function itself refuses anyone who is not in
// public.admin_users, so no privileged key ever reaches the browser.
(function () {
  const { renderChartCard, formatCount, formatDay, el } = window.NoeulCharts;

  // Health thresholds. Tune these as you learn what normal looks like.
  const THRESHOLDS = {
    crashFree: { good: 0.995, warning: 0.99 }, // share of sessions without a crash
    startupP95Ms: { good: 2500, warning: 4000 }, // JS start -> first screen
    freezesPerSession: { good: 0.1, warning: 0.3 },
    newCrashHours: 48, // a crash first seen this recently is flagged as new
    silenceHours: 24, // no telemetry for this long means something is off
    minSessionsForVersionCheck: 20,
  };
  const AUTO_REFRESH_MS = 5 * 60 * 1000;
  const PREFS_KEY = 'noeul-admin-prefs';

  const params = new URLSearchParams(window.location.search);
  const demoMode = params.has('demo');
  const config = window.NOEUL_DASHBOARD_CONFIG;

  const $ = (id) => document.getElementById(id);

  const readPrefs = () => {
    try { return JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
  };
  const writePrefs = (prefs) => {
    try { window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* storage unavailable */ }
  };

  const state = {
    days: [7, 30, 90].includes(readPrefs().days) ? readPrefs().days : 30,
    environment: ['production', 'development', 'all'].includes(readPrefs().environment) ? readPrefs().environment : 'production',
    data: null,
    client: null,
    loading: false,
    userSort: { key: 'last_seen', dir: -1 },
    userQuery: '',
  };

  // ─── Formatting ───────────────────────────────────────────────────────────

  const pct = (value, digits = 1) => (value == null ? '–' : `${(value * 100).toFixed(digits)}%`);
  const seconds = (ms) => (ms == null ? '–' : `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`);
  const shortId = (id) => (id ? String(id).slice(0, 8) : '–');

  const relative = (iso) => {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours} h ago`;
    const days = Math.round(hours / 24);
    if (days < 60) return `${days} d ago`;
    return formatDay(new Date(iso).toISOString().slice(0, 10), true);
  };

  const absolute = (iso) => (iso ? new Date(iso).toLocaleString() : '');

  // ─── Health status ────────────────────────────────────────────────────────

  const STATUS_TEXT = { good: 'Healthy', warning: 'Watch', serious: 'Degraded', critical: 'Critical' };
  const STATUS_ICON = { good: '✓', warning: '!', serious: '!', critical: '✕' };

  const statusBadge = (level, label = STATUS_TEXT[level]) => el('span', { className: `status status-${level}` }, [
    el('span', { className: 'status-icon', 'aria-hidden': 'true', text: STATUS_ICON[level] }),
    el('span', { text: label }),
  ]);

  const crashFreeLevel = (rate) => {
    if (rate == null) return null;
    if (rate >= THRESHOLDS.crashFree.good) return 'good';
    if (rate >= THRESHOLDS.crashFree.warning) return 'warning';
    return 'critical';
  };
  const startupLevel = (ms) => {
    if (ms == null) return null;
    if (ms <= THRESHOLDS.startupP95Ms.good) return 'good';
    if (ms <= THRESHOLDS.startupP95Ms.warning) return 'warning';
    return 'serious';
  };
  const freezeLevel = (perSession) => {
    if (perSession == null) return null;
    if (perSession <= THRESHOLDS.freezesPerSession.good) return 'good';
    if (perSession <= THRESHOLDS.freezesPerSession.warning) return 'warning';
    return 'serious';
  };

  function buildAlerts(data) {
    const h = data.health;
    const alerts = [];
    const freezes = h.sessions ? h.stalls / h.sessions : null;

    const lastEventAge = h.last_event_at ? (Date.now() - new Date(h.last_event_at).getTime()) / 3600e3 : null;
    if (lastEventAge == null) {
      alerts.push({
        level: 'warning',
        title: 'No app telemetry yet',
        detail: 'Crash and performance numbers appear once a build with telemetry is used and can reach Supabase.',
      });
    } else if (lastEventAge > THRESHOLDS.silenceHours) {
      alerts.push({
        level: 'warning',
        title: `No telemetry for ${Math.round(lastEventAge)} hours`,
        detail: 'Either nobody opened the app or uploads are failing.',
      });
    }

    const cf = crashFreeLevel(h.crash_free_rate);
    if (cf && cf !== 'good') {
      alerts.push({
        level: cf,
        title: `Crash-free sessions at ${pct(h.crash_free_rate, 2)}`,
        detail: `Target is ${pct(THRESHOLDS.crashFree.good)}. ${formatCount(h.crashed_sessions)} of ${formatCount(h.sessions)} sessions crashed.`,
      });
    }

    const newCrashes = (data.crash_groups || []).filter((g) => g.event_type === 'crash'
      && (Date.now() - new Date(g.first_seen).getTime()) / 3600e3 <= THRESHOLDS.newCrashHours);
    newCrashes.slice(0, 3).forEach((g) => alerts.push({
      level: 'critical',
      title: 'New crash',
      detail: `${g.message} · ${formatCount(g.occurrences)}× for ${formatCount(g.users)} users, first seen ${relative(g.first_seen)}`,
    }));

    (data.versions || [])
      .filter((v) => v.sessions >= THRESHOLDS.minSessionsForVersionCheck)
      .forEach((v) => {
        const rate = 1 - v.crashed_sessions / v.sessions;
        const level = crashFreeLevel(rate);
        if (level === 'critical') {
          alerts.push({
            level,
            title: `Version ${v.app_version} is crashing`,
            detail: `${pct(rate, 2)} crash-free across ${formatCount(v.sessions)} sessions.`,
          });
        }
      });

    const st = startupLevel(h.startup_p95_ms);
    if (st && st !== 'good') {
      alerts.push({
        level: st,
        title: `Slow startup: 95th percentile ${seconds(h.startup_p95_ms)}`,
        detail: `Target is under ${seconds(THRESHOLDS.startupP95Ms.good)} from launch to the first screen.`,
      });
    }

    const fz = freezeLevel(freezes);
    if (fz && fz !== 'good') {
      const worst = (data.stall_screens || [])[0];
      alerts.push({
        level: fz,
        title: `Frequent freezes: ${(freezes * 100).toFixed(0)} per 100 sessions`,
        detail: worst ? `Most often on ${worst.screen} (${formatCount(worst.stalls)} freezes, longest ${seconds(worst.max_ms)}).` : '',
      });
    }

    if (!alerts.length || alerts.every((a) => a.level === 'good')) {
      alerts.push({ level: 'good', title: 'All health checks passing', detail: 'Crash-free rate, startup time and freezes are within targets.' });
    }
    const order = { critical: 0, serious: 1, warning: 2, good: 3 };
    return alerts.sort((a, b) => order[a.level] - order[b.level]);
  }

  // ─── Rendering ────────────────────────────────────────────────────────────

  const tile = (label, value, foot = []) => el('div', { className: 'tile' }, [
    el('div', { className: 'tile-label', text: label }),
    el('div', { className: 'tile-value', text: value }),
    foot.length ? el('div', { className: 'tile-foot' }, foot) : null,
  ]);

  const sectionCard = (container, title, subtitle, body, extra = null) => {
    container.replaceChildren(
      el('div', { className: 'card-head' }, [
        el('div', {}, [
          el('h3', { className: 'card-title', text: title }),
          subtitle ? el('p', { className: 'card-sub', text: subtitle }) : null,
        ]),
        extra,
      ]),
      body
    );
  };

  const table = (columns, rows, emptyText, { tall = false } = {}) => {
    if (!rows.length) return el('div', { className: 'empty-state', text: emptyText });
    return el('div', { className: `table-wrap${tall ? ' tall' : ''}` }, el('table', {}, [
      el('thead', {}, el('tr', {}, columns.map((c) => el('th', { className: c.num ? 'num' : '', text: c.label })))),
      el('tbody', {}, rows.map((row) => el('tr', {}, columns.map((c) => {
        const value = c.render(row);
        const cell = el('td', { className: [c.num ? 'num' : '', c.nowrap ? 'nowrap' : ''].join(' ').trim() || null });
        if (value instanceof Node) cell.appendChild(value);
        else cell.textContent = value == null ? '–' : String(value);
        return cell;
      })))),
    ]));
  };

  function renderAlerts(data) {
    $('alerts').replaceChildren(...buildAlerts(data).map((a) => el('div', { className: 'alert' }, [
      statusBadge(a.level),
      el('div', {}, [
        el('div', { className: 'alert-title', text: a.title }),
        a.detail ? el('div', { className: 'alert-detail', text: a.detail }) : null,
      ]),
    ])));
  }

  function renderOverview(data) {
    const u = data.users;
    const h = data.health;
    $('hero').replaceChildren(
      el('div', { className: 'hero-label', text: 'Weekly active users' }),
      el('div', { className: 'hero-value', text: formatCount(u.active_7d) }),
      el('div', { className: 'hero-sub', text: `${formatCount(u.active_1d)} today · ${formatCount(u.active_30d)} in the last 30 days` })
    );

    const freezesPerSession = h.sessions ? h.stalls / h.sessions : null;
    const cf = crashFreeLevel(h.crash_free_rate);
    const st = startupLevel(h.startup_p95_ms);
    const fz = freezeLevel(freezesPerSession);
    $('tiles').replaceChildren(
      tile('Total users', formatCount(u.total), [`${formatCount(u.registered)} registered · ${formatCount(u.anonymous)} guest`]),
      tile(`New users, ${data.range.days} days`, formatCount(u.new_in_range), [`${formatCount(u.active_in_range)} active in range`]),
      tile('Crash-free sessions', pct(h.crash_free_rate, 2), cf ? [statusBadge(cf)] : ['No sessions yet']),
      tile('Startup time, 95th pct', seconds(h.startup_p95_ms), st ? [statusBadge(st), `median ${seconds(h.startup_p50_ms)}`] : ['No data yet']),
      tile('Crashes', formatCount(h.crashes), [`${formatCount(h.errors)} non-fatal errors`]),
      tile('UI freezes', formatCount(h.stalls), fz ? [statusBadge(fz), `${(freezesPerSession * 100).toFixed(0)} per 100 sessions`] : ['No data yet']),
      tile('Books in libraries', formatCount(data.content.books), ['synced to the cloud']),
      tile('Saved words', formatCount(data.content.vocab), [`${formatCount(data.content.interaction_events_in_range)} study events in range`])
    );
  }

  function renderCharts(data) {
    const days = data.daily.map((d) => d.day);
    const pick = (key) => data.daily.map((d) => (d[key] == null ? null : Number(d[key])));

    renderChartCard($('chart-active'), {
      title: 'Daily active users',
      subtitle: 'Users who opened the app or studied that day',
      type: 'line',
      days,
      series: [{ label: 'Active users', color: '--series-1', values: pick('active_users') }],
    });

    renderChartCard($('chart-new'), {
      title: 'New users per day',
      subtitle: 'Guests are anonymous installs that have not signed up',
      type: 'columns',
      days,
      series: [
        { label: 'Registered', color: '--series-1', values: pick('new_registered') },
        { label: 'Guest', color: '--series-2', values: data.daily.map((d) => Math.max(0, d.new_users - d.new_registered)) },
      ],
    });

    renderChartCard($('chart-learning'), {
      title: 'Study events per day',
      subtitle: 'Dictionary lookups, flashcard reviews and saved words',
      type: 'line',
      days,
      series: [
        { label: 'Lookups', color: '--series-1', values: pick('lookups') },
        { label: 'Reviews', color: '--series-2', values: pick('reviews') },
        { label: 'Saves', color: '--series-3', values: pick('saves') },
      ],
    });

    renderChartCard($('chart-crashes'), {
      title: 'Crashes and errors per day',
      type: 'columns',
      days,
      series: [
        { label: 'Crashes', color: '--series-1', values: pick('crashes') },
        { label: 'Errors', color: '--series-2', values: pick('errors') },
      ],
      emptyText: 'No crashes or errors in this range',
    });

    renderChartCard($('chart-startup'), {
      title: 'Startup time',
      subtitle: 'From app code starting to the first screen showing',
      type: 'line',
      days,
      series: [
        { label: 'Median', color: '--series-1', values: pick('startup_p50_ms') },
        { label: '95th percentile', color: '--series-2', values: pick('startup_p95_ms') },
      ],
      valueFormat: seconds,
      yFormat: (ms) => `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)}s`,
      refLine: { value: THRESHOLDS.startupP95Ms.good, label: `Target ${seconds(THRESHOLDS.startupP95Ms.good)}` },
      emptyText: 'No startup measurements yet',
    });
  }

  function barList(items, labelKey, valueKey) {
    const max = Math.max(...items.map((i) => i[valueKey]), 1);
    return el('div', { className: 'bar-list' }, items.map((item) => el('div', { className: 'bar-row' }, [
      el('span', { text: String(item[labelKey]) }),
      el('div', { className: 'bar-track', title: `${item[labelKey]}: ${formatCount(item[valueKey])}` },
        el('div', { className: 'bar-fill', style: `width:${(item[valueKey] / max) * 100}%` })),
      el('span', { className: 'num', style: 'text-align:right', text: formatCount(item[valueKey]) }),
    ])));
  }

  function renderBreakdowns(data) {
    const langs = data.target_languages || [];
    const plats = data.platforms || [];
    const deviceLangs = data.device_languages || [];
    const uiLangs = data.interface_languages || [];
    const body = el('div', {}, [
      langs.length ? barList(langs, 'language', 'users') : el('div', { className: 'empty-state', text: 'No language preferences synced yet.' }),
      el('h3', { className: 'card-title', style: 'margin:20px 0 8px', text: 'Platforms' }),
      el('p', { className: 'card-sub', style: 'margin:-6px 0 10px', text: 'Users who opened the app in this range' }),
      plats.length ? barList(plats, 'platform', 'users') : el('div', { className: 'empty-state', text: 'No app launches recorded yet.' }),
      el('h3', { className: 'card-title', style: 'margin:20px 0 8px', text: 'Phone languages' }),
      el('p', { className: 'card-sub', style: 'margin:-6px 0 10px', text: 'System language of users who opened the app in this range' }),
      deviceLangs.length ? barList(deviceLangs, 'language', 'users') : el('div', { className: 'empty-state', text: 'No phone languages recorded yet.' }),
      el('h3', { className: 'card-title', style: 'margin:20px 0 8px', text: 'App languages' }),
      el('p', { className: 'card-sub', style: 'margin:-6px 0 10px', text: 'Interface language saved on each account' }),
      uiLangs.length ? barList(uiLangs, 'language', 'users') : el('div', { className: 'empty-state', text: 'No interface languages synced yet.' }),
    ]);
    sectionCard($('languages'), 'Target languages', 'Language each user is learning', body);
  }

  function renderStability(data) {
    sectionCard($('versions'), 'App versions', 'Most recent first', table([
      { label: 'Version', render: (v) => v.app_version },
      { label: 'Sessions', num: true, render: (v) => formatCount(v.sessions) },
      {
        label: 'Crash-free',
        render: (v) => {
          if (!v.sessions) return '–';
          const rate = 1 - v.crashed_sessions / v.sessions;
          const wrap = el('span', { style: 'display:inline-flex;gap:8px;align-items:center' }, [el('span', { text: pct(rate, 2) })]);
          if (v.sessions >= THRESHOLDS.minSessionsForVersionCheck) wrap.appendChild(statusBadge(crashFreeLevel(rate)));
          return wrap;
        },
      },
      { label: 'Freezes', num: true, render: (v) => formatCount(v.stalls) },
      { label: 'Startup p95', num: true, render: (v) => seconds(v.startup_p95_ms) },
      { label: 'Last seen', nowrap: true, render: (v) => relative(v.last_seen) },
    ], data.versions || [], 'No app versions have reported yet.'));

    const groups = data.crash_groups || [];
    sectionCard($('crash-groups'), 'Top crashes and errors', 'Grouped by message. Open a row to see the latest stack trace.', table([
      {
        label: 'Type',
        render: (g) => {
          const isNew = (Date.now() - new Date(g.first_seen).getTime()) / 3600e3 <= THRESHOLDS.newCrashHours;
          return el('span', { style: 'display:inline-flex;gap:6px;flex-wrap:wrap' }, [
            el('span', { className: 'pill', text: g.event_type === 'crash' ? 'Crash' : 'Error' }),
            isNew ? el('span', { className: 'pill', text: 'New' }) : null,
          ]);
        },
      },
      {
        label: 'Message',
        render: (g) => el('div', {}, [
          el('div', { className: 'mono', text: g.message }),
          g.latest_stack ? el('details', { className: 'stack' }, [
            el('summary', { text: 'Stack trace' }),
            el('pre', { className: 'mono', text: g.latest_stack }),
          ]) : null,
        ]),
      },
      { label: 'Count', num: true, render: (g) => formatCount(g.occurrences) },
      { label: 'Users', num: true, render: (g) => formatCount(g.users) },
      { label: 'Screen', render: (g) => g.latest_screen || '–' },
      { label: 'Version', render: (g) => g.latest_version || '–' },
      { label: 'Last seen', nowrap: true, render: (g) => el('span', { title: absolute(g.last_seen), text: relative(g.last_seen) }) },
    ], groups, 'No crashes or errors in this range.'));
  }

  function renderPerformance(data) {
    sectionCard($('stall-screens'), 'Freezes by screen', 'Where the app stopped responding for a second or more', table([
      { label: 'Screen', render: (s) => s.screen },
      { label: 'Freezes', num: true, render: (s) => formatCount(s.stalls) },
      { label: 'Users', num: true, render: (s) => formatCount(s.users) },
      { label: 'Typical', num: true, render: (s) => seconds(s.p50_ms) },
      { label: 'Longest', num: true, render: (s) => seconds(s.max_ms) },
    ], data.stall_screens || [], 'No freezes recorded in this range.'));
  }

  const EVENT_LABEL = { crash: 'Crash', error: 'Error', js_stall: 'Freeze' };

  function renderRecent(data) {
    sectionCard($('recent'), 'Latest crashes, errors and freezes', null, table([
      { label: 'When', nowrap: true, render: (e) => el('span', { title: absolute(e.occurred_at), text: relative(e.occurred_at) }) },
      { label: 'Type', render: (e) => el('span', { className: 'pill', text: EVENT_LABEL[e.event_type] || e.event_type }) },
      {
        label: 'Detail',
        render: (e) => (e.event_type === 'js_stall'
          ? `Unresponsive for ${seconds(e.duration_ms)}`
          : el('span', { className: 'mono', text: e.message || '(no message)' })),
      },
      { label: 'Screen', render: (e) => e.screen || '–' },
      { label: 'Build', render: (e) => [e.app_version, e.platform, e.device_model].filter(Boolean).join(' · ') || '–' },
      { label: 'User', render: (e) => el('span', { className: 'mono', title: e.user_id, text: shortId(e.user_id) }) },
    ], data.recent_events || [], 'Nothing has gone wrong in this range.', { tall: true }));
  }

  const USER_COLUMNS = [
    {
      key: 'email', label: 'User',
      render: (u) => el('div', {}, [
        el('div', { text: u.email || 'Guest' }),
        el('div', { className: 'muted mono', title: u.id, text: shortId(u.id) }),
      ]),
      sortValue: (u) => (u.email || '~').toLowerCase(),
    },
    { key: 'created_at', label: 'Joined', nowrap: true, render: (u) => el('span', { title: absolute(u.created_at), text: relative(u.created_at) }) },
    { key: 'last_seen', label: 'Last seen', nowrap: true, render: (u) => el('span', { title: absolute(u.last_seen), text: relative(u.last_seen) }) },
    { key: 'platform', label: 'Device', render: (u) => [u.platform, u.app_version, u.device_model].filter(Boolean).join(' · ') || '–' },
    { key: 'target_language', label: 'Learning', render: (u) => u.target_language || '–' },
    { key: 'books', label: 'Books', num: true, render: (u) => formatCount(u.books) },
    { key: 'vocab', label: 'Words', num: true, render: (u) => formatCount(u.vocab) },
    { key: 'crashes', label: 'Crashes', num: true, render: (u) => formatCount(u.crashes) },
    { key: 'stalls', label: 'Freezes', num: true, render: (u) => formatCount(u.stalls) },
  ];

  function renderUserList(data) {
    const query = state.userQuery.trim().toLowerCase();
    const { key, dir } = state.userSort;
    const column = USER_COLUMNS.find((c) => c.key === key);
    const valueOf = column?.sortValue || ((u) => u[key] ?? (dir > 0 ? Infinity : -Infinity));
    const rows = (data.user_list || [])
      .filter((u) => !query || [u.email, u.id, u.platform, u.device_model, u.app_version, u.target_language]
        .some((v) => v && String(v).toLowerCase().includes(query)))
      .sort((a, b) => {
        const av = valueOf(a);
        const bv = valueOf(b);
        if (av === bv) return 0;
        return (av > bv ? 1 : -1) * dir;
      });

    const search = el('input', {
      className: 'search', type: 'search', placeholder: 'Search email, id, device', value: state.userQuery,
      'aria-label': 'Search users',
    });
    search.addEventListener('input', () => {
      state.userQuery = search.value;
      const pos = search.selectionStart;
      renderUserList(state.data);
      const next = $('user-list').querySelector('input.search');
      next.focus();
      next.setSelectionRange(pos, pos);
    });

    const head = el('tr', {}, USER_COLUMNS.map((c) => {
      const active = c.key === key;
      const th = el('th', {
        className: `sortable${c.num ? ' num' : ''}`,
        tabindex: 0,
        'aria-sort': active ? (dir > 0 ? 'ascending' : 'descending') : 'none',
        text: `${c.label}${active ? (dir > 0 ? ' ↑' : ' ↓') : ''}`,
      });
      const sort = () => {
        state.userSort = { key: c.key, dir: active ? -dir : (c.num || c.key.endsWith('_at') || c.key === 'last_seen' ? -1 : 1) };
        renderUserList(state.data);
      };
      th.addEventListener('click', sort);
      th.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); sort(); } });
      return th;
    }));

    const body = rows.length
      ? el('div', { className: 'table-wrap tall' }, el('table', {}, [
        el('thead', {}, head),
        el('tbody', {}, rows.map((u) => el('tr', {}, USER_COLUMNS.map((c) => {
          const value = c.render(u);
          const cell = el('td', { className: [c.num ? 'num' : '', c.nowrap ? 'nowrap' : ''].join(' ').trim() || null });
          if (value instanceof Node) cell.appendChild(value); else cell.textContent = value;
          return cell;
        })))),
      ]))
      : el('div', { className: 'empty-state', text: query ? 'No users match that search.' : 'No users yet.' });

    const total = (data.user_list || []).length;
    sectionCard(
      $('user-list'),
      `${formatCount(total)} users${total >= 500 ? ' (most recently active 500)' : ''}`,
      'Guests are anonymous accounts created on first launch.',
      body,
      search
    );
  }

  function render(data) {
    state.data = data;
    renderAlerts(data);
    renderOverview(data);
    renderCharts(data);
    renderBreakdowns(data);
    renderStability(data);
    renderPerformance(data);
    renderRecent(data);
    renderUserList(data);
    $('updated-at').textContent = `Updated ${new Date(data.generated_at).toLocaleTimeString()}`;
  }

  // ─── Data & auth ──────────────────────────────────────────────────────────

  const showError = (message) => {
    const banner = $('error-banner');
    banner.textContent = message || '';
    banner.classList.toggle('hidden', !message);
  };

  const showView = (name) => {
    $('signin-view').classList.toggle('hidden', name !== 'signin');
    $('dashboard-view').classList.toggle('hidden', name !== 'dashboard');
  };

  async function load() {
    if (state.loading) return;
    state.loading = true;
    $('content').classList.add('is-loading');
    try {
      if (demoMode) {
        render(window.NoeulDemo.buildDemoDashboard(state.days, state.environment));
        showError('');
        return;
      }
      const { data, error } = await state.client.rpc('admin_dashboard', {
        p_days: state.days,
        p_environment: state.environment,
      });
      if (error) {
        if (error.code === '42501') {
          await state.client.auth.signOut();
          showSignin('This account is not an admin. Add it to admin_users in Supabase.');
          return;
        }
        if (error.code === 'PGRST202' || /admin_dashboard/.test(error.message || '')) {
          showError('The dashboard function is missing. Apply supabase/app_telemetry.sql in the Supabase SQL editor.');
          return;
        }
        throw error;
      }
      showError('');
      render(data);
    } catch (error) {
      showError(`Could not load data: ${error?.message || error}. Showing the last loaded numbers.`);
    } finally {
      state.loading = false;
      $('content').classList.remove('is-loading');
    }
  }

  function syncFilterControls() {
    document.querySelectorAll('#range-control button').forEach((button) => {
      button.setAttribute('aria-pressed', String(Number(button.dataset.days) === state.days));
    });
    $('env-control').value = state.environment;
  }

  function showDashboard() {
    showView('dashboard');
    $('demo-banner').classList.toggle('hidden', !demoMode);
    $('signout-btn').classList.toggle('hidden', demoMode);
    if (demoMode) $('nav-level').setAttribute('href', 'level.html?demo=1');
    syncFilterControls();
    load();
  }

  function showSignin(message = '') {
    showView('signin');
    $('signin-error').textContent = message;
    if (!config?.supabaseUrl || !config?.supabaseAnonKey) {
      $('config-note').textContent = 'config.js is missing, so sign-in is disabled. ';
      $('signin-submit').disabled = true;
    }
  }

  function wireControls() {
    document.querySelectorAll('#range-control button').forEach((button) => {
      button.addEventListener('click', () => {
        state.days = Number(button.dataset.days);
        writePrefs({ days: state.days, environment: state.environment });
        syncFilterControls();
        load();
      });
    });
    $('env-control').addEventListener('change', (event) => {
      state.environment = event.target.value;
      writePrefs({ days: state.days, environment: state.environment });
      load();
    });
    $('refresh-btn').addEventListener('click', () => load());
    $('signout-btn').addEventListener('click', async () => {
      await state.client?.auth.signOut();
      state.data = null;
      showSignin();
    });
    $('signin-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = $('email').value.trim();
      const password = $('password').value;
      if (!email || !password) {
        $('signin-error').textContent = 'Enter your email and password.';
        return;
      }
      $('signin-submit').disabled = true;
      $('signin-error').textContent = '';
      const { error } = await state.client.auth.signInWithPassword({ email, password });
      $('signin-submit').disabled = false;
      if (error) {
        $('signin-error').textContent = error.message;
        return;
      }
      $('password').value = '';
      showDashboard();
    });

    setInterval(() => {
      if (document.visibilityState === 'visible' && !$('dashboard-view').classList.contains('hidden')) load();
    }, AUTO_REFRESH_MS);
  }

  async function init() {
    wireControls();
    if (demoMode) {
      showDashboard();
      return;
    }
    if (!config?.supabaseUrl || !config?.supabaseAnonKey || !window.supabase) {
      showSignin();
      return;
    }
    state.client = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, storageKey: 'noeul-admin-auth' },
    });
    const { data } = await state.client.auth.getSession();
    if (data?.session) showDashboard();
    else showSignin();
  }

  init();
})();
