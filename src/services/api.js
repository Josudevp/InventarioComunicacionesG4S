const API_URL = import.meta.env.VITE_API_URL || 'https://script.google.com/macros/s/AKfycbxz9KZLLhT3HZI4XERjX7aVS7565lX_Besd31Sme5JDqNtHQFOdgp5GIGn7kPa66g8/exec';
const READ_ACTIONS = new Set([
  'obtener_dashboard',
  'obtener_catalogo',
  'obtener_capmovil',
  'obtener_equipos',
  'obtener_solicitudes',
  'obtener_movimientos',
  'obtener_analitica_inventario'
]);
const RESPONSE_CACHE_TTL_MS = 30000;
const responseCache = new Map();
const pendingRequests = new Map();
let cacheGeneration = 0;

function apiHeaders() {
  return { 'Content-Type': 'text/plain;charset=utf-8' };
}

function apiPayload(payload) {
  const token = sessionStorage.getItem('g4sSessionToken');
  return token ? { ...payload, token } : payload;
}

export function invalidateApiCache() {
  cacheGeneration++;
  responseCache.clear();
  pendingRequests.clear();
}

function cacheKey(payload, authenticated) {
  return JSON.stringify([authenticated, payload]);
}

export function apiRequest(payload, { authenticated = true, cache = true } = {}) {
  const isRead = authenticated && READ_ACTIONS.has(payload.action);
  if (authenticated && payload.action && !isRead) {
    invalidateApiCache();
    if (typeof window !== 'undefined' && typeof window.invalidateLoadingCaches === 'function') {
    window.invalidateLoadingCaches();
    }
  }
  const key = cacheKey(payload, authenticated);
  if (isRead && cache) {
    const cached = responseCache.get(key);
    if (cached && Date.now() - cached.createdAt < RESPONSE_CACHE_TTL_MS) {
    return Promise.resolve(new Response(cached.body, { status: cached.status, headers: cached.headers }));
    }
    if (pendingRequests.has(key)) {
      return pendingRequests.get(key).then(result => new Response(result.body, {
        status: result.status,
        headers: result.headers
      }));
    }
  }
  const requestGeneration = cacheGeneration;
  const request = fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(authenticated ? apiPayload(payload) : payload),
    headers: apiHeaders()
  });
  if (!isRead || !cache) return request;
  const pending = request.then(async response => {
    const body = await response.text();
    if (response.ok && requestGeneration === cacheGeneration) {
    responseCache.set(key, {
      body,
      createdAt: Date.now(),
      status: response.status,
      headers: [...response.headers]
    });
    }
    return {
      body,
      status: response.status,
      headers: [...response.headers]
    };
  }).finally(() => {
    if (pendingRequests.get(key) === pending) pendingRequests.delete(key);
  });
  pendingRequests.set(key, pending);
  return pending.then(result => new Response(result.body, {
    status: result.status,
    headers: result.headers
  }));
}
