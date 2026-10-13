// Sample data for ?demo=1. Same shape as public.admin_dashboard() returns, so
// the preview exercises the real rendering code. Clearly labeled as sample
// data in the UI; nothing here is a real user.
(function () {
  const mulberry32 = (seed) => () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const isoDay = (date) => date.toISOString().slice(0, 10);

  function buildDemoDashboard(days, environment) {
    const rand = mulberry32(42 + days);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const dayList = Array.from({ length: days }, (_, i) => {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - (days - 1 - i));
      return isoDay(d);
    });

    const isDev = environment === 'development';
    const scale = isDev ? 0.04 : 1;
    const daily = dayList.map((day, i) => {
      const growth = 1 + (i / Math.max(days, 1)) * 0.35;
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      const weekend = weekday === 0 || weekday === 6 ? 1.18 : 1;
      const active = Math.round((140 + rand() * 30) * growth * weekend * scale) + (isDev ? 2 : 0);
      const sessions = Math.round(active * (1.7 + rand() * 0.5));
      // One bad release a few days ago to make the stability chart interesting.
      const badRelease = i >= days - 6 && i <= days - 4;
      const crashes = Math.round(sessions * (badRelease ? 0.022 : 0.003 + rand() * 0.003));
      const p50 = Math.round(1100 + rand() * 250 + (badRelease ? 300 : 0));
      return {
        day,
        new_users: Math.round((18 + rand() * 12) * growth * scale),
        new_registered: Math.round((5 + rand() * 5) * growth * scale),
        active_users: active,
        sessions,
        crashes,
        errors: Math.round(sessions * (0.01 + rand() * 0.01)),
        stalls: Math.round(sessions * (0.05 + rand() * 0.05)),
        startup_p50_ms: p50,
        startup_p95_ms: Math.round(p50 * (2.1 + rand() * 0.6)),
        lookups: Math.round(active * (9 + rand() * 4)),
        reviews: Math.round(active * (5 + rand() * 3)),
        saves: Math.round(active * (2 + rand() * 1.5)),
      };
    });

    const sum = (key) => daily.reduce((total, d) => total + (d[key] || 0), 0);
    const sessions = sum('sessions');
    const crashed = Math.round(sum('crashes') * 0.92);
    const sortedStarts = daily.map((d) => d.startup_p50_ms).sort((a, b) => a - b);

    const versions = [
      { app_version: '1.0.3', share: 0.55, crashRate: 0.003 },
      { app_version: '1.0.2', share: 0.3, crashRate: 0.019 },
      { app_version: '1.0.1', share: 0.15, crashRate: 0.004 },
    ].map((v) => {
      const vSessions = Math.round(sessions * v.share);
      const vCrashed = Math.round(vSessions * v.crashRate);
      return {
        app_version: v.app_version,
        sessions: vSessions,
        crashed_sessions: vCrashed,
        crashes: Math.round(vCrashed * 1.1),
        stalls: Math.round(vSessions * 0.07),
        users: Math.round(vSessions / 9),
        startup_p95_ms: Math.round(2600 + rand() * 900),
        last_seen: new Date(Date.now() - rand() * 3600e3).toISOString(),
      };
    });

    const crashMessages = [
      ['crash', "TypeError: Cannot read property 'uri' of undefined", 'Read', '1.0.2'],
      ['crash', 'Error: SQLiteError: database is locked', 'Learn', '1.0.2'],
      ['crash', 'RangeError: Maximum call stack size exceeded', 'Home', '1.0.3'],
      ['error', 'Error: Network request failed', 'Home', '1.0.3'],
      ['error', 'Error: EPUB parse failed: unexpected end of input', 'Read', '1.0.3'],
    ];
    const crashGroups = crashMessages.map(([type, message, screen, version], i) => ({
      event_type: type,
      message,
      occurrences: Math.round((type === 'crash' ? 60 : 140) / (i + 1)),
      users: Math.round((type === 'crash' ? 40 : 90) / (i + 1)),
      first_seen: new Date(Date.now() - (5 + i) * 86400e3).toISOString(),
      last_seen: new Date(Date.now() - i * 5400e3).toISOString(),
      latest_version: version,
      latest_screen: screen,
      latest_stack: `${message}\n    at renderChapter (Read.js:812:24)\n    at commitHookEffectListMount (react-native-renderer.js:2201:26)\n    at flushPassiveEffects (react-native-renderer.js:3011:9)`,
    }));

    const stallScreens = [
      ['Read', 410, 2300, 9100],
      ['Learn', 160, 1500, 4300],
      ['Home', 90, 1300, 3800],
      ['Profile', 12, 1100, 1600],
    ].map(([screen, stalls, p50, max]) => ({
      screen, stalls: Math.round(stalls * scale * days / 30) || 1, users: Math.round(stalls / 4), p50_ms: p50, max_ms: max,
    }));

    const languages = ['ko', 'en', 'zh'];
    const platforms = ['android', 'ios'];
    const models = { android: ['Pixel 8', 'Galaxy S24', 'Pixel 10a'], ios: ['iPhone 15', 'iPhone 13'] };
    const modelFor = (platform) => models[platform][Math.floor(rand() * models[platform].length)];
    const hex = (n) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join('');
    const userList = Array.from({ length: 60 }, (_, i) => {
      const anonymous = rand() < 0.55;
      const platform = platforms[rand() < 0.62 ? 0 : 1];
      return {
        id: `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(12)}`,
        email: anonymous ? null : `reader${i + 1}@example.com`,
        is_anonymous: anonymous,
        created_at: new Date(Date.now() - rand() * 120 * 86400e3).toISOString(),
        last_seen: rand() < 0.9 ? new Date(Date.now() - rand() * 20 * 86400e3).toISOString() : null,
        platform,
        app_version: versions[Math.floor(rand() * versions.length)].app_version,
        device_model: modelFor(platform),
        target_language: languages[Math.floor(rand() * rand() * languages.length)],
        books: Math.floor(rand() * 7),
        vocab: Math.floor(rand() * rand() * 900),
        crashes: rand() < 0.12 ? Math.ceil(rand() * 3) : 0,
        stalls: rand() < 0.4 ? Math.ceil(rand() * 12) : 0,
      };
    }).sort((a, b) => (b.last_seen || '').localeCompare(a.last_seen || ''));

    let clock = Date.now();
    const recent = Array.from({ length: 30 }, () => {
      clock -= 900e3 + rand() * 5400e3;
      const kind = rand();
      const platform = platforms[rand() < 0.62 ? 0 : 1];
      const group = crashGroups[Math.floor(rand() * crashGroups.length)];
      const stall = kind < 0.5;
      return {
        occurred_at: new Date(clock).toISOString(),
        event_type: stall ? 'js_stall' : group.event_type,
        message: stall ? null : group.message,
        screen: stall ? stallScreens[Math.floor(rand() * 3)].screen : group.latest_screen,
        duration_ms: stall ? Math.round(1000 + rand() * 4000) : null,
        user_id: userList[Math.floor(rand() * userList.length)].id,
        app_version: group.latest_version,
        platform,
        device_model: modelFor(platform),
      };
    });

    const totalUsers = Math.round(2840 * (isDev ? 1 : 1));
    const anonymousUsers = Math.round(totalUsers * 0.58);
    return {
      generated_at: new Date().toISOString(),
      range: { days, since: dayList[0], until: dayList[dayList.length - 1], environment },
      users: {
        total: totalUsers,
        anonymous: anonymousUsers,
        registered: totalUsers - anonymousUsers,
        new_in_range: sum('new_users'),
        active_1d: daily[daily.length - 1].active_users,
        // Weekly and monthly actives do not depend on the selected range.
        active_7d: Math.round(daily.slice(-7).reduce((t, d) => t + d.active_users, 0) * 0.42),
        active_30d: Math.round(daily.slice(-7).reduce((t, d) => t + d.active_users, 0) * 0.42 * 2.1),
        active_in_range: Math.round(sum('active_users') * (days <= 7 ? 0.42 : 0.2)),
      },
      content: { books: 4120, vocab: 91340, interaction_events_in_range: sum('lookups') + sum('reviews') + sum('saves') },
      health: {
        sessions,
        crashed_sessions: crashed,
        crash_free_rate: sessions ? 1 - crashed / sessions : null,
        crashes: sum('crashes'),
        errors: sum('errors'),
        stalls: sum('stalls'),
        startup_p50_ms: sortedStarts[Math.floor(sortedStarts.length / 2)],
        startup_p95_ms: Math.round(sortedStarts[sortedStarts.length - 1] * 2.4),
        last_event_at: new Date(Date.now() - 4 * 60e3).toISOString(),
      },
      daily,
      target_languages: [
        { language: 'ko', users: 1710 }, { language: 'en', users: 690 }, { language: 'zh', users: 310 }, { language: '(unset)', users: 130 },
      ],
      platforms: [{ platform: 'android', users: 1760 }, { platform: 'ios', users: 1080 }],
      crash_groups: crashGroups,
      stall_screens: stallScreens,
      versions,
      user_list: userList,
      recent_events: recent,
    };
  }

  window.NoeulDemo = { buildDemoDashboard };
})();
