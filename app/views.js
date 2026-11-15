// app/views.js — board (#/) and bounty detail (#/b/<slug>) surfaces.
// Calls GET /api/competitions?status=open&activity=times, /api/competitions/<slug>, and /submissions.

import { getJSON } from './api.js';
import {
  bountyState,
  emptyState,
  encode,
  escapeHtml,
  formatDate,
  formatMoney,
  formatNumber,
  formatRank,
  formatShortDate,
  formatTimeLeft,
  markShotReady,
  renderError,
  renderMarkdown,
  shell,
  sponsorBadge,
  startCountdown,
} from './ui.js';

function bountyCard(bounty) {
  const [closed, stateLabel] = bountyState(bounty);
  const href = `#/b/${encode(bounty.slug)}`;
  const entryCount = formatNumber(bounty.submissionCount || 0);

  return `<article class="card">
    <div class="tagrow">
      <span class="chip">${escapeHtml(bounty.category || 'Bounty')}</span>
      ${sponsorBadge(bounty)}
    </div>
    <h2><a class="card-title stretched-link" href="${href}">${escapeHtml(bounty.title)}</a></h2>
    <p>${escapeHtml(bounty.summary || '')}</p>
    <div class="tagrow">${(bounty.skills || []).slice(0, 2).map((skill) => `<span class="chip">${escapeHtml(skill)}</span>`).join('')}</div>
    <div class="metrics">
      <div class="metric"><small>◉ Live pot</small><b class="money">${formatMoney(bounty.potUsd ?? bounty.rewardAmount)}</b></div>
      <div class="metric"><small>◷ Time left</small><b data-deadline="${escapeHtml(bounty.deadline)}">${formatTimeLeft(bounty.deadline)}</b></div>
      <div class="metric"><small>⌑ Entry</small><b>${bounty.entryFeeUsd ? formatMoney(bounty.entryFeeUsd) : 'Free'}</b></div>
      <div class="metric"><small>${closed ? 'Status' : 'Entries'}</small><b>${closed ? stateLabel : `${entryCount} entries`}</b></div>
    </div>
    <a class="card-action" href="${href}">View bounty <span aria-hidden="true">→</span></a>
  </article>`;
}

function boardMarkup() {
  return `<div class="hero">
    <div>
      <div class="eyebrow">Opportunity index · live</div>
      <h1>Find the next thing<br><span class="money">worth building.</span></h1>
      <p>Every open make.fun bounty, with the actual pot, the cost to enter, and the clock already running.</p>
    </div>
    <div class="statline" id="total">Loading live pots…</div>
  </div>
  <div class="controls">
    <div class="control-group">
      <span class="control-label">Sort</span>
      <div class="tabs" role="tablist" aria-label="Sort bounties">
        <button class="tab" data-sort="pot" aria-selected="true">Biggest pot</button>
        <button class="tab" data-sort="soon">Closing soon</button>
        <button class="tab" data-sort="entries">Most entries</button>
        <button class="tab" data-sort="new">New</button>
      </div>
    </div>
    <div class="control-group">
      <span class="control-label">Show</span>
      <div class="switch" aria-label="Bounty state">
        <button class="active" data-filter="live">Live now</button>
        <button data-filter="all">All</button>
      </div>
    </div>
  </div>
  <div class="cards" id="cards">${'<div class="skeleton"></div>'.repeat(6)}</div>`;
}

// #/ — filter locally after one list request so search and segmented controls remain instant.
export function boardView() {
  const element = shell(boardMarkup());
  let bounties = [];
  let sort = 'pot';
  let filter = 'live';
  let stopCountdown = () => {};
  let controller;

  const drawBoard = () => {
    const query = document.querySelector('#site-search').value.trim().toLowerCase();
    const visible = bounties.filter((bounty) => {
      const searchable = [bounty.title, bounty.summary, ...(bounty.skills || [])].join(' ').toLowerCase();
      const isOpen = (!bounty.status || bounty.status === 'open') && new Date(bounty.deadline) > new Date();
      return (!query || searchable.includes(query)) && (filter === 'all' || isOpen);
    });

    visible.sort((first, second) => {
      if (sort === 'pot') {
        return Number(second.potUsd || 0) - Number(first.potUsd || 0);
      }

      if (sort === 'soon') {
        return new Date(first.deadline) - new Date(second.deadline);
      }

      if (sort === 'entries') {
        return Number(second.submissionCount || 0) - Number(first.submissionCount || 0);
      }

      return new Date(second.publishedAt || second.opensAt || 0) - new Date(first.publishedAt || first.opensAt || 0);
    });

    const potTotal = visible.reduce((total, bounty) => total + Number(bounty.potUsd || bounty.rewardAmount || 0), 0);
    element.querySelector('#total').textContent = `${formatNumber(visible.length)} ${visible.length === 1 ? 'bounty' : 'bounties'} · ${formatMoney(potTotal)} in pots`;
    element.querySelector('#cards').innerHTML = visible.length
      ? visible.map(bountyCard).join('')
      : emptyState('No bounties match that search. Try another term or show all.');

    stopCountdown();
    stopCountdown = startCountdown(element);
  };

  const loadBoard = () => {
    controller = new AbortController();
    getJSON('/api/competitions?status=open&activity=times', controller.signal)
      .then((response) => {
        bounties = response.items || [];
        drawBoard();
        markShotReady();
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          renderError(element.querySelector('#cards'), loadBoard, error);
        }
      });
  };

  const onControlClick = (event) => {
    const button = event.target.closest('button[data-sort], button[data-filter]');

    if (!button) {
      return;
    }

    if (button.dataset.sort) {
      sort = button.dataset.sort;
      element.querySelectorAll('[data-sort]').forEach((tab) => {
        tab.setAttribute('aria-selected', String(tab === button));
      });
    } else {
      filter = button.dataset.filter;
      element.querySelectorAll('[data-filter]').forEach((tab) => {
        tab.classList.toggle('active', tab === button);
      });
    }

    drawBoard();
  };

  const onSearch = () => drawBoard();

  return {
    mount(target) {
      target.replaceChildren(element);
      element.addEventListener('click', onControlClick);
      window.addEventListener('board-search', onSearch);
      loadBoard();
    },
    unmount() {
      controller?.abort();
      stopCountdown();
      element.removeEventListener('click', onControlClick);
      window.removeEventListener('board-search', onSearch);
    },
  };
}

function prizeRows(bounty) {
  const prizes = bounty.rewardsNow?.length
    ? bounty.rewardsNow
    : Array.isArray(bounty.prizes)
      ? bounty.prizes
      : Object.entries(bounty.rewards || {}).map(([place, amountUsd]) => ({ place, amountUsd }));

  if (!prizes.length) {
    return '<tr><td colspan="3">Payouts have not been published.</td></tr>';
  }

  return prizes.map((prize) => `<tr>
    <td>${formatRank(prize.place)}</td>
    <td>${formatMoney(prize.amountUsd ?? prize.usd)}</td>
    <td>${prize.baseUsd != null ? formatMoney(prize.baseUsd) : '—'}</td>
  </tr>`).join('');
}

function bountyTabContent(bounty, tab) {
  if (tab === 'overview') {
    const resolvedAt = bounty.resolvedAt || bounty.resolutionAt || bounty.resolution?.resolved_at;
    return `<article class="prose">
      <p class="metadata"><strong>Opens:</strong> ${formatDate(bounty.opensAt)}<br><strong>Deadline:</strong> ${formatDate(bounty.deadline)}<br><strong>Resolved:</strong> ${resolvedAt ? formatDate(resolvedAt) : 'after judging'}</p>
      ${renderMarkdown(bounty.description || bounty.summary)}
    </article>`;
  }

  if (tab === 'rewards') {
    return `<div class="prose">
      <h2>Prize pool</h2>
      <p>The live pot is <strong>${formatMoney(bounty.potUsd ?? bounty.rewardAmount)}</strong>${bounty.entryFeeUsd ? `; the one-time entry is ${formatMoney(bounty.entryFeeUsd)} and entry fees currently add ${formatMoney(bounty.entryFeesUsd || 0)} to the pool.` : '.'}</p>
      <div class="prizegrid"><table><thead><tr><th>Place</th><th>Live payout</th><th>Base reward</th></tr></thead><tbody>${prizeRows(bounty)}</tbody></table></div>
    </div>`;
  }

  if (tab === 'rules') {
    return `<article class="prose">
      ${renderMarkdown(bounty.rules || bounty.rulesNote || 'No additional rules have been published.')}
      ${bounty.prerequisites ? `<h2>Prerequisites</h2>${renderMarkdown(bounty.prerequisites)}` : ''}
    </article>`;
  }

  return '<div class="entrylist"><div class="skeleton"></div><div class="skeleton"></div></div>';
}

// #/b/<slug> — fetch the expensive submission list only if the reader selects Entries.
export function bountyView(slug) {
  const element = shell('<div class="detailhead skeleton" style="min-height:330px"></div>');
  let controller;
  let stopCountdown = () => {};
  let bounty;
  let activeTab = 'overview';

  const loadEntries = () => {
    const body = element.querySelector('#tabbody');

    getJSON(`/api/competitions/${encode(slug)}/submissions?limit=20`, controller.signal)
      .then((response) => {
        const entries = response.items || [];
        body.innerHTML = entries.length
          ? `<div class="entrylist">${entries.map((entry) => `<div class="entry">
            <span class="rank">${formatRank(entry.rank)}</span>
            <div><b>${escapeHtml(entry.title || 'Untitled entry')}</b><small><a href="#/u/${encode(entry.handle)}">@${escapeHtml(entry.handle || 'unknown')}</a> · ${formatShortDate(entry.received_at)}</small></div>
            <span>${escapeHtml(entry.score?.display ?? formatNumber(entry.score?.value, entry.score?.precision))}</span>
          </div>`).join('')}</div>`
          : emptyState('No entries have been submitted yet.');
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          renderError(body, loadEntries, error);
        }
      });
  };

  const renderBounty = () => {
    const [closed, stateLabel] = bountyState(bounty);
    const entryCount = formatNumber(bounty.submissionCount || 0);

    element.innerHTML = `<a class="crumb" href="#/">← All live bounties</a>
      <div class="detailhead">
        <div class="titlemeta"><span class="chip">${escapeHtml(bounty.category || 'Bounty')}</span>${sponsorBadge(bounty)}<span class="status ${closed}">${stateLabel}</span></div>
        <h1>${escapeHtml(bounty.title)}</h1>
        <p class="summary">${escapeHtml(bounty.summary || '')}</p>
        <div class="numbers">
          <div class="number"><small>◉ Live pot</small><b class="money">${formatMoney(bounty.potUsd ?? bounty.rewardAmount)}</b></div>
          <div class="number"><small>⌑ Entry fee</small><b>${bounty.entryFeeUsd ? formatMoney(bounty.entryFeeUsd) : 'Free'}</b></div>
          <div class="number"><small>◷ Time left</small><b data-deadline="${escapeHtml(bounty.deadline)}">${formatTimeLeft(bounty.deadline)}</b></div>
        </div>
      </div>
      <div class="subnav" role="tablist">
        <button class="active" data-tab="overview">Overview</button>
        <button data-tab="rewards">Rewards</button>
        <button data-tab="rules">Rules</button>
        <button data-tab="entries">Entries <span class="muted">${entryCount}</span></button>
        <a class="leader" href="#/b/${encode(slug)}/lb">View leaderboard →</a>
      </div>
      <div id="tabbody">${bountyTabContent(bounty, activeTab)}</div>`;

    stopCountdown();
    stopCountdown = startCountdown(element);
  };

  const loadBounty = () => {
    controller = new AbortController();
    getJSON(`/api/competitions/${encode(slug)}`, controller.signal)
      .then((response) => {
        bounty = response;
        document.title = `${bounty.title} — make.fun`;
        renderBounty();
        markShotReady();
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          renderError(element, loadBounty, error);
        }
      });
  };

  const onTabClick = (event) => {
    const tab = event.target.closest('[data-tab]');

    if (!tab || !bounty) {
      return;
    }

    activeTab = tab.dataset.tab;
    element.querySelectorAll('[data-tab]').forEach((button) => {
      button.classList.toggle('active', button === tab);
    });
    element.querySelector('#tabbody').innerHTML = bountyTabContent(bounty, activeTab);

    if (activeTab === 'entries') {
      loadEntries();
    }
  };

  return {
    mount(target) {
      target.replaceChildren(element);
      element.addEventListener('click', onTabClick);
      loadBounty();
    },
    unmount() {
      controller?.abort();
      stopCountdown();
      element.removeEventListener('click', onTabClick);
    },
  };
}
