/**
 * OMNIS-X — Intelligent Campus Recovery System
 * Steps 2 & 3: Supabase Client, Anonymous Auth & Crash-Proof Write-Ahead Outbox
 *
 * Architecture:
 * - Local-first write-ahead outbox in localStorage ("omnis_outbox")
 * - Idempotent client-generated UUIDs + Supabase upsert onConflict keys
 * - Debounced batching (500ms) for frequent queue edits
 * - Exponential backoff + jitter (1s -> 60s), max attempts cap, dead-letter store
 * - Soft deletes only (deleted = true on failure_queue)
 * - Optimistic concurrency check via updated_at with conflict logging to app_log
 * - Non-blocking API: all public methods resolve { ok, data?, error? }
 */

(function (global) {
  'use strict';

  const SESSION_STORAGE_KEY = 'omnis_session_id';
  const OUTBOX_STORAGE_KEY = 'omnis_outbox';
  const DEAD_LETTER_KEY = 'omnis_dead_letter';
  const CACHE_STORAGE_KEY = 'omnis_state_cache_v1';
  const STATUS_EVENT_NAME = 'omnis:db-status';

  const MAX_JSONB_BYTES = 204800; // 200 KB hard constraint matching schema.sql
  const DEBOUNCE_QUEUE_MS = 500;
  const BASE_BACKOFF_MS = 1000;
  const MAX_BACKOFF_MS = 60000;
  const MAX_ATTEMPTS = 8;
  const MAX_BATCH_SIZE = 25;

  const ON_CONFLICT_BY_TABLE = {
    sim_sessions: 'id',
    failure_queue: 'session_id,client_id',
    simulation_runs: 'client_run_id',
    recovery_events: 'client_event_id',
    readiness_audits: 'client_audit_id',
    notifications: 'client_notice_id',
    app_log: 'client_log_id'
  };

  let client = null;
  let configured = false;
  let authReady = false;
  let accessToken = null;
  let restConfig = null;
  let sessionId = null;
  let userId = null;
  let currentStatus = 'offline'; // 'online' | 'syncing' | 'offline' | 'error'
  let lastError = null;
  let readyPromise = null;
  let flushInFlight = null;
  let retryTimerId = null;
  const debounceTimers = new Map();
  const statusListeners = new Set();

  // ==================== SAFE STORAGE & SERIALIZATION ====================

  function safeStorageGet(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function safeStorageSet(key, val) {
    try {
      global.localStorage.setItem(key, val);
      return true;
    } catch (_) {
      return false;
    }
  }

  function readJsonArray(key) {
    const raw = safeStorageGet(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeJsonArray(key, arr) {
    return safeStorageSet(key, JSON.stringify(Array.isArray(arr) ? arr : []));
  }

  function readCache() {
    const raw = safeStorageGet(CACHE_STORAGE_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeCachePatch(patch) {
    const current = readCache();
    const next = { ...current, ...patch, cachedAt: new Date().toISOString() };
    safeStorageSet(CACHE_STORAGE_KEY, JSON.stringify(next));
  }

  function generateUUID() {
    try {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return global.crypto.randomUUID();
      }
    } catch (_) {}
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getOrCreateSessionId() {
    const existing = safeStorageGet(SESSION_STORAGE_KEY);
    if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
      return existing;
    }
    const fresh = generateUUID();
    safeStorageSet(SESSION_STORAGE_KEY, fresh);
    return fresh;
  }

  function utf8ByteLength(str) {
    try {
      if (typeof TextEncoder === 'function') {
        return new TextEncoder().encode(str).length;
      }
    } catch (_) {}
    return unescape(encodeURIComponent(str)).length;
  }

  /**
   * Recursively strip non-JSON-serializable values (functions, Symbols, NaN, Infinity, undefined, cycles).
   */
  function sanitizeJsonValue(val, seen = new WeakSet()) {
    if (val === null) return null;
    const t = typeof val;
    if (t === 'boolean' || t === 'string') return val;
    if (t === 'number') return Number.isFinite(val) ? val : null;
    if (t === 'bigint') return Number(val);
    if (t === 'undefined' || t === 'function' || t === 'symbol') return undefined;

    if (val instanceof Date) {
      return Number.isNaN(val.getTime()) ? null : val.toISOString();
    }
    if (Array.isArray(val)) {
      if (seen.has(val)) return null;
      seen.add(val);
      return val.map((item) => {
        const cleaned = sanitizeJsonValue(item, seen);
        return cleaned === undefined ? null : cleaned;
      });
    }
    if (val instanceof Map) {
      return sanitizeJsonValue(Object.fromEntries(val.entries()), seen);
    }
    if (val instanceof Set) {
      return sanitizeJsonValue(Array.from(val.values()), seen);
    }
    if (t === 'object') {
      if (seen.has(val)) return null;
      seen.add(val);
      const out = {};
      Object.keys(val).forEach((k) => {
        const cleaned = sanitizeJsonValue(val[k], seen);
        if (cleaned !== undefined) {
          out[k] = cleaned;
        }
      });
      return out;
    }
    return undefined;
  }

  // ==================== PAYLOAD VALIDATION ====================

  function validateJsonbSize(val, fieldName) {
    const serialized = JSON.stringify(val);
    if (serialized === undefined) {
      return `${fieldName} is not JSON-serializable`;
    }
    const bytes = utf8ByteLength(serialized);
    if (bytes > MAX_JSONB_BYTES) {
      return `${fieldName} exceeds 200 KB limit (${bytes} bytes)`;
    }
    return null;
  }

  function validateTablePayload(table, rawPayload) {
    const clean = sanitizeJsonValue(rawPayload);
    if (!clean || typeof clean !== 'object' || Array.isArray(clean)) {
      return { valid: false, error: `Invalid payload object for ${table}` };
    }

    if (table === 'failure_queue') {
      if (!clean.client_id || typeof clean.client_id !== 'string') {
        return { valid: false, error: 'failure_queue requires string client_id' };
      }
      if (!clean.config || typeof clean.config !== 'object' || Array.isArray(clean.config)) {
        return { valid: false, error: 'failure_queue requires object config' };
      }
      if (typeof clean.position !== 'number' || clean.position < 0) {
        return { valid: false, error: 'failure_queue requires non-negative integer position' };
      }
      const sizeErr = validateJsonbSize(clean.config, 'failure_queue.config');
      if (sizeErr) return { valid: false, error: sizeErr };
    } else if (table === 'simulation_runs') {
      if (!clean.client_run_id || !clean.scenario_id) {
        return { valid: false, error: 'simulation_runs requires client_run_id and scenario_id' };
      }
      if (!Array.isArray(clean.failure_configs)) {
        return { valid: false, error: 'simulation_runs requires failure_configs array' };
      }
      if (!clean.metrics || typeof clean.metrics !== 'object' || Array.isArray(clean.metrics)) {
        return { valid: false, error: 'simulation_runs requires metrics object' };
      }
      const h = Number(clean.campus_health_pct);
      if (!Number.isFinite(h) || h < 0 || h > 100) {
        return { valid: false, error: 'simulation_runs campus_health_pct must be between 0 and 100' };
      }
      const err1 = validateJsonbSize(clean.failure_configs, 'simulation_runs.failure_configs');
      if (err1) return { valid: false, error: err1 };
      const err2 = validateJsonbSize(clean.metrics, 'simulation_runs.metrics');
      if (err2) return { valid: false, error: err2 };
    } else if (table === 'recovery_events') {
      const allowedTypes = ['selected', 'applied', 'undone', 'reset'];
      if (!allowedTypes.includes(clean.event_type)) {
        return { valid: false, error: `Invalid recovery_events event_type: ${clean.event_type}` };
      }
      if (clean.plan_stats) {
        const err = validateJsonbSize(clean.plan_stats, 'recovery_events.plan_stats');
        if (err) return { valid: false, error: err };
      }
    } else if (table === 'readiness_audits') {
      if (!['N-1', 'N-2'].includes(clean.mode)) {
        return { valid: false, error: `Invalid readiness_audits mode: ${clean.mode}` };
      }
      const sc = Number(clean.score);
      if (!Number.isFinite(sc) || sc < 0 || sc > 100) {
        return { valid: false, error: 'readiness_audits score must be between 0 and 100' };
      }
      const err = validateJsonbSize(clean.results || {}, 'readiness_audits.results');
      if (err) return { valid: false, error: err };
    } else if (table === 'notifications') {
      if (!clean.audience || !String(clean.audience).trim() || !clean.message || !String(clean.message).trim()) {
        return { valid: false, error: 'notifications requires non-empty audience and message' };
      }
    } else if (table === 'app_log') {
      if (!['debug', 'info', 'warn', 'error'].includes(clean.level || 'info')) {
        return { valid: false, error: `Invalid app_log level: ${clean.level}` };
      }
      if (!clean.message || !String(clean.message).trim()) {
        return { valid: false, error: 'app_log requires non-empty message' };
      }
      const err = validateJsonbSize(clean.context || {}, 'app_log.context');
      if (err) return { valid: false, error: err };
    }

    return { valid: true, payload: clean };
  }

  // ==================== STATUS & AUTH BOOTSTRAP ====================

  function isServiceRoleKey(keyStr) {
    try {
      const parts = String(keyStr || '').split('.');
      if (parts.length !== 3) return false;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const payload = JSON.parse(global.atob(padded));
      return payload && payload.role === 'service_role';
    } catch (_) {
      return false;
    }
  }

  function computeIsOnline() {
    if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) {
      return false;
    }
    return configured && authReady && currentStatus !== 'offline' && currentStatus !== 'error';
  }

  function getOutbox() {
    return readJsonArray(OUTBOX_STORAGE_KEY);
  }

  function setOutbox(list) {
    writeJsonArray(OUTBOX_STORAGE_KEY, list);
  }

  function getDeadLetters() {
    return readJsonArray(DEAD_LETTER_KEY);
  }

  function pushDeadLetter(opItem, reason) {
    const dl = getDeadLetters();
    dl.push({
      ...opItem,
      failedAt: new Date().toISOString(),
      failureReason: String(reason || 'Unknown error')
    });
    // Cap dead-letter archive cleanly at 100 entries
    writeJsonArray(DEAD_LETTER_KEY, dl.slice(-100));
  }

  function buildStatusSnapshot() {
    const outbox = getOutbox();
    return {
      status: currentStatus,
      isOnline: computeIsOnline(),
      pendingCount: outbox.length,
      deadLetterCount: getDeadLetters().length,
      configured,
      sessionId,
      userId,
      lastError
    };
  }

  function setStatus(nextStatus, errMsg = null) {
    currentStatus = nextStatus;
    lastError = errMsg || null;
    const snap = buildStatusSnapshot();
    statusListeners.forEach((fn) => {
      try {
        fn(snap);
      } catch (_) {}
    });
    try {
      global.dispatchEvent(new global.CustomEvent(STATUS_EVENT_NAME, { detail: snap }));
    } catch (_) {}
    return snap;
  }

  function validateConfig() {
    const cfg = global.OMNIS_CONFIG;
    if (!cfg || typeof cfg !== 'object') {
      return { valid: false, reason: 'window.OMNIS_CONFIG not present (running in local-only mode).' };
    }
    let url = String(cfg.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const key = String(cfg.SUPABASE_ANON_KEY || '').trim();
    if (!url || !key || url.includes('YOUR_PROJECT_REF') || key.includes('YOUR_SUPABASE_ANON_KEY')) {
      return { valid: false, reason: 'Supabase config contains placeholder or empty values.' };
    }
    if (!/^https?:\/\/.+/i.test(url)) {
      return { valid: false, reason: 'Invalid SUPABASE_URL scheme.' };
    }
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname && parsedUrl.pathname !== '/') {
        url = parsedUrl.origin;
      }
    } catch (_) {}
    if (isServiceRoleKey(key)) {
      return { valid: false, reason: 'Blocked service_role key in browser config. Use anon key only.' };
    }
    if (!global.supabase || typeof global.supabase.createClient !== 'function') {
      return { valid: false, reason: 'Supabase CDN client unavailable (offline or blocked).' };
    }
    return {
      valid: true,
      url,
      key,
      appVersion: String(cfg.APP_VERSION || '1.0.0'),
      sessionLabel: String(cfg.SESSION_LABEL || 'JGIT Campus Session')
    };
  }

  async function ensureAnonymousSession() {
    if (!client) return { ok: false, error: 'Client not initialized' };
    try {
      const { data: sessionData, error: sessionErr } = await client.auth.getSession();
      if (sessionErr) throw sessionErr;
      if (sessionData && sessionData.session && sessionData.session.user) {
        userId = sessionData.session.user.id;
        accessToken = sessionData.session.access_token || null;
        return { ok: true, userId };
      }

      const { data: anonData, error: anonErr } = await client.auth.signInAnonymously();
      if (anonErr) throw anonErr;
      if (anonData && anonData.user) {
        userId = anonData.user.id;
        accessToken = anonData.session ? anonData.session.access_token : null;
        return { ok: true, userId };
      }
      return { ok: false, error: 'Anonymous sign-in returned no user' };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  async function upsertSimSessionRow(meta) {
    if (!client || !userId || !sessionId) {
      return { ok: false, error: 'Missing client, userId, or sessionId' };
    }
    try {
      const nowIso = new Date().toISOString();
      const row = {
        id: sessionId,
        user_id: userId,
        label: meta.sessionLabel,
        app_version: meta.appVersion,
        last_seen: nowIso
      };

      const { error } = await client
        .from('sim_sessions')
        .upsert(row, { onConflict: 'id' });

      if (error) {
        const errCode = String(error.code || '');
        if (errCode === '42501' || errCode === '23505') {
          sessionId = generateUUID();
          safeStorageSet(SESSION_STORAGE_KEY, sessionId);
          row.id = sessionId;
          const retry = await client.from('sim_sessions').upsert(row, { onConflict: 'id' });
          if (retry.error) throw retry.error;
          return { ok: true, sessionId, rotated: true };
        }
        throw error;
      }
      return { ok: true, sessionId, rotated: false };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  async function initClientAndAuth() {
    sessionId = getOrCreateSessionId();
    const check = validateConfig();
    if (!check.valid) {
      configured = false;
      authReady = false;
      restConfig = null;
      if (check.reason.includes('service_role')) {
        console.error('[OMNIS_DB]', check.reason);
        setStatus('error', check.reason);
      } else {
        console.info('[OMNIS_DB]', check.reason);
        setStatus('offline', check.reason);
      }
      return { ok: false, offline: true, sessionId, userId: null, error: check.reason };
    }

    configured = true;
    restConfig = { url: check.url, key: check.key };
    try {
      client = global.supabase.createClient(check.url, check.key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false
        }
      });
      client.auth.onAuthStateChange((_ev, sess) => {
        accessToken = sess ? sess.access_token : null;
        if (sess && sess.user) userId = sess.user.id;
      });
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.warn('[OMNIS_DB] Failed to construct Supabase client:', msg);
      configured = false;
      setStatus('error', msg);
      return { ok: false, offline: true, sessionId, userId: null, error: msg };
    }

    if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) {
      setStatus('offline', 'Browser is offline');
      return { ok: false, offline: true, sessionId, userId: null, error: 'Browser is offline' };
    }

    setStatus('syncing');
    const authRes = await ensureAnonymousSession();
    if (!authRes.ok) {
      authReady = false;
      console.warn('[OMNIS_DB] Anonymous auth failed (continuing offline):', authRes.error);
      setStatus('error', authRes.error);
      return { ok: false, offline: true, sessionId, userId: null, error: authRes.error };
    }

    const sessRes = await upsertSimSessionRow(check);
    if (!sessRes.ok) {
      authReady = false;
      console.warn('[OMNIS_DB] sim_sessions touch failed:', sessRes.error);
      setStatus('error', sessRes.error);
      return { ok: false, offline: true, sessionId, userId, error: sessRes.error };
    }

    authReady = true;
    setStatus('online');
    flushOutbox();
    return { ok: true, offline: false, sessionId, userId, error: null };
  }

  function ready() {
    if (!readyPromise) {
      readyPromise = initClientAndAuth();
    }
    return readyPromise;
  }

  async function touchSession() {
    try {
      const initRes = await ready();
      if (!initRes.ok) return { ok: false, error: initRes.error || 'Offline' };
      const check = validateConfig();
      const res = await upsertSimSessionRow(check);
      if (!res.ok) {
        setStatus('error', res.error);
        return { ok: false, error: res.error };
      }
      setStatus('online');
      flushOutbox();
      return { ok: true, error: null };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      setStatus('error', msg);
      return { ok: false, error: msg };
    }
  }

  // ==================== WRITE-AHEAD OUTBOX, RETRY & CONCURRENCY ====================

  function computeBackoffMs(attempts) {
    const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1)));
    const jitter = Math.floor(Math.random() * Math.min(1000, exp * 0.25));
    return Math.min(MAX_BACKOFF_MS, exp + jitter);
  }

  function isPermanentDbError(err) {
    const code = String((err && err.code) || '');
    const msg = String((err && err.message) || '').toLowerCase();
    // 23514 check_violation, 23502 not_null, 22P02 invalid syntax, 42703 bad column
    if (['23514', '23502', '22P02', '42703'].includes(code)) return true;
    if (msg.includes('violates check constraint') || msg.includes('invalid input syntax')) return true;
    return false;
  }

  function logAppEventSync(level, message, context = {}) {
    try {
      if (level === 'error') console.error('[OMNIS_DB]', message, context);
      else if (level === 'warn') console.warn('[OMNIS_DB]', message, context);
    } catch (_) {}

    const payload = sanitizeJsonValue({
      session_id: sessionId || null,
      client_log_id: generateUUID(),
      level: ['debug', 'info', 'warn', 'error'].includes(level) ? level : 'info',
      message: String(message || 'Log event').slice(0, 1000),
      context: context || {}
    });
    const outbox = getOutbox();
    outbox.push({
      opId: generateUUID(),
      table: 'app_log',
      op: 'upsert',
      onConflict: ON_CONFLICT_BY_TABLE.app_log,
      payload,
      attempts: 0,
      ts: Date.now(),
      nextRetryAt: 0
    });
    setOutbox(outbox);
  }

  /**
   * Enqueue a validated write into localStorage outbox first, then flush asynchronously.
   */
  function enqueueWrite(table, rawPayload, opts = {}) {
    if (!ON_CONFLICT_BY_TABLE[table]) {
      return Promise.resolve({ ok: false, error: `Unsupported table: ${table}` });
    }
    const validation = validateTablePayload(table, rawPayload);
    if (!validation.valid) {
      logAppEventSync('warn', `Rejected invalid payload for ${table}: ${validation.error}`, { table });
      return Promise.resolve({ ok: false, error: validation.error });
    }

    const opItem = {
      opId: generateUUID(),
      table,
      op: opts.op || 'upsert',
      onConflict: opts.onConflict || ON_CONFLICT_BY_TABLE[table],
      dedupeKey: opts.dedupeKey || null,
      payload: validation.payload,
      clientUpdatedAt: new Date().toISOString(),
      attempts: 0,
      ts: Date.now(),
      nextRetryAt: 0
    };

    const outbox = getOutbox();
    // Collapse superseded queued writes with same dedupeKey (e.g., same failure_queue item edited rapidly)
    const filtered = opItem.dedupeKey
      ? outbox.filter((item) => !(item.table === table && item.dedupeKey === opItem.dedupeKey))
      : outbox;
    filtered.push(opItem);
    setOutbox(filtered);

    setStatus(computeIsOnline() ? 'syncing' : currentStatus);

    if (opts.debounceMs && opts.debounceMs > 0) {
      const timerKey = opts.debounceKey || table;
      if (debounceTimers.has(timerKey)) {
        clearTimeout(debounceTimers.get(timerKey));
      }
      const tid = setTimeout(() => {
        debounceTimers.delete(timerKey);
        flushOutbox();
      }, opts.debounceMs);
      debounceTimers.set(timerKey, tid);
    } else {
      flushOutbox();
    }

    return Promise.resolve({ ok: true, opId: opItem.opId, error: null });
  }

  /**
   * Optimistic concurrency guard for mutable failure_queue updates:
   * Compare remote updated_at vs clientUpdatedAt; if remote is strictly newer, keep newest write
   * and log the conflict to app_log.
   */
  async function checkOptimisticConcurrency(item) {
    if (item.table !== 'failure_queue' || !client || !userId || !item.payload.session_id || !item.payload.client_id) {
      return { proceed: true };
    }
    try {
      const { data, error } = await client
        .from('failure_queue')
        .select('updated_at,deleted,position')
        .eq('session_id', item.payload.session_id)
        .eq('client_id', item.payload.client_id)
        .maybeSingle();

      if (error || !data || !data.updated_at) return { proceed: true };
      const remoteMs = Date.parse(data.updated_at);
      const localMs = Date.parse(item.clientUpdatedAt || 0) || item.ts;
      if (Number.isFinite(remoteMs) && remoteMs > localMs + 250) {
        logAppEventSync('warn', 'Optimistic concurrency conflict on failure_queue: kept newer server row', {
          client_id: item.payload.client_id,
          remote_updated_at: data.updated_at,
          local_updated_at: item.clientUpdatedAt
        });
        return { proceed: false, keptRemote: true };
      }
    } catch (_) {}
    return { proceed: true };
  }

  function scheduleRetry(delayMs) {
    if (retryTimerId) {
      clearTimeout(retryTimerId);
      retryTimerId = null;
    }
    if (!Number.isFinite(delayMs) || delayMs < 0) return;
    retryTimerId = setTimeout(() => {
      retryTimerId = null;
      flushOutbox();
    }, delayMs);
  }

  async function processSingleBatch(batch) {
    const first = batch[0];
    const rowsToWrite = [];

    for (const item of batch) {
      if (item.table === 'failure_queue') {
        const occ = await checkOptimisticConcurrency(item);
        if (!occ.proceed) continue;
      }
      rowsToWrite.push({
        ...item.payload,
        user_id: userId
      });
    }

    if (rowsToWrite.length === 0) {
      return { ok: true };
    }

    const { error } = await client
      .from(first.table)
      .upsert(rowsToWrite, { onConflict: first.onConflict });

    if (error) return { ok: false, error };
    return { ok: true };
  }

  async function flushOutbox() {
    if (flushInFlight) return flushInFlight;

    flushInFlight = (async () => {
      try {
        const queue = getOutbox();
        if (queue.length === 0) {
          if (configured && authReady) setStatus('online');
          return { ok: true, flushed: 0, remaining: 0, error: null };
        }

        if (!configured || !client || !authReady) {
          const boot = await ready();
          if (!boot.ok) {
            return { ok: false, flushed: 0, remaining: queue.length, error: boot.error || 'Offline' };
          }
        }

        if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) {
          setStatus('offline', 'Network offline');
          return { ok: false, flushed: 0, remaining: queue.length, error: 'Network offline' };
        }

        setStatus('syncing');
        const now = Date.now();
        let remaining = getOutbox();
        let flushedCount = 0;
        let soonestRetryMs = null;

        while (remaining.length > 0) {
          // Process ready items in batches grouped cleanly by leading table + onConflict to preserve causality
          const readyItems = remaining.filter((it) => !it.nextRetryAt || it.nextRetryAt <= now);
          if (readyItems.length === 0) {
            const nextAt = Math.min(...remaining.map((it) => it.nextRetryAt || now + BASE_BACKOFF_MS));
            soonestRetryMs = Math.max(250, nextAt - Date.now());
            break;
          }

          const head = readyItems[0];
          const batch = [];
          for (const item of readyItems) {
            if (item.table === head.table && item.onConflict === head.onConflict && batch.length < MAX_BATCH_SIZE) {
              batch.push(item);
            } else {
              break;
            }
          }

          const batchOpIds = new Set(batch.map((b) => b.opId));
          const res = await processSingleBatch(batch);

          remaining = getOutbox();
          if (res.ok) {
            remaining = remaining.filter((it) => !batchOpIds.has(it.opId));
            setOutbox(remaining);
            flushedCount += batch.length;
          } else {
            const permanent = isPermanentDbError(res.error);
            const errMsg = (res.error && res.error.message) ? res.error.message : String(res.error || 'Sync failed');
            const updatedRemaining = [];

            for (const item of remaining) {
              if (!batchOpIds.has(item.opId)) {
                updatedRemaining.push(item);
                continue;
              }
              const nextAttempts = (item.attempts || 0) + 1;
              if (permanent || nextAttempts >= MAX_ATTEMPTS) {
                pushDeadLetter(item, errMsg);
                if (item.table !== 'app_log') {
                  logAppEventSync('error', `Dead-lettered ${item.table} write after ${nextAttempts} attempts: ${errMsg}`, {
                    opId: item.opId,
                    table: item.table
                  });
                }
              } else {
                const backoff = computeBackoffMs(nextAttempts);
                soonestRetryMs = soonestRetryMs === null ? backoff : Math.min(soonestRetryMs, backoff);
                updatedRemaining.push({
                  ...item,
                  attempts: nextAttempts,
                  nextRetryAt: Date.now() + backoff,
                  lastError: errMsg
                });
              }
            }

            setOutbox(updatedRemaining);
            setStatus('error', errMsg);
            if (soonestRetryMs !== null) scheduleRetry(soonestRetryMs);
            return { ok: false, flushed: flushedCount, remaining: updatedRemaining.length, error: errMsg };
          }
        }

        if (soonestRetryMs !== null) {
          scheduleRetry(soonestRetryMs);
        }
        setStatus(remaining.length > 0 ? 'syncing' : 'online');
        return { ok: true, flushed: flushedCount, remaining: remaining.length, error: null };
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        setStatus('error', msg);
        return { ok: false, flushed: 0, remaining: getOutbox().length, error: msg };
      } finally {
        flushInFlight = null;
      }
    })();

    return flushInFlight;
  }

  /**
   * Best-effort tab-unload flush via keepalive fetch (since PostgREST requires Auth headers).
   */
  function flushOnUnload() {
    const queue = getOutbox();
    if (!queue.length || !configured || !authReady || !restConfig || !accessToken || !userId) return;
    if (typeof global.fetch !== 'function') return;

    const grouped = new Map();
    queue.slice(0, MAX_BATCH_SIZE).forEach((item) => {
      if (item.nextRetryAt && item.nextRetryAt > Date.now()) return;
      const gk = `${item.table}|${item.onConflict}`;
      if (!grouped.has(gk)) grouped.set(gk, { table: item.table, onConflict: item.onConflict, rows: [] });
      grouped.get(gk).rows.push({ ...item.payload, user_id: userId });
    });

    grouped.forEach((grp) => {
      try {
        const endpoint = `${restConfig.url}/rest/v1/${encodeURIComponent(grp.table)}?on_conflict=${encodeURIComponent(grp.onConflict)}`;
        global.fetch(endpoint, {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            apikey: restConfig.key,
            Authorization: `Bearer ${accessToken}`,
            Prefer: 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify(grp.rows)
        }).catch(() => {});
      } catch (_) {}
    });
  }

  // ==================== DOMAIN PERSISTENCE HELPERS (STEPS 4-7) ====================

  function saveQueueSnapshot(queuedConfigs) {
    try {
      const cleanList = sanitizeJsonValue(queuedConfigs || []);
      writeCachePatch({ queuedFailureConfigs: cleanList });
      if (!sessionId) sessionId = getOrCreateSessionId();

      const tasks = (cleanList || []).map((cfg, idx) => {
        const clientId = cfg._qid || generateUUID();
        cfg._qid = clientId;
        const cleanCfg = { ...cfg };
        delete cleanCfg._cid;
        return enqueueWrite('failure_queue', {
          session_id: sessionId,
          client_id: String(clientId),
          config: cleanCfg,
          position: idx,
          deleted: false
        }, {
          dedupeKey: `fq:${clientId}`,
          debounceMs: DEBOUNCE_QUEUE_MS,
          debounceKey: 'failure_queue_batch'
        });
      });
      return Promise.all(tasks).then(() => ({ ok: true, error: null }));
    } catch (err) {
      return Promise.resolve({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  }

  function softDeleteQueueItems(clientIds = []) {
    try {
      if (!sessionId) sessionId = getOrCreateSessionId();
      const cache = readCache();
      const existing = Array.isArray(cache.queuedFailureConfigs) ? cache.queuedFailureConfigs : [];
      const idSet = new Set(clientIds.map(String));
      writeCachePatch({ queuedFailureConfigs: existing.filter((x) => !idSet.has(String(x._qid))) });

      const tasks = Array.from(idSet).map((cid) =>
        enqueueWrite('failure_queue', {
          session_id: sessionId,
          client_id: cid,
          config: existing.find((x) => String(x._qid) === cid) || { scenarioType: 'UNKNOWN', softDeleted: true },
          position: 0,
          deleted: true
        }, {
          dedupeKey: `fq:${cid}`,
          debounceMs: DEBOUNCE_QUEUE_MS,
          debounceKey: 'failure_queue_batch'
        })
      );
      return Promise.all(tasks).then(() => ({ ok: true, error: null }));
    } catch (err) {
      return Promise.resolve({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  }

  function recordSimulationRun(runInput) {
    try {
      if (!sessionId) sessionId = getOrCreateSessionId();
      const runId = runInput.id || generateUUID();
      const payload = {
        id: runId,
        session_id: sessionId,
        client_run_id: runInput.client_run_id || runId,
        scenario_id: String(runInput.scenario_id || 'CUSTOM'),
        failure_configs: sanitizeJsonValue(runInput.failure_configs || []),
        metrics: sanitizeJsonValue(runInput.metrics || {}),
        impacted_count: Math.max(0, Number(runInput.impacted_count) || 0),
        campus_health_pct: Math.max(0, Math.min(100, Number(runInput.campus_health_pct) || 0))
      };

      writeCachePatch({
        lastRun: {
          ...payload,
          created_at: new Date().toISOString()
        }
      });

      return enqueueWrite('simulation_runs', payload).then((r) => ({ ...r, data: payload }));
    } catch (err) {
      return Promise.resolve({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  }

  function recordRecoveryEvent(evInput) {
    try {
      if (!sessionId) sessionId = getOrCreateSessionId();
      const evId = evInput.client_event_id || generateUUID();
      const payload = {
        session_id: sessionId,
        run_id: evInput.run_id || null,
        client_event_id: evId,
        event_type: evInput.event_type,
        plan_rank: evInput.plan_rank || null,
        plan_name: evInput.plan_name || null,
        plan_stats: sanitizeJsonValue(evInput.plan_stats || {})
      };

      if (evInput.event_type === 'reset') {
        writeCachePatch({ lastRun: null, lastRecoveryEvent: null });
      } else {
        writeCachePatch({ lastRecoveryEvent: { ...payload, created_at: new Date().toISOString() } });
      }

      return enqueueWrite('recovery_events', payload);
    } catch (err) {
      return Promise.resolve({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  }

  function recordReadinessAudit(auditSummary, includeN2) {
    try {
      if (!sessionId) sessionId = getOrCreateSessionId();
      const compactResults = sanitizeJsonValue({
        timestamp: auditSummary.timestamp,
        certifiedPct: auditSummary.certifiedPct,
        avgStudentsAffected: auditSummary.avgStudentsAffected,
        totalUnprotectedCritical: auditSummary.totalUnprotectedCritical,
        failingIds: (auditSummary.failingItems || []).map((x) => x.id),
        items: (auditSummary.items || []).map((x) => ({
          id: x.id,
          name: x.name,
          category: x.category,
          studentsAffected: x.studentsAffected,
          recoveryPct: x.recoveryPct,
          criticalUnprotected: x.criticalUnprotected,
          fullyRecoverable: x.fullyRecoverable,
          riskScore: x.riskScore
        })),
        n2Count: (auditSummary.n2Items || []).length,
        n2CertifiedCount: auditSummary.n2CertifiedCount || 0
      });

      const payload = {
        session_id: sessionId,
        client_audit_id: generateUUID(),
        mode: includeN2 ? 'N-2' : 'N-1',
        score: Math.max(0, Math.min(100, Number(auditSummary.readinessScore) || 0)),
        certified_count: Math.max(0, Number(auditSummary.certifiedCount) || 0),
        total_count: Math.max(0, Number(auditSummary.totalCount) || 0),
        results: compactResults
      };
      return enqueueWrite('readiness_audits', payload);
    } catch (err) {
      return Promise.resolve({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  }

  function recordNotifications(noticesList = [], runId = null) {
    try {
      if (!sessionId) sessionId = getOrCreateSessionId();
      const tasks = (noticesList || []).map((n) =>
        enqueueWrite('notifications', {
          session_id: sessionId,
          run_id: runId || null,
          client_notice_id: n.client_notice_id || generateUUID(),
          audience: String(n.audience || 'General'),
          message: String(n.message || ''),
          sent: Boolean(n.sent)
        })
      );
      return Promise.all(tasks).then(() => ({ ok: true, error: null }));
    } catch (err) {
      return Promise.resolve({ ok: false, error: err && err.message ? err.message : String(err) });
    }
  }

  async function logAppEvent(level, message, context = {}) {
    try {
      logAppEventSync(level, message, context);
      flushOutbox();
      return { ok: true, error: null };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  /**
   * Restore latest durable session state (failure queue + last run + last recovery event).
   * Merges pending local outbox changes cleanly so nothing is lost on offline reload.
   */
  async function restoreSessionState() {
    try {
      const localCache = readCache();
      let restoredQueue = Array.isArray(localCache.queuedFailureConfigs) ? localCache.queuedFailureConfigs : [];
      let restoredLastRun = localCache.lastRun || null;
      let restoredRecovery = localCache.lastRecoveryEvent || null;
      let source = 'local-cache';

      const boot = await ready();
      if (boot.ok && client && userId && sessionId) {
        const [qRes, rRes, evRes] = await Promise.all([
          client
            .from('failure_queue')
            .select('client_id,config,position,deleted,updated_at')
            .eq('session_id', sessionId)
            .eq('deleted', false)
            .order('position', { ascending: true }),
          client
            .from('simulation_runs')
            .select('id,client_run_id,scenario_id,failure_configs,metrics,impacted_count,campus_health_pct,created_at')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false })
            .limit(1),
          client
            .from('recovery_events')
            .select('run_id,event_type,plan_rank,plan_name,plan_stats,created_at')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: false })
            .limit(1)
        ]);

        if (!qRes.error && Array.isArray(qRes.data) && qRes.data.length > 0) {
          restoredQueue = qRes.data.map((row) => ({ ...row.config, _qid: row.client_id }));
          source = 'supabase';
        }
        if (!rRes.error && Array.isArray(rRes.data) && rRes.data.length > 0) {
          restoredLastRun = rRes.data[0];
          source = 'supabase';
        }
        if (!evRes.error && Array.isArray(evRes.data) && evRes.data.length > 0) {
          restoredRecovery = evRes.data[0];
          if (restoredRecovery.event_type === 'reset') {
            restoredLastRun = null;
            restoredQueue = [];
          }
        }
      }

      // Overlay any un-flushed outbox items on top so offline edits win
      const outbox = getOutbox();
      if (outbox.length > 0) {
        const queueMap = new Map(restoredQueue.map((item) => [String(item._qid), item]));
        outbox.forEach((op) => {
          if (op.table === 'failure_queue' && op.payload) {
            const cid = String(op.payload.client_id);
            if (op.payload.deleted) queueMap.delete(cid);
            else queueMap.set(cid, { ...op.payload.config, _qid: cid });
          } else if (op.table === 'simulation_runs' && op.payload) {
            restoredLastRun = op.payload;
          } else if (op.table === 'recovery_events' && op.payload) {
            restoredRecovery = op.payload;
            if (op.payload.event_type === 'reset') {
              restoredLastRun = null;
              queueMap.clear();
            }
          }
        });
        restoredQueue = Array.from(queueMap.values());
      }

      return {
        ok: true,
        data: {
          source,
          queuedFailureConfigs: restoredQueue,
          lastRun: restoredLastRun,
          lastRecoveryEvent: restoredRecovery
        },
        error: null
      };
    } catch (err) {
      return {
        ok: false,
        data: { source: 'fallback', queuedFailureConfigs: [], lastRun: null, lastRecoveryEvent: null },
        error: err && err.message ? err.message : String(err)
      };
    }
  }

  async function fetchRecentRuns(limit = 10) {
    try {
      const mapById = new Map();
      const outbox = getOutbox();
      outbox.forEach((op) => {
        if (op.table === 'simulation_runs' && op.payload) {
          mapById.set(op.payload.client_run_id, {
            ...op.payload,
            created_at: new Date(op.ts).toISOString(),
            pendingSync: true
          });
        }
      });

      const cache = readCache();
      if (cache.lastRun && !mapById.has(cache.lastRun.client_run_id)) {
        mapById.set(cache.lastRun.client_run_id, cache.lastRun);
      }

      const boot = await ready();
      if (boot.ok && client && userId && sessionId) {
        const { data, error } = await client
          .from('simulation_runs')
          .select('id,client_run_id,scenario_id,failure_configs,metrics,impacted_count,campus_health_pct,created_at')
          .eq('session_id', sessionId)
          .order('created_at', { ascending: false })
          .limit(limit);
        if (!error && Array.isArray(data)) {
          data.forEach((r) => {
            if (!mapById.has(r.client_run_id)) mapById.set(r.client_run_id, r);
          });
        }
      }

      const list = Array.from(mapById.values())
        .sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0))
        .slice(0, limit);
      return { ok: true, data: list, error: null };
    } catch (err) {
      return { ok: false, data: [], error: err && err.message ? err.message : String(err) };
    }
  }

  async function exportUserData() {
    try {
      const dump = {
        exportedAt: new Date().toISOString(),
        sessionId,
        userId,
        localCache: readCache(),
        outbox: getOutbox(),
        deadLetter: getDeadLetters(),
        remote: {}
      };
      const boot = await ready();
      if (boot.ok && client && userId) {
        const tables = ['sim_sessions', 'failure_queue', 'simulation_runs', 'recovery_events', 'readiness_audits', 'notifications', 'app_log'];
        await Promise.all(
          tables.map(async (tbl) => {
            try {
              const { data } = await client.from(tbl).select('*').order('created_at', { ascending: false });
              dump.remote[tbl] = data || [];
            } catch (_) {
              dump.remote[tbl] = [];
            }
          })
        );
      }
      return { ok: true, data: dump, error: null };
    } catch (err) {
      return { ok: false, data: null, error: err && err.message ? err.message : String(err) };
    }
  }

  function onStatusChange(cb) {
    if (typeof cb !== 'function') return () => {};
    statusListeners.add(cb);
    try {
      cb(buildStatusSnapshot());
    } catch (_) {}
    return () => statusListeners.delete(cb);
  }

  // Lifecycle listeners: flush on online, tab visible, and tab unload
  if (typeof global.addEventListener === 'function') {
    global.addEventListener('offline', () => {
      setStatus('offline', 'Network offline');
    });
    global.addEventListener('online', () => {
      if (!configured) {
        readyPromise = null;
        ready();
      } else {
        touchSession();
      }
    });
    global.addEventListener('beforeunload', flushOnUnload);
  }
  if (typeof global.document !== 'undefined' && typeof global.document.addEventListener === 'function') {
    global.document.addEventListener('visibilitychange', () => {
      if (global.document.visibilityState === 'visible') {
        flushOutbox();
      }
    });
  }

  const dbApi = {
    STATUS_EVENT_NAME,
    ready,
    touchSession,
    getStatus: buildStatusSnapshot,
    onStatusChange,
    getClient: () => client,
    getSessionId: () => sessionId,
    getUserId: () => userId,
    generateUUID,

    // Step 3 Crash-Proof Persistence API
    enqueueWrite,
    flushOutbox,
    getOutbox,
    getDeadLetters,
    clearDeadLetters: () => writeJsonArray(DEAD_LETTER_KEY, []),
    saveQueueSnapshot,
    softDeleteQueueItems,
    recordSimulationRun,
    recordRecoveryEvent,
    recordReadinessAudit,
    recordNotifications,
    logAppEvent,
    restoreSessionState,
    fetchRecentRuns,
    exportUserData
  };

  Object.defineProperty(dbApi, 'isOnline', {
    enumerable: true,
    get: computeIsOnline
  });

  global.OMNIS_DB = dbApi;
  ready();
})(window);
