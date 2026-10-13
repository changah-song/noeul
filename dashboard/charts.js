// Small SVG chart kit for the dashboard: daily line and column charts.
//
// Every chart card gets a legend (for 2+ series), a hover/focus tooltip that
// lists every series at the hovered day, and a table view with the same
// numbers, so nothing depends on color or hover alone. All text goes in via
// textContent.
(function () {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const HEIGHT = 220;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const svgEl = (tag, attrs = {}) => {
    const node = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value != null) node.setAttribute(key, String(value));
    });
    return node;
  };

  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value == null || value === false) return;
      if (key === 'text') node.textContent = value;
      else if (key === 'className') node.className = value;
      else if (key === 'style') node.setAttribute('style', value);
      else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
      else node.setAttribute(key, value === true ? '' : value);
    });
    (Array.isArray(children) ? children : [children]).forEach((child) => {
      if (child == null || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  };

  const formatCount = (value) => {
    if (value == null || Number.isNaN(value)) return '–';
    const abs = Math.abs(value);
    if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1)}M`;
    if (abs >= 1e4) return `${(value / 1e3).toFixed(abs >= 1e5 ? 0 : 1)}K`;
    return Math.round(value).toLocaleString('en-US');
  };

  const formatDay = (iso, withYear = false) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ''}`;
  };

  const niceMax = (max, ticks = 4) => {
    if (!(max > 0)) return ticks;
    const rawStep = max / ticks;
    const magnitude = 10 ** Math.floor(Math.log10(rawStep));
    const residual = rawStep / magnitude;
    const step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
    return Math.max(step * ticks, step);
  };

  const cssVar = (name) => `var(${name})`;

  // Rect with 4px rounded top corners and a square base.
  const roundedTopPath = (x, y, w, h, r = 4) => {
    const radius = Math.max(0, Math.min(r, w / 2, h));
    return [
      `M${x},${y + h}`,
      `V${y + radius}`,
      `Q${x},${y} ${x + radius},${y}`,
      `H${x + w - radius}`,
      `Q${x + w},${y} ${x + w},${y + radius}`,
      `V${y + h}`,
      'Z',
    ].join(' ');
  };

  function buildTooltip(container) {
    const tip = el('div', { className: 'tooltip hidden', role: 'status' });
    container.appendChild(tip);
    return {
      show(title, rows, x, y) {
        tip.replaceChildren(
          el('div', { className: 'tooltip-title', text: title }),
          ...rows.map((row) => el('div', { className: 'tooltip-row' }, [
            el('span', { className: row.shape === 'rect' ? 'key-rect' : 'key-line', style: `background:${row.color}` }),
            el('strong', { text: row.value }),
            el('span', { text: row.label }),
          ]))
        );
        tip.classList.remove('hidden');
        const width = container.clientWidth;
        const tipWidth = tip.offsetWidth;
        const left = x + 14 + tipWidth > width ? Math.max(0, x - 14 - tipWidth) : x + 14;
        tip.style.left = `${left}px`;
        tip.style.top = `${Math.max(0, y - 10)}px`;
      },
      hide() { tip.classList.add('hidden'); },
    };
  }

  function drawFrame(svg, { width, margin, yMax, yFormat, days, xAt }) {
    const plotH = HEIGHT - margin.top - margin.bottom;
    const yAt = (v) => margin.top + plotH - (v / yMax) * plotH;
    for (let i = 0; i <= 4; i += 1) {
      const value = (yMax / 4) * i;
      const y = Math.round(yAt(value)) + 0.5;
      svg.appendChild(svgEl('line', {
        class: i === 0 ? 'base-line' : 'grid-line', x1: margin.left, x2: width - margin.right, y1: y, y2: y,
      }));
      const label = svgEl('text', { class: 'axis-text', x: margin.left - 8, y: y + 4, 'text-anchor': 'end' });
      label.textContent = yFormat(value);
      svg.appendChild(label);
    }
    const tickCount = Math.min(days.length, width < 420 ? 3 : 6);
    const step = days.length > 1 ? (days.length - 1) / Math.max(tickCount - 1, 1) : 0;
    const seen = new Set();
    for (let t = 0; t < tickCount; t += 1) {
      const index = Math.round(t * step);
      if (seen.has(index)) continue;
      seen.add(index);
      const anchor = days.length === 1 ? 'middle' : t === 0 ? 'start' : t === tickCount - 1 ? 'end' : 'middle';
      const label = svgEl('text', { class: 'axis-text', x: xAt(index), y: HEIGHT - 6, 'text-anchor': anchor });
      label.textContent = formatDay(days[index]);
      svg.appendChild(label);
    }
    return yAt;
  }

  function drawLine(holder, opts, tooltip) {
    const { days, series, yFormat, valueFormat, refLine } = opts;
    const width = holder.clientWidth || 600;
    const margin = { top: 10, right: opts.endLabels === false ? 12 : 64, bottom: 24, left: 44 };
    const plotW = width - margin.left - margin.right;
    const allValues = series.flatMap((s) => s.values).filter((v) => v != null);
    const yMax = niceMax(Math.max(refLine ? refLine.value * 1.15 : 0, ...allValues, 0));
    const xAt = (i) => margin.left + (days.length > 1 ? (i / (days.length - 1)) * plotW : plotW / 2);

    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, role: 'img', 'aria-label': opts.title });
    const yAt = drawFrame(svg, { width, margin, yMax, yFormat, days, xAt });

    if (refLine) {
      const y = Math.round(yAt(refLine.value)) + 0.5;
      svg.appendChild(svgEl('line', { class: 'ref-line', x1: margin.left, x2: width - margin.right, y1: y, y2: y }));
      const text = svgEl('text', { class: 'ref-text', x: margin.left + 4, y: y - 4 });
      text.textContent = refLine.label;
      svg.appendChild(text);
    }

    if (!allValues.length) {
      const empty = svgEl('text', { class: 'empty', x: margin.left + plotW / 2, y: HEIGHT / 2, 'text-anchor': 'middle' });
      empty.textContent = opts.emptyText || 'No data in this range yet';
      svg.appendChild(empty);
    }

    series.forEach((s, seriesIndex) => {
      // Break the line where a day has no value.
      let d = '';
      let pen = false;
      s.values.forEach((value, i) => {
        if (value == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${xAt(i).toFixed(1)},${yAt(value).toFixed(1)}`;
        pen = true;
      });
      if (series.length === 1 && d) {
        const points = s.values.map((v, i) => (v == null ? null : [xAt(i), yAt(v)])).filter(Boolean);
        if (points.length > 1) {
          const base = yAt(0);
          const area = `M${points[0][0]},${base}${points.map(([x, y]) => `L${x},${y}`).join('')}L${points[points.length - 1][0]},${base}Z`;
          svg.appendChild(svgEl('path', { d: area, fill: 'var(--area-1)' }));
        }
      }
      svg.appendChild(svgEl('path', { d, class: 'series-line', stroke: cssVar(s.color), 'data-series': seriesIndex }));
    });

    // Direct end labels on the last value of each series; drop any that would
    // collide (the legend and tooltip still carry them).
    if (opts.endLabels !== false) {
      const labels = series.map((s) => {
        let i = s.values.length - 1;
        while (i >= 0 && s.values[i] == null) i -= 1;
        return i < 0 ? null : { s, i, y: yAt(s.values[i]) };
      }).filter(Boolean).sort((a, b) => a.y - b.y);
      let lastY = -Infinity;
      labels.forEach(({ s, i, y }) => {
        svg.appendChild(svgEl('circle', { class: 'dot', cx: xAt(i), cy: y, r: 4, fill: cssVar(s.color) }));
        if (y - lastY < 13) return;
        lastY = y;
        const text = svgEl('text', { class: 'end-label', x: xAt(i) + 8, y: y + 4 });
        text.textContent = valueFormat(s.values[i]);
        svg.appendChild(text);
      });
    }

    // Crosshair + tooltip: snap to the nearest day; keyboard arrows move it.
    const cross = svgEl('line', { class: 'crosshair hidden', y1: margin.top, y2: HEIGHT - margin.bottom });
    const hoverDots = series.map((s) => svgEl('circle', { class: 'dot hidden', r: 4, fill: cssVar(s.color) }));
    svg.appendChild(cross);
    hoverDots.forEach((dot) => svg.appendChild(dot));
    const overlay = svgEl('rect', {
      x: margin.left - 6, y: margin.top, width: plotW + 12, height: HEIGHT - margin.top - margin.bottom,
      fill: 'transparent', tabindex: 0, 'aria-label': `${opts.title}: use arrow keys to read values`,
    });
    svg.appendChild(overlay);

    let current = days.length - 1;
    const showAt = (index) => {
      current = Math.max(0, Math.min(days.length - 1, index));
      const x = xAt(current);
      cross.setAttribute('x1', x); cross.setAttribute('x2', x);
      cross.classList.remove('hidden');
      series.forEach((s, i) => {
        const value = s.values[current];
        if (value == null) { hoverDots[i].classList.add('hidden'); return; }
        hoverDots[i].setAttribute('cx', x);
        hoverDots[i].setAttribute('cy', yAt(value));
        hoverDots[i].classList.remove('hidden');
      });
      const scale = holder.clientWidth / width;
      tooltip.show(
        formatDay(days[current], true),
        series.map((s) => ({ color: cssVar(s.color), value: valueFormat(s.values[current]), label: s.label })),
        x * scale,
        margin.top
      );
    };
    const hide = () => {
      cross.classList.add('hidden');
      hoverDots.forEach((dot) => dot.classList.add('hidden'));
      tooltip.hide();
    };
    const onPointer = (event) => {
      const box = svg.getBoundingClientRect();
      const x = ((event.clientX - box.left) / box.width) * width;
      const index = days.length > 1 ? Math.round(((x - margin.left) / plotW) * (days.length - 1)) : 0;
      showAt(index);
    };
    overlay.addEventListener('pointerenter', onPointer);
    overlay.addEventListener('pointermove', onPointer);
    overlay.addEventListener('pointerleave', hide);
    overlay.addEventListener('focus', () => showAt(current));
    overlay.addEventListener('blur', hide);
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') { showAt(current - 1); event.preventDefault(); }
      if (event.key === 'ArrowRight') { showAt(current + 1); event.preventDefault(); }
    });

    holder.replaceChildren(svg, holder.querySelector('.tooltip') || el('div'));
  }

  function drawColumns(holder, opts, tooltip) {
    const { days, series, yFormat, valueFormat } = opts;
    const width = holder.clientWidth || 600;
    const margin = { top: 10, right: 12, bottom: 24, left: 44 };
    const plotW = width - margin.left - margin.right;
    const totals = days.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] || 0), 0));
    const yMax = niceMax(Math.max(...totals, 0));
    const band = plotW / Math.max(days.length, 1);
    // Cap at 24px and always leave at least a 2px surface gap between columns.
    const barW = Math.max(1, Math.min(24, band - 2));
    const xAt = (i) => margin.left + band * i + band / 2;

    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${HEIGHT}`, role: 'img', 'aria-label': opts.title });
    const yAt = drawFrame(svg, { width, margin, yMax, yFormat, days, xAt });

    if (!totals.some((t) => t > 0)) {
      const empty = svgEl('text', { class: 'empty', x: margin.left + plotW / 2, y: HEIGHT / 2, 'text-anchor': 'middle' });
      empty.textContent = opts.emptyText || 'Nothing recorded in this range';
      svg.appendChild(empty);
    }

    days.forEach((day, i) => {
      const x = xAt(i) - barW / 2;
      const group = svgEl('g', { class: 'bar' });
      let stackTop = yAt(0);
      const nonZero = series.map((s) => s.values[i] || 0).map((v, k) => [v, k]).filter(([v]) => v > 0);
      nonZero.forEach(([value, k], position) => {
        const isTop = position === nonZero.length - 1;
        const fullH = yAt(0) - yAt(value);
        // 2px surface gap between stacked segments.
        const gap = isTop ? 0 : Math.min(2, fullH / 2);
        const h = Math.max(fullH - gap, 0.5);
        const y = stackTop - fullH;
        const shape = isTop
          ? svgEl('path', { d: roundedTopPath(x, y, barW, h), fill: cssVar(series[k].color) })
          : svgEl('rect', { x, y: y + gap, width: barW, height: h, fill: cssVar(series[k].color) });
        group.appendChild(shape);
        stackTop = y;
      });
      // Hit target: the whole band, not just the painted pixels.
      const hit = svgEl('rect', {
        x: margin.left + band * i, y: margin.top, width: band, height: HEIGHT - margin.top - margin.bottom,
        fill: 'transparent', tabindex: days.length <= 31 ? 0 : -1,
      });
      const show = () => {
        group.classList.add('is-hover');
        const scale = holder.clientWidth / width;
        const rows = series.map((s) => ({
          color: cssVar(s.color), value: valueFormat(s.values[i] || 0), label: s.label, shape: 'rect',
        }));
        if (series.length > 1) rows.push({ color: 'transparent', value: valueFormat(totals[i]), label: 'Total', shape: 'rect' });
        tooltip.show(formatDay(day, true), rows, xAt(i) * scale, margin.top);
      };
      const hide = () => { group.classList.remove('is-hover'); tooltip.hide(); };
      hit.addEventListener('pointerenter', show);
      hit.addEventListener('pointerleave', hide);
      hit.addEventListener('focus', show);
      hit.addEventListener('blur', hide);
      group.appendChild(hit);
      svg.appendChild(group);
    });

    holder.replaceChildren(svg, holder.querySelector('.tooltip') || el('div'));
  }

  function buildTable(opts) {
    const head = el('tr', {}, [el('th', { text: 'Day' }), ...opts.series.map((s) => el('th', { className: 'num', text: s.label }))]);
    const rows = opts.days.slice().reverse().map((day, reversedIndex) => {
      const i = opts.days.length - 1 - reversedIndex;
      return el('tr', {}, [
        el('td', { className: 'nowrap', text: formatDay(day, true) }),
        ...opts.series.map((s) => el('td', { className: 'num', text: opts.valueFormat(s.values[i]) })),
      ]);
    });
    return el('div', { className: 'table-wrap tall' }, el('table', {}, [el('thead', {}, head), el('tbody', {}, rows)]));
  }

  // Render a chart card into `card`. opts: { title, subtitle, type: 'line' |
  // 'columns', days: ['YYYY-MM-DD'], series: [{ label, color: '--series-1',
  // values: [] }], valueFormat, yFormat, refLine, emptyText }.
  function renderChartCard(card, opts) {
    const options = {
      valueFormat: formatCount,
      yFormat: formatCount,
      ...opts,
    };
    const shape = options.type === 'columns' ? 'key-rect' : 'key-line';
    const holder = el('div', { className: 'chart' });
    const tableHolder = el('div', { className: 'hidden' });
    let showingTable = false;
    const toggle = el('button', {
      className: 'table-toggle', type: 'button', text: 'Table',
      onclick: () => {
        showingTable = !showingTable;
        toggle.textContent = showingTable ? 'Chart' : 'Table';
        holder.classList.toggle('hidden', showingTable);
        tableHolder.classList.toggle('hidden', !showingTable);
        if (showingTable) tableHolder.replaceChildren(buildTable(options));
      },
    });
    const legend = options.series.length > 1
      ? el('div', { className: 'legend' }, options.series.map((s) => el('span', { className: 'legend-item' }, [
        el('span', { className: shape, style: `background:${cssVar(s.color)}` }),
        el('span', { text: s.label }),
      ])))
      : null;

    card.replaceChildren(...[
      el('div', { className: 'card-head' }, [
        el('div', {}, [
          el('h3', { className: 'card-title', text: options.title }),
          options.subtitle ? el('p', { className: 'card-sub', text: options.subtitle }) : null,
        ]),
        toggle,
      ]),
      legend,
      holder,
      tableHolder,
    ].filter(Boolean));

    const tooltip = buildTooltip(holder);
    const draw = () => {
      if (options.type === 'columns') drawColumns(holder, options, tooltip);
      else drawLine(holder, options, tooltip);
    };
    draw();
    if (card.__chartObserver) card.__chartObserver.disconnect();
    let lastWidth = holder.clientWidth;
    card.__chartObserver = new ResizeObserver(() => {
      if (Math.abs(holder.clientWidth - lastWidth) < 2) return;
      lastWidth = holder.clientWidth;
      draw();
    });
    card.__chartObserver.observe(holder);
  }

  window.NoeulCharts = { renderChartCard, formatCount, formatDay, el };
})();
