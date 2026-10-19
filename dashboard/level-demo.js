// Sample data for the Level model page (?demo=1): a few simulated readers
// whose level moves the way the app's level engine moves it. Not real users.
(function () {
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));
  const rng = (seed) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const WORDS = {
    ko: ['소문', '간통', '살인', '도적', '감자', '공동묘지', '칠성문', '부처', '비극', '컴퓨터', '아이러니', '손가락', '학교', '사람', '먹다', '공부하다', '빈민굴', '근원지', '송충이', '막벌이'],
    zh: ['厮杀', '呐喊', '咖啡', '沙发', '我们', '杀手', '寂寞', '铁屋', '彷徨', '鲁迅', '故乡', '闰土', '猹', '月亮', '西瓜', '少年', '项带', '银圈', '手捏', '钢叉'],
  };

  const READERS = [
    { user_id: 'demo-0001-aaaa', email: 'reader.one@example.com', language: 'ko', start: -0.6, truth: 0.9, lookupRate: 0.7 },
    { user_id: 'demo-0002-bbbb', email: null, is_anonymous: true, language: 'zh', start: 0.0, truth: -0.8, lookupRate: 0.35 },
    { user_id: 'demo-0003-cccc', email: 'reader.three@example.com', language: 'ko', start: 1.2, truth: 1.4, lookupRate: 0.5 },
  ];

  function simulate(reader, days) {
    const random = rng(reader.user_id.length * 7919 + days);
    const now = Date.now();
    const start = now - days * 86400000;
    let theta = reader.start;
    let variance = 0.6;
    const log = [{
      created_at: new Date(start).toISOString(), signal: 'seed', theta_before: 0, theta_after: theta,
      var_before: 2, var_after: variance, details: { nearestRank: 3 },
    }];
    const words = WORDS[reader.language];
    const steps = Math.min(900, days * 30);
    for (let i = 0; i < steps; i += 1) {
      const t = start + ((i + 1) / steps) * (now - start - 3600000);
      const word = words[Math.floor(random() * words.length)];
      const difficulty = -2.5 + random() * 5.5;
      const known = random() < sigmoid(reader.truth - difficulty);
      const roll = random();
      let signal;
      let outcome;
      if (i % 40 === 20) {
        signal = 'check';
        outcome = known ? 1 : 0;
      } else if (!known && roll < reader.lookupRate) {
        signal = 'lookup';
        outcome = 1;
      } else if (random() < 0.4) {
        signal = 'pass';
        outcome = 0;
      } else {
        continue;
      }
      const pk = sigmoid(theta - difficulty);
      const hit = signal === 'check' ? 0.97 : 0.03;
      const fa = signal === 'check' ? 0.05 : reader.lookupRate;
      const pObserved = hit * pk + fa * (1 - pk);
      const direction = (signal === 'check' ? (outcome ? 1 : -1) : (signal === 'lookup' ? -1 : 1));
      const strength = signal === 'check' ? 0.9 : 0.35;
      const step = direction * strength * variance * pk * (1 - pk) * (direction > 0 ? (1 - pk) * 2 : pk * 2);
      const before = theta;
      const varBefore = variance;
      theta = Math.max(-3, Math.min(3, theta + step));
      variance = Math.max(0.03, variance * (signal === 'check' ? 0.97 : 0.993));
      log.push({
        created_at: new Date(t).toISOString(),
        signal,
        word,
        stem: word,
        outcome,
        difficulty,
        p_known: pk,
        p_observed: pObserved,
        theta_before: before,
        theta_after: theta,
        var_before: varBefore,
        var_after: variance,
        lookup_rate: reader.lookupRate,
        guess_rate: 0.05,
        source_book_uri: reader.language === 'ko' ? 'book://gamja' : 'book://nahan',
        details: { levelRank: 1 + Math.round(((difficulty + 3) / 6) * 5), zipf: 6.5 - ((difficulty + 3) / 6) * 4 },
      });
    }
    return log;
  }

  function build({ days = 30, language = '', user = '' } = {}) {
    const logs = new Map(READERS.map((r) => [r.user_id, simulate(r, days)]));
    const users = READERS.map((r) => {
      const log = logs.get(r.user_id);
      const last = log[log.length - 1];
      const count = (s) => log.filter((row) => row.signal === s).length;
      return {
        user_id: r.user_id,
        email: r.email,
        is_anonymous: !!r.is_anonymous,
        language: r.language,
        theta: last.theta_after,
        variance: last.var_after,
        lookup_rate: r.lookupRate,
        guess_rate: 0.05,
        last_at: last.created_at,
        signals: log.length,
        lookups: count('lookup'),
        passes: count('pass'),
        reviews: 0,
        checks: count('check'),
        drift: last.theta_after - log[1].theta_before,
      };
    });
    const calibrationMap = new Map();
    READERS.filter((r) => !language || r.language === language).forEach((r) => {
      logs.get(r.user_id).forEach((row) => {
        if (!['check', 'lookup', 'pass'].includes(row.signal)) return;
        const p = row.signal === 'check' ? row.p_known : row.p_observed;
        const bin = Math.min(9, Math.floor(p * 10));
        const key = `${row.signal}|${bin}`;
        const c = calibrationMap.get(key) || { signal: row.signal, bin, n: 0, sumP: 0, sumY: 0 };
        c.n += 1; c.sumP += p; c.sumY += row.outcome;
        calibrationMap.set(key, c);
      });
    });
    const calibration = Array.from(calibrationMap.values()).map((c) => ({
      signal: c.signal, bin: c.bin, n: c.n, predicted: c.sumP / c.n, observed: c.sumY / c.n,
    }));
    const selected = READERS.find((r) => r.user_id === user && (!language || r.language === language));
    return {
      generated_at: new Date().toISOString(),
      range: { days, since: new Date(Date.now() - days * 86400000).toISOString() },
      users,
      calibration,
      log: selected ? logs.get(selected.user_id) : [],
    };
  }

  window.NoeulLevelDemo = { build };
})();
