// Shared helpers for the route-tracking specs. LOCAL test backend only.
const path = require('path');
const { execSync } = require('child_process');

const API = process.env.E2E_API_URL || 'http://localhost:5055';
const PKG = 'com.ginslayer.besapp';
const M = 1 / 111_320; // degrees latitude per metre
const BASE = { lat: 40.758, lng: -73.9855 };

const adb = (cmd) => execSync(`adb ${cmd}`, { encoding: 'utf8', timeout: 120_000 }).trim();
const shell = (cmd) => adb(`shell ${cmd}`);
const geo = (lat, lng) => adb(`emu geo fix ${lng.toFixed(6)} ${lat.toFixed(6)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Appium ends an idle session after newCommandTimeout (240 s) and force-stops
// the app with it, so long GPS simulations keep the session alive.
async function pause(ms) {
  await sleep(ms);
  if (typeof driver !== 'undefined') await driver.getOrientation().catch(() => {});
}

// Access tokens last 15 minutes and these specs run longer: on a 401 the
// helper signs in again (ctx.email/ctx.password) and retries once.
function makeApi() {
  const ctx = { token: null, email: null, password: null };
  const send = (p, method, body, auth) =>
    fetch(`${API}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${ctx.token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  ctx.call = async (p, { method = 'GET', body, auth = true } = {}) => {
    let res = await send(p, method, body, auth);
    if (res.status === 401 && auth && ctx.email) {
      const login = await send('/api/auth/login', 'POST', { email: ctx.email, password: ctx.password }, false);
      ctx.token = (await login.json()).accessToken;
      res = await send(p, method, body, auth);
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, body: json };
  };
  return ctx;
}

async function stayAt(northM, seconds) {
  const end = Date.now() + seconds * 1000;
  let i = 0;
  while (Date.now() < end) {
    geo(BASE.lat + (northM + (i % 3) - 1) * M, BASE.lng);
    i += 1;
    await pause(5000);
  }
}

async function driveTo(fromM, toM, seconds) {
  const steps = Math.max(2, Math.round(seconds / 5));
  for (let s = 1; s <= steps; s += 1) {
    geo(BASE.lat + (fromM + ((toM - fromM) * s) / steps) * M, BASE.lng);
    await pause(5000);
  }
}

// Recovery tracking is "running" when expo-location's service is in the
// foreground (the persistent notification) — after stopping, the service can
// stay bound to the app without a notification or location requests.
function trackingServiceInForeground() {
  const services = shell(`dumpsys activity services ${PKG}`);
  const record = services.split(/ServiceRecord\{/).find((r) => r.includes('LocationTaskService'));
  return Boolean(record && /isForeground=true/.test(record));
}

async function waitFor(check, { timeout = 120_000, interval = 5000, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await pause(interval);
  }
  throw new Error(`Timed out waiting for ${message}`);
}

// The local TEST database (backend/.env.test) — used only to fast-forward a
// recovery expiry instead of waiting 72 hours.
function testDb() {
  const backend = process.env.E2E_BACKEND_DIR || path.join(__dirname, '..', '..', '..', 'backend');
  const envPath = process.env.E2E_BACKEND_ENV || path.join(backend, '.env.test');
  require(path.join(backend, 'node_modules', 'dotenv')).config({ path: envPath, quiet: true, override: true });
  return require(path.join(backend, 'src', 'config', 'db'));
}

module.exports = { API, PKG, M, BASE, adb, shell, geo, pause, sleep, makeApi, stayAt, driveTo, waitFor, testDb, trackingServiceInForeground };
