const API_URL = import.meta.env.VITE_API_URL || 'https://script.google.com/macros/s/AKfycbxmW3RMx5XucrJfx9pUCFXP9GPbsgmmMMBfyQvl1wzTvhcpcuJBjntqmjHjL-Qu5TyR/exec';

function apiHeaders() {
  return { 'Content-Type': 'text/plain;charset=utf-8' };
}

function apiPayload(payload) {
  const token = sessionStorage.getItem('g4sSessionToken');
  return token ? { ...payload, token } : payload;
}

export function apiRequest(payload, { authenticated = true } = {}) {
  return fetch(API_URL, {
    method: 'POST',
    body: JSON.stringify(authenticated ? apiPayload(payload) : payload),
    headers: apiHeaders()
  });
}
