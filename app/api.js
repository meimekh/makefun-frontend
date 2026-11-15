// app/api.js — resilient, cached reads for #/, #/b/<slug>, #/b/<slug>/lb, and #/u/<handle>.
// Calls GET /api/competitions, /api/competitions/<slug>, /leaderboard, /submissions, and /profiles/<handle>.

const ORIGIN = 'https://make.fun';
const STORAGE_PREFIX = 'makefun:api:v1:';
const MAX_AGE = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS = [800, 2500];

const memoryCache = new Map();
const pendingRequests = new Map();

function cacheKey(url) {
  return `${STORAGE_PREFIX}${encodeURIComponent(url)}`;
}

function fullUrl(url) {
  return url.startsWith('http') ? url : `${ORIGIN}${url}`;
}

function readCache(url) {
  const memoryHit = memoryCache.get(url);

  if (memoryHit) {
    return memoryHit;
  }

  try {
    const stored = JSON.parse(localStorage.getItem(cacheKey(url)));

    if (stored?.body) {
      memoryCache.set(url, stored);
      return stored;
    }
  } catch (_) {
    // Storage can be unavailable in private contexts; the memory cache still works.
  }

  return undefined;
}

function writeCache(url, value) {
  memoryCache.set(url, value);

  try {
    localStorage.setItem(cacheKey(url), JSON.stringify(value));
  } catch (_) {
    // A full or disabled localStorage should not make a public API request fail.
  }
}

function abortError() {
  return new DOMException('View left before the request completed.', 'AbortError');
}

function timeoutSignal(milliseconds) {
  if (typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(milliseconds);
  }

  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), milliseconds);
  return controller.signal;
}

function combinedSignal(signals) {
  const activeSignals = signals.filter(Boolean);

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(activeSignals);
  }

  const controller = new AbortController();
  const abort = () => controller.abort();

  activeSignals.forEach((signal) => {
    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener('abort', abort, { once: true });
    }
  });

  return controller.signal;
}

function apiError(response, detail = '') {
  const error = new Error(detail || `Request failed with status ${response.status}.`);
  error.status = response.status;
  error.detail = detail;
  return error;
}

async function responseError(response) {
  let detail = '';

  try {
    const body = await response.json();
    detail = typeof body.detail === 'string' ? body.detail : '';
  } catch (_) {
    // A non-JSON error response still has a useful status code.
  }

  return apiError(response, detail);
}

function shouldRetry(error, controller) {
  if (controller.signal.aborted) {
    return false;
  }

  return error.name === 'TimeoutError' || error.name === 'TypeError' || error.status >= 500;
}

function waitBeforeRetry(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);

    const abort = () => {
      window.clearTimeout(timer);
      reject(abortError());
    };

    if (signal.aborted) {
      abort();
      return;
    }

    signal.addEventListener('abort', abort, { once: true });
  });
}

async function fetchWithRetry(url, cached, controller) {
  let lastError;

  // Retry transient live failures so a slow upstream does not strand a route on its skeleton.
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(fullUrl(url), {
        headers: cached?.etag ? { 'If-None-Match': cached.etag } : {},
        signal: combinedSignal([controller.signal, timeoutSignal(12_000)]),
      });

      if (response.status === 304 && cached) {
        writeCache(url, { ...cached, time: Date.now() });
        return cached.body;
      }

      if (!response.ok) {
        throw await responseError(response);
      }

      const body = await response.json();
      writeCache(url, {
        body,
        etag: response.headers.get('ETag') || '',
        time: Date.now(),
      });
      return body;
    } catch (error) {
      lastError = error;

      if (controller.signal.aborted) {
        throw abortError();
      }

      if (attempt === MAX_ATTEMPTS - 1 || !shouldRetry(error, controller)) {
        break;
      }

      await waitBeforeRetry(RETRY_DELAYS[attempt], controller.signal);
    }
  }

  if (cached) {
    return cached.body;
  }

  if (lastError?.name === 'AbortError' || lastError?.name === 'TimeoutError') {
    lastError.status = lastError.status || 0;
  }

  throw lastError || apiError({ status: 0 }, 'Network request failed.');
}

function createRequest(url, cached, background) {
  const controller = new AbortController();
  const job = {
    background,
    controller,
    subscribers: 0,
    url,
  };

  job.promise = fetchWithRetry(url, cached, controller).finally(() => {
    pendingRequests.delete(url);
  });

  pendingRequests.set(url, job);
  return job;
}

function subscribe(job, signal) {
  job.subscribers += 1;

  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      signal?.removeEventListener('abort', onAbort);
      job.subscribers -= 1;

      // A deduped request remains useful while another view is listening to it.
      if (!job.background && job.subscribers === 0 && pendingRequests.get(job.url) === job) {
        job.controller.abort();
      }

      callback(value);
    };

    const onAbort = () => finish(reject, abortError());

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    job.promise.then(
      (body) => finish(resolve, body),
      (error) => finish(reject, error),
    );
  });
}

// Public read-only API: memory + ETag storage, stale-while-revalidate, dedupe, timeout, and caller aborts.
export function getJSON(url, signal) {
  const cached = readCache(url);

  if (cached && Date.now() - cached.time < MAX_AGE) {
    return Promise.resolve(cached.body);
  }

  const background = Boolean(cached);
  const job = pendingRequests.get(url) || createRequest(url, cached, background);

  if (cached) {
    // A stale response is immediately useful; quietly refresh its ETag in the background.
    job.promise.catch(() => {});
    return Promise.resolve(cached.body);
  }

  return subscribe(job, signal);
}

export function errorStatus(error) {
  return Number.isFinite(error?.status) ? error.status : 0;
}

export function apiURL(path) {
  return fullUrl(path);
}
