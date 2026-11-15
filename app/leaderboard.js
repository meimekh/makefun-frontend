// app/leaderboard.js — standings surface for #/b/<slug>/lb.
// Calls GET /api/competitions/<slug>/leaderboard?limit=25&offset=<n>&phase=<key>.

import { getJSON } from './api.js';
import {
  emptyState,
  encode,
  escapeHtml,
  formatNumber,
  formatRank,
  formatShortDate,
  markShotReady,
  renderError,
  shell,
} from './ui.js';

const BUILD_RETRY_LIMIT = 4;
const BUILD_RETRY_DELAY = 3_000;

function isBuildingError(error) {
  return error.status === 503 && /still being built/i.test(error.detail || error.message || '');
}

function shortColumnLabel(column) {
  const title = column.shortTitle || column.short_title || column.title || column.key;

  if (title.length <= 18) {
    return title;
  }

  return title
    .replace(/interval/gi, 'Int.')
    .replace(/average/gi, 'Avg.')
    .replace(/maximum/gi, 'Max.')
    .replace(/minimum/gi, 'Min.');
}

function columnWidth(column, fallback) {
  const width = column.width ?? column.widthPct ?? column.width_percent;

  if (typeof width === 'number') {
    return `${width}%`;
  }

  return typeof width === 'string' ? width : fallback;
}

function selectedColumns(columns) {
  const visibleColumns = columns.filter((column) => !column.hidden);

  if (window.innerWidth >= 900) {
    return visibleColumns;
  }

  // Narrow tables retain rank-like scoring data before decorative or diagnostic metrics.
  return visibleColumns.filter((column) => /rank|score|interval/i.test(column.key || ''));
}

function cellValue(entry, column) {
  const value = entry.values?.[column.key];

  if (typeof value === 'number') {
    return formatNumber(value, column.precision);
  }

  return entry.display?.[column.key] ?? (value == null ? '—' : String(value));
}

function initialMarkup() {
  return `<div class="hero">
    <div>
      <div class="eyebrow">Live standings</div>
      <h1>Leaderboard</h1>
      <p>Loading the competition’s scoring schema and first page…</p>
    </div>
  </div>
  <div class="skeleton" style="min-height:420px"></div>`;
}

// #/b/<slug>/lb — column metadata is the source of truth, then is pruned before it can overflow.
export function leaderboardView(slug) {
  const element = shell(initialMarkup());
  let controller;
  let leaderboard;
  let rows = [];
  let sortKey = 'rank';
  let descending = false;
  let phase = '';
  let loading = false;
  let buildRetries = 0;
  let retryTimer;
  let countdownTimer;

  const clearBuildingTimers = () => {
    window.clearTimeout(retryTimer);
    window.clearInterval(countdownTimer);
  };

  const renderBuilding = (seconds) => {
    element.innerHTML = `<div class="hero">
      <div>
        <div class="eyebrow">Live standings</div>
        <h1>Leaderboard</h1>
        <p>Standings are being built — retrying in <strong data-retry-count>${seconds}</strong>s</p>
      </div>
      <a class="leader" href="#/b/${encode(slug)}">← Bounty details</a>
    </div>
    <div class="skeleton" style="min-height:420px"></div>`;
  };

  const queueBuildingRetry = (error) => {
    buildRetries += 1;

    if (buildRetries > BUILD_RETRY_LIMIT) {
      renderError(element, () => {
        buildRetries = 0;
        fetchPage(0, true);
      }, error);
      return;
    }

    let seconds = BUILD_RETRY_DELAY / 1_000;
    renderBuilding(seconds);

    // A visible countdown explains that the skeleton represents a live queue, not a frozen page.
    countdownTimer = window.setInterval(() => {
      seconds -= 1;
      const counter = element.querySelector('[data-retry-count]');

      if (counter) {
        counter.textContent = String(Math.max(0, seconds));
      }
    }, 1_000);

    retryTimer = window.setTimeout(() => {
      clearBuildingTimers();
      fetchPage(0, true);
    }, BUILD_RETRY_DELAY);
  };

  const drawLeaderboard = () => {
    const columns = selectedColumns(leaderboard.columns || []);
    const showReceived = window.innerWidth >= 900;
    const sortedRows = [...rows].sort((first, second) => {
      if (sortKey === 'rank') {
        return (first.rank ?? Number.MAX_SAFE_INTEGER) - (second.rank ?? Number.MAX_SAFE_INTEGER);
      }

      const firstValue = first.values?.[sortKey];
      const secondValue = second.values?.[sortKey];

      if (firstValue == null) {
        return 1;
      }

      if (secondValue == null) {
        return -1;
      }

      const comparison = typeof firstValue === 'string'
        ? firstValue.localeCompare(secondValue)
        : firstValue - secondValue;
      return descending ? comparison * -1 : comparison;
    });
    const fallbackColumnWidth = columns.length ? `${Math.max(12, 48 / columns.length)}%` : '0%';
    const phaseOptions = (leaderboard.views || [])
      .filter((view) => view.key)
      .map((view) => `<option value="${escapeHtml(view.key)}" ${phase === view.key ? 'selected' : ''}>${escapeHtml(view.title || view.key)}</option>`)
      .join('');
    const colgroup = `<colgroup><col style="width:9%"><col style="width:${showReceived ? '31%' : '43%'}">${columns.map((column) => `<col style="width:${escapeHtml(columnWidth(column, fallbackColumnWidth))}">`).join('')}${showReceived ? '<col style="width:12%">' : ''}</colgroup>`;
    const header = `<tr>
      <th><button class="colbutton" data-sort="rank">Rank ${sortKey === 'rank' ? '<span class="sortarrow">↑</span>' : ''}</button></th>
      <th>Entry</th>
      ${columns.map((column) => `<th><button class="colbutton" data-sort="${escapeHtml(column.key)}">${escapeHtml(shortColumnLabel(column))} ${sortKey === column.key ? `<span class="sortarrow">${descending ? '↓' : '↑'}</span>` : ''}</button></th>`).join('')}
      ${showReceived ? '<th>Received</th>' : ''}
    </tr>`;
    const body = sortedRows.map((entry) => `<tr class="${entry.house || entry.baseline ? 'house' : ''}">
      <td data-label="Rank"><b class="rank">${formatRank(entry.rank)}</b>${entry.prize_rank ? `<small> prize ${formatRank(entry.prize_rank)}</small>` : ''}</td>
      <td data-label="Entry"><b>${escapeHtml(entry.title || 'Untitled')}</b><br><small><a href="#/u/${encode(entry.handle)}">@${escapeHtml(entry.handle || 'unknown')}</a>${entry.house ? ' · house' : entry.baseline ? ' · baseline' : ''}</small></td>
      ${columns.map((column) => `<td data-label="${escapeHtml(shortColumnLabel(column))}">${escapeHtml(cellValue(entry, column))}</td>`).join('')}
      ${showReceived ? `<td data-label="Received">${formatShortDate(entry.received_at)}</td>` : ''}
    </tr>`).join('');

    element.innerHTML = `<div class="hero">
      <div>
        <div class="eyebrow">Live standings</div>
        <h1>${escapeHtml(leaderboard.competition?.title || leaderboard.title || 'Leaderboard')}</h1>
        <p>${escapeHtml(leaderboard.title || leaderboard.quote || 'Ranks and scoring update as the competition progresses.')}</p>
      </div>
      <a class="leader" href="#/b/${encode(slug)}">← Bounty details</a>
    </div>
    ${phaseOptions ? `<label class="phase-label">Phase <select class="phase">${phaseOptions}</select></label>` : ''}
    ${rows.length ? `<div class="tablewrap"><table class="boardtable">${colgroup}<thead>${header}</thead><tbody>${body}</tbody></table></div>` : emptyState('No entries yet — be the first to ship.')}
    ${leaderboard.next_offset != null ? '<button class="load">Load 25 more</button>' : ''}`;
  };

  const fetchPage = (offset = 0, reset = false) => {
    if (loading) {
      return;
    }

    loading = true;
    const url = `/api/competitions/${encode(slug)}/leaderboard?limit=25&offset=${offset}${phase ? `&phase=${encode(phase)}` : ''}`;

    getJSON(url, controller.signal)
      .then((response) => {
        leaderboard = offset ? { ...leaderboard, ...response } : response;
        rows = reset ? (response.entries || []) : rows.concat(response.entries || []);
        loading = false;
        buildRetries = 0;
        document.title = `${leaderboard.competition?.title || 'Leaderboard'} — make.fun`;
        drawLeaderboard();
        markShotReady();
      })
      .catch((error) => {
        loading = false;

        if (error.name === 'AbortError') {
          return;
        }

        if (isBuildingError(error)) {
          queueBuildingRetry(error);
        } else {
          renderError(element, () => fetchPage(offset, reset), error);
        }
      });
  };

  const onClick = (event) => {
    const sortButton = event.target.closest('[data-sort]');

    if (sortButton) {
      const nextKey = sortButton.dataset.sort;
      descending = nextKey === sortKey ? !descending : false;
      sortKey = nextKey;
      drawLeaderboard();
      return;
    }

    if (event.target.closest('.load')) {
      fetchPage(leaderboard.next_offset);
    }
  };

  const onChange = (event) => {
    if (event.target.matches('.phase')) {
      phase = event.target.value;
      rows = [];
      sortKey = 'rank';
      fetchPage(0, true);
    }
  };

  const onResize = () => {
    if (leaderboard) {
      drawLeaderboard();
    }
  };

  return {
    mount(target) {
      target.replaceChildren(element);
      controller = new AbortController();
      element.addEventListener('click', onClick);
      element.addEventListener('change', onChange);
      window.addEventListener('resize', onResize);
      fetchPage();
    },
    unmount() {
      controller?.abort();
      clearBuildingTimers();
      element.removeEventListener('click', onClick);
      element.removeEventListener('change', onChange);
      window.removeEventListener('resize', onResize);
    },
  };
}
