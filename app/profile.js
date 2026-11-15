// app/profile.js — profile surface for #/u/<handle>.
// Calls GET /api/profiles/<handle> and links related bounty and leaderboard routes.

import { getJSON } from './api.js';
import {
  emptyState,
  encode,
  escapeHtml,
  formatMoney,
  formatNumber,
  formatRank,
  formatShortDate,
  imageTag,
  markShotReady,
  renderError,
  safeUrl,
  shell,
} from './ui.js';

// #/u/<handle> — failures replace the placeholder so an API outage cannot leave an eternal skeleton.
export function profileView(handle) {
  const element = shell('<div class="skeleton" style="min-height:420px"></div>');
  let controller;

  const loadProfile = () => {
    controller = new AbortController();
    getJSON(`/api/profiles/${encode(handle)}`, controller.signal)
      .then((profile) => {
        const record = profile.record || {};
        const walletAddress = profile.wallet?.address;
        const solutions = profile.solutions || [];
        const walletUrl = safeUrl(profile.wallet?.explorer_url);

        element.innerHTML = `<a class="crumb" href="#/">← Explore bounties</a>
          <div class="profilehead">
            ${imageTag(profile.avatar || profile.image, `${profile.handle} avatar`)}
            <div><h1>${escapeHtml(profile.display_name || `@${profile.handle}`)}</h1><div class="muted">@${escapeHtml(profile.handle)} · joined ${formatShortDate(profile.joined_at)}</div></div>
          </div>
          ${profile.bio ? `<p class="prose">${escapeHtml(profile.bio)}</p>` : ''}
          ${walletAddress ? `<p class="muted">Wallet: ${walletUrl ? `<a href="${walletUrl}" target="_blank" rel="noreferrer">${escapeHtml(`${walletAddress.slice(0, 7)}…${walletAddress.slice(-5)}`)}</a>` : escapeHtml(`${walletAddress.slice(0, 7)}…${walletAddress.slice(-5)}`)}</p>` : ''}
          <div class="record">
            <div><b>${formatNumber(record.competitions_entered ?? 0)}</b><small>Entered</small></div>
            <div><b>${formatNumber(record.competitions_placed ?? 0)}</b><small>Placed</small></div>
            <div><b>${formatNumber(record.competitions_won ?? 0)}</b><small>Won</small></div>
            <div><b>${formatMoney(record.prize_usd ?? 0)}</b><small>Prize total</small></div>
            <div><b>${formatRank(record.best_placement)}</b><small>Best place</small></div>
          </div>
          <h2>Solutions</h2>
          <div>${solutions.length ? solutions.map((solution) => `<div class="solution">
            <div><b><a href="#/b/${encode(solution.competition?.slug)}">${escapeHtml(solution.competition?.title || 'Competition')}</a></b><small>${escapeHtml(solution.title || 'Submission')} · ${formatShortDate(solution.received_at || solution.entered_at)} · <a href="#/b/${encode(solution.competition?.slug)}/lb">Leaderboard</a></small></div>
            <div class="score"><b>${solution.placement ? formatRank(solution.placement) : 'Submitted'} ${solution.prize_usd ? `· ${formatMoney(solution.prize_usd)}` : ''}</b><small>${escapeHtml(solution.score?.display ?? formatNumber(solution.score?.value, solution.score?.precision))}</small></div>
          </div>`).join('') : emptyState('No public solutions yet.')}</div>`;
        document.title = `${profile.display_name || `@${profile.handle}`} — make.fun`;
        markShotReady();
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          renderError(element, loadProfile, error);
        }
      });
  };

  return {
    mount(target) {
      target.replaceChildren(element);
      loadProfile();
    },
    unmount() {
      controller?.abort();
    },
  };
}
