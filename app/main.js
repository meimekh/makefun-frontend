// app/main.js — route coordinator for #/, #/b/<slug>, #/b/<slug>/lb, and #/u/<handle>.
// It calls no API directly; board, bounty, leaderboard, and profile modules own their GET requests.

import { boardView, bountyView } from './views.js';
import { leaderboardView } from './leaderboard.js';
import { profileView } from './profile.js';

const main = document.querySelector('main');
const search = document.querySelector('#site-search');
const savedScrollPositions = new Map();

let currentView;
let previousRoute = '#/';

window.__shotReady = false;

function parseRoute() {
  const rawRoute = location.hash || '#/';
  const parts = rawRoute
    .replace(/^#/, '')
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);

  if (parts.length === 0) {
    return { name: 'board', key: '#/' };
  }

  if (parts[0] === 'b' && parts[1] && parts[2] === 'lb') {
    return { name: 'leaderboard', slug: parts[1], key: rawRoute };
  }

  if (parts[0] === 'b' && parts[1]) {
    return { name: 'bounty', slug: parts[1], key: rawRoute };
  }

  if (parts[0] === 'u' && parts[1]) {
    return { name: 'profile', handle: parts[1], key: rawRoute };
  }

  return { name: 'board', key: '#/' };
}

function createView(route) {
  if (route.name === 'bounty') {
    return bountyView(route.slug);
  }

  if (route.name === 'leaderboard') {
    return leaderboardView(route.slug);
  }

  if (route.name === 'profile') {
    return profileView(route.handle);
  }

  return boardView();
}

function navigate() {
  savedScrollPositions.set(previousRoute, window.scrollY);
  currentView?.unmount();
  window.__shotReady = false;

  const route = parseRoute();
  previousRoute = route.key;
  currentView = createView(route);
  currentView.mount(main);

  requestAnimationFrame(() => {
    window.scrollTo(0, savedScrollPositions.get(route.key) || 0);
  });
}

search.addEventListener('input', () => {
  if (!location.hash || location.hash === '#/') {
    window.dispatchEvent(new Event('board-search'));
  } else {
    location.hash = '#/';
  }
});

window.addEventListener('hashchange', navigate);
navigate();
