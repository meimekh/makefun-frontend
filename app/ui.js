// app/ui.js — shared presentation helpers for #/, #/b/<slug>, #/b/<slug>/lb, and #/u/<handle>.
// It makes no API calls; views use it after their GET responses have arrived.

import { apiURL, errorStatus } from './api.js';

export const encode = encodeURIComponent;

export function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function formatMoney(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number.toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    : '—';
}

export function formatNumber(value, precision = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '—';
  }

  return number.toLocaleString('en-US', {
    maximumFractionDigits: Number.isInteger(precision) ? precision : 3,
  });
}

export function formatRank(value) {
  return value == null ? '—' : `#${formatNumber(value)}`;
}

export function formatDate(value) {
  return value
    ? `${new Date(value).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    })} UTC`
    : '—';
}

export function formatShortDate(value) {
  return value ? new Date(value).toLocaleDateString('en-US', { dateStyle: 'medium' }) : '—';
}

export function formatTimeLeft(value) {
  const remaining = new Date(value).getTime() - Date.now();

  if (!Number.isFinite(remaining) || remaining <= 0) {
    return 'ended';
  }

  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);

  if (days) {
    return `${days}d ${hours}h left`;
  }

  if (hours) {
    return `${hours}h ${minutes}m left`;
  }

  return `${Math.max(1, minutes)}m left`;
}

export function shell(markup) {
  const element = document.createElement('section');
  element.innerHTML = markup;
  return element;
}

export function markShotReady() {
  requestAnimationFrame(() => {
    window.__shotReady = true;
  });
}

export function renderError(element, retry, error) {
  const status = errorStatus(error);
  const description = status
    ? `Could not load this live data (status ${status}).`
    : 'Could not load this live data. Check your connection.';

  element.innerHTML = `<div class="error"><b>${escapeHtml(description)}</b><br>Try again when you are ready.<br><button class="retry">Retry</button></div>`;
  element.querySelector('.retry').addEventListener('click', retry);
  markShotReady();
}

// A single timer avoids stale time labels when a long-lived route remains open.
export function startCountdown(root) {
  const deadlineNodes = [...root.querySelectorAll('[data-deadline]')];

  const tick = () => {
    deadlineNodes.forEach((node) => {
      node.textContent = formatTimeLeft(node.dataset.deadline);
    });
  };

  tick();
  const timer = window.setInterval(tick, 1_000);
  return () => window.clearInterval(timer);
}

export function emptyState(message) {
  return `<div class="empty">${escapeHtml(message)}</div>`;
}

export function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? escapeHtml(parsed.href) : '';
  } catch (_) {
    return '';
  }
}

export function imageTag(source, alt, className = 'avatar') {
  const trusted = source && (source.startsWith('/') || source.startsWith('https://make.fun'));

  if (!trusted) {
    return '';
  }

  const resolvedSource = source.startsWith('/') ? apiURL(source) : source;
  return `<img class="${className}" crossorigin="anonymous" loading="lazy" decoding="async" src="${escapeHtml(resolvedSource)}" alt="${escapeHtml(alt)}">`;
}

export function sponsorBadge(bounty) {
  if (!bounty.sponsor?.name) {
    return '';
  }

  const verified = bounty.sponsor.isVerified ? '✓ ' : '';
  return `<span class="sponsor">${verified}${escapeHtml(bounty.sponsor.name)}</span>`;
}

export function bountyState(bounty) {
  return bounty.acceptingSubmissions === false || bounty.status === 'closed'
    ? ['closed', 'Closed']
    : ['', 'Accepting entries'];
}

function renderInlineMarkdown(text) {
  let rendered = escapeHtml(text);
  rendered = rendered
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

  return rendered.replace(/\[([^\]]+)\]\(([^ )]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (_, label, url) => {
    const href = safeUrl(url);
    return href ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>` : label;
  });
}

// Escape before adding a deliberately small Markdown subset; API copy never becomes arbitrary HTML.
export function renderMarkdown(source) {
  const lines = String(source || '').replace(/\r/g, '').split('\n');
  let output = '';
  let listType = '';
  let insideCodeBlock = false;

  const closeList = () => {
    if (listType) {
      output += `</${listType}>`;
      listType = '';
    }
  };

  lines.forEach((line) => {
    if (line.startsWith('```')) {
      closeList();
      output += insideCodeBlock ? '</code></pre>' : '<pre><code>';
      insideCodeBlock = !insideCodeBlock;
      return;
    }

    if (insideCodeBlock) {
      output += `${escapeHtml(line)}\n`;
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)/);
    const bullet = line.match(/^[-*+]\s+(.+)/);
    const numbered = line.match(/^\d+\.\s+(.+)/);

    if (heading) {
      closeList();
      output += `<h${heading[1].length}>${renderInlineMarkdown(heading[2])}</h${heading[1].length}>`;
    } else if (bullet || numbered) {
      const nextListType = numbered ? 'ol' : 'ul';

      if (listType !== nextListType) {
        closeList();
        output += `<${nextListType}>`;
        listType = nextListType;
      }

      output += `<li>${renderInlineMarkdown((bullet || numbered)[1])}</li>`;
    } else if (/^>\s?/.test(line)) {
      closeList();
      output += `<blockquote>${renderInlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>`;
    } else if (line.trim()) {
      closeList();
      output += `<p>${renderInlineMarkdown(line)}</p>`;
    } else {
      closeList();
    }
  });

  closeList();
  return output || '<p>No overview has been published yet.</p>';
}
