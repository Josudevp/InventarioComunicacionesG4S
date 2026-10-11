const API_URL = import.meta.env.VITE_API_URL || 'https://script.google.com/macros/s/AKfycbz-HElf6uoVD5ZmGzFe2F7XJpd2eNKz5hwQh725Wl5r3hp2wrUKbm2QRn4n2I9Zayc/exec';

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