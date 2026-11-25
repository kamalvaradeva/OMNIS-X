/**
 * OMNIS-X — Intelligent Campus Recovery System
 * Durable Supabase Client, Confirmed Session Manager & Dependency-Ordered Outbox
 *
 * Root-Cause Fixes Applied:
 * 1. Verified Parent-First Session Init: waits for confirmed sim_sessions row in Postgres
 *    before marking sessionConfirmed = true or flushing child tables.
 * 2. Dependency-Ordered Sync: flushes strictly in topological FK order
 *    (sim_sessions -> simulation_runs -> failure_queue -> recovery_events -> notifications -> readiness_audits -> app_log).
 * 3. Stale-Session & Dead-Letter Reconciliation: detects stale pre-auth session_id / orphaned
 *    run_id references in outbox & dead-letter stores, repairs verified ownership safely, and prevents 409 loops.
 * 4. Smart Error Classification: distinguishes permanent DB constraint/FK errors (23503/409/23514)
 *    from temporary network errors (no 8x blind retries on FK failures).
 * 5. Authoritative Connection vs. Sync State: cleanly separates Connecting / Connected /
 *    Syncing / Sync Failed / Offline / Connection Failed.
 */

(function (global) {
  'use strict';

  const SESSION_STORAGE_KEY = 'omnis_session_id';
  const OUTBOX_STORAGE_KEY = 'omnis_outbox';
  const DEAD_LETTER_KEY = 'omnis_dead_letter';
  const CACHE_STORAGE_KEY = 'omnis_state_cache_v1';
  const STATUS_EVENT_NAME = 'omnis:db-status';
  const AUTH_SIGNOUT_EVENT_NAME = 'omnis:auth-signed-out';

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

  // Strict FK dependency order (parents ALWAYS flush before children)
  const TABLE_SYNC_PRIORITY = {
    sim_sessions: 0,
    simulation_runs: 1,
    failure_queue: 2,
    recovery_events: 3,
    notifications: 4,
    readiness_audits: 5,
    app_log: 6
  };

  let client = null;
  let configured = false;
  let authReady = false;
  let sessionConfirmed = false;
  let accessToken = null;
  let restConfig = null;
  let sessionId = null;
  let userId = null;
  let userEmail = null;
  let userRole = null;       // 'admin' | 'student' | null
  let studentId = null;
  let studentProfile = null;
  let studentRealtimeChannel = null;

  // Authoritative separated connection + sync states
  let connectionState = 'offline'; // 'connecting' | 'connected' | 'offline' | 'connection_failed'
  let syncState = 'idle';          // 'idle' | 'syncing' | 'synced' | 'sync_failed'
  let lastConnectionError = null;
  let lastSyncError = null;

  let readyPromise = null;
  let flushInFlight = null;
  let retryTimerId = null;
  const debounceTimers = new Map();
  const statusListeners = new Set();

  // ==================== SAFE STORAGE & SERIALIZATION ====================

  function safeStorageGet(key) {
    try { return global.localStorage.getItem(key); } catch (_) { return null; }
  }

  function safeStorageSet(key, val) {
    try { global.localStorage.setItem(key, val); return true; } catch (_) { return false; }
  }

  function readJsonArray(key) {
    const raw = safeStorageGet(key);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
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
    } catch (_) { return {}; }
  }

  function writeCachePatch(patch) {
    const current = readCache();
    safeStorageSet(CACHE_STORAGE_KEY, JSON.stringify({ ...current, ...patch, cachedAt: new Date().toISOString() }));
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
      if (typeof TextEncoder === 'function') return new TextEncoder().encode(str).length;
    } catch (_) {}
    return unescape(encodeURIComponent(str)).length;
  }

  function sanitizeJsonValue(val, seen = new WeakSet()) {
    if (val === null) return null;
    const t = typeof val;
    if (t === 'boolean' || t === 'string') return val;
    if (t === 'number') return Number.isFinite(val) ? val : null;
    if (t === 'bigint') return Number(val);
    if (t === 'undefined' || t === 'function' || t === 'symbol') return undefined;
    if (val instanceof Date) return Number.isNaN(val.getTime()) ? null : val.toISOString();
    if (Array.isArray(val)) {
      if (seen.has(val)) return null;
      seen.add(val);
      return val.map((item) => {
        const cleaned = sanitizeJsonValue(item, seen);
        return cleaned === undefined ? null : cleaned;
      });
    }
    if (val instanceof Map) return sanitizeJsonValue(Object.fromEntries(val.entries()), seen);
    if (val instanceof Set) return sanitizeJsonValue(Array.from(val.values()), seen);
    if (t === 'object') {
      if (seen.has(val)) return null;
      seen.add(val);
      const out = {};
      Object.keys(val).forEach((k) => {
        const cleaned = sanitizeJsonValue(val[k], seen);
        if (cleaned !== undefined) out[k] = cleaned;
      });
      return out;
    }
    return undefined;
  }

  // ==================== PAYLOAD VALIDATION ====================

  function validateJsonbSize(val, fieldName) {
    const serialized = JSON.stringify(val);
    if (serialized === undefined) return `${fieldName} is not JSON-serializable`;
    const bytes = utf8ByteLength(serialized);
    if (bytes > MAX_JSONB_BYTES) return `${fieldName} exceeds 200 KB limit (${bytes} bytes)`;
    return null;
  }

  function validateTablePayload(table, rawPayload) {
    const clean = sanitizeJsonValue(rawPayload);
    if (!clean || typeof clean !== 'object' || Array.isArray(clean)) {
      return { valid: false, error: `Invalid payload object for ${table}` };
    }
    if (table === 'failure_queue') {
      if (!clean.client_id || typeof clean.client_id !== 'string') return { valid: false, error: 'failure_queue requires string client_id' };
      if (!clean.config || typeof clean.config !== 'object' || Array.isArray(clean.config)) return { valid: false, error: 'failure_queue requires object config' };
      if (typeof clean.position !== 'number' || clean.position < 0) return { valid: false, error: 'failure_queue requires non-negative integer position' };
      const sizeErr = validateJsonbSize(clean.config, 'failure_queue.config');
      if (sizeErr) return { valid: false, error: sizeErr };
    } else if (table === 'simulation_runs') {
      if (!clean.client_run_id || !clean.scenario_id) return { valid: false, error: 'simulation_runs requires client_run_id and scenario_id' };
      if (!Array.isArray(clean.failure_configs)) return { valid: false, error: 'simulation_runs requires failure_configs array' };
      if (!clean.metrics || typeof clean.metrics !== 'object' || Array.isArray(clean.metrics)) return { valid: false, error: 'simulation_runs requires metrics object' };
      const h = Number(clean.campus_health_pct);
      if (!Number.isFinite(h) || h < 0 || h > 100) return { valid: false, error: 'simulation_runs campus_health_pct must be between 0 and 100' };
      const err1 = validateJsonbSize(clean.failure_configs, 'simulation_runs.failure_configs');
      if (err1) return { valid: false, error: err1 };
      const err2 = validateJsonbSize(clean.metrics, 'simulation_runs.metrics');
      if (err2) return { valid: false, error: err2 };
    } else if (table === 'recovery_events') {
      if (!['selected', 'applied', 'undone', 'reset'].includes(clean.event_type)) return { valid: false, error: `Invalid recovery_events event_type: ${clean.event_type}` };
      if (clean.plan_stats) {
        const err = validateJsonbSize(clean.plan_stats, 'recovery_events.plan_stats');
        if (err) return { valid: false, error: err };
      }
    } else if (table === 'readiness_audits') {
      if (!['N-1', 'N-2'].includes(clean.mode)) return { valid: false, error: `Invalid readiness_audits mode: ${clean.mode}` };
      const sc = Number(clean.score);
      if (!Number.isFinite(sc) || sc < 0 || sc > 100) return { valid: false, error: 'readiness_audits score must be between 0 and 100' };
      const err = validateJsonbSize(clean.results || {}, 'readiness_audits.results');
      if (err) return { valid: false, error: err };
    } else if (table === 'notifications') {
      if (!clean.audience || !String(clean.audience).trim() || !clean.message || !String(clean.message).trim()) {
        return { valid: false, error: 'notifications requires non-empty audience and message' };
      }
    } else if (table === 'app_log') {
      if (!['debug', 'info', 'warn', 'error'].includes(clean.level || 'info')) return { valid: false, error: `Invalid app_log level: ${clean.level}` };
      if (!clean.message || !String(clean.message).trim()) return { valid: false, error: 'app_log requires non-empty message' };
      const err = validateJsonbSize(clean.context || {}, 'app_log.context');
      if (err) return { valid: false, error: err };
    }
    return { valid: true, payload: clean };
  }

  // ==================== AUTHORITATIVE STATUS MACHINE ====================

  function isServiceRoleKey(keyStr) {
    try {
      const parts = String(keyStr || '').split('.');
      if (parts.length !== 3) return false;
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const payload = JSON.parse(global.atob(padded));
      return payload && payload.role === 'service_role';
    } catch (_) { return false; }
  }

  function getOutbox() { return readJsonArray(OUTBOX_STORAGE_KEY); }
  function setOutbox(list) { writeJsonArray(OUTBOX_STORAGE_KEY, list); }
  function getDeadLetters() { return readJsonArray(DEAD_LETTER_KEY); }

  function pushDeadLetter(opItem, reason, code = null) {
    const dl = getDeadLetters().filter((d) => d.opId !== opItem.opId);
    dl.push({
      ...opItem,
      failedAt: new Date().toISOString(),
      failureCode: code || null,
      failureReason: String(reason || 'Unknown error')
    });
    writeJsonArray(DEAD_LETTER_KEY, dl.slice(-100));
  }

  function computeIsOnline() {
    if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) return false;
    return configured && authReady && sessionConfirmed && connectionState === 'connected';
  }

  function computeDerivedStatus(outboxLen, deadLen) {
    if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) return 'offline';
    if (!configured || connectionState === 'offline') return 'offline';
    if (connectionState === 'connecting') return 'connecting';
    if (connectionState === 'connection_failed') return 'connection_failed';
    if (syncState === 'syncing') return 'syncing';
    if (syncState === 'sync_failed' || deadLen > 0) return 'sync_failed';
    if (outboxLen > 0) return 'syncing';
    return 'online'; // 'Connected' — only after auth, session confirmation, and 0 pending writes
  }

  function buildStatusSnapshot() {
    const outbox = getOutbox();
    const dead = getDeadLetters();
    const status = computeDerivedStatus(outbox.length, dead.length);
    return {
      status,
      connectionState,
      syncState,
      isOnline: computeIsOnline(),
      sessionConfirmed,
      pendingCount: outbox.length,
      deadLetterCount: dead.length,
      configured,
      authReady,
      sessionId,
      userId,
      userEmail,
      lastError: lastSyncError || lastConnectionError,
      lastConnectionError,
      lastSyncError
    };
  }

  function emitStatus() {
    const snap = buildStatusSnapshot();
    statusListeners.forEach((fn) => { try { fn(snap); } catch (_) {} });
    try { global.dispatchEvent(new global.CustomEvent(STATUS_EVENT_NAME, { detail: snap })); } catch (_) {}
    return snap;
  }

  function setConnectionState(nextConn, errMsg = null) {
    connectionState = nextConn;
    lastConnectionError = errMsg || null;
    return emitStatus();
  }

  function setSyncState(nextSync, errMsg = null) {
    syncState = nextSync;
    lastSyncError = errMsg || null;
    return emitStatus();
  }

  // ==================== CONFIG, AUTH & CONFIRMED SESSION INIT ====================

  function validateConfig() {
    const cfg = global.OMNIS_CONFIG;
    if (!cfg || typeof cfg !== 'object') return { valid: false, reason: 'window.OMNIS_CONFIG not present (running in local-only mode).' };
    let url = String(cfg.SUPABASE_URL || '').trim().replace(/\/+$/, '');
    const key = String(cfg.SUPABASE_ANON_KEY || '').trim();
    if (!url || !key || url.includes('YOUR_PROJECT_REF') || key.includes('YOUR_SUPABASE_ANON_KEY')) {
      return { valid: false, reason: 'Supabase config contains placeholder or empty values.' };
    }
    if (!/^https?:\/\/.+/i.test(url)) return { valid: false, reason: 'Invalid SUPABASE_URL scheme.' };
    try {
      const parsedUrl = new URL(url);
      if (parsedUrl.pathname && parsedUrl.pathname !== '/') url = parsedUrl.origin;
    } catch (_) {}
    if (isServiceRoleKey(key)) return { valid: false, reason: 'Blocked service_role key in browser config. Use anon key only.' };
    if (!global.supabase || typeof global.supabase.createClient !== 'function') {
      return { valid: false, reason: 'Supabase CDN client unavailable (offline or blocked).' };
    }
    return { valid: true, url, key, appVersion: String(cfg.APP_VERSION || '1.0.0'), sessionLabel: String(cfg.SESSION_LABEL || 'JGIT Campus Session') };
  }

  function ensureSupabaseClient() {
    const check = validateConfig();
    if (!check.valid) {
      configured = false;
      restConfig = null;
      return { ok: false, check, error: check.reason };
    }
    configured = true;
    restConfig = { url: check.url, key: check.key };
    try {
      if (!client) {
        client = global.supabase.createClient(check.url, check.key, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
        });
        client.auth.onAuthStateChange((ev, sess) => {
          accessToken = sess ? sess.access_token : null;
          if (sess && sess.user && !sess.user.is_anonymous) {
            userId = sess.user.id;
            userEmail = sess.user.email || null;
            authReady = true;
          } else if (ev === 'SIGNED_OUT') {
            authReady = false;
            sessionConfirmed = false;
            userId = null;
            userEmail = null;
            userRole = null;
            studentId = null;
            studentProfile = null;
            accessToken = null;
            readyPromise = null;
            setConnectionState('offline', 'Signed out');
            try { global.dispatchEvent(new global.CustomEvent(AUTH_SIGNOUT_EVENT_NAME)); } catch (_) {}
          }
        });
      }
      return { ok: true, check, client };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      configured = false;
      return { ok: false, check, error: msg };
    }
  }

  function isValidEmailUserSession(sess) {
    return Boolean(sess && sess.user && !sess.user.is_anonymous && sess.user.email);
  }

  async function getAuthSession() {
    const init = ensureSupabaseClient();
    if (!init.ok || !client) {
      authReady = false;
      userId = null;
      userEmail = null;
      accessToken = null;
      return { authenticated: false, configured: init.check ? init.check.valid : false, user: null, session: null, error: init.error || 'Supabase unavailable' };
    }
    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      const sess = data && data.session ? data.session : null;
      if (!isValidEmailUserSession(sess)) {
        // Clear any leftover legacy anonymous session so unauthenticated users must sign in cleanly
        if (sess && sess.user && sess.user.is_anonymous) {
          try { await client.auth.signOut(); } catch (_) {}
        }
        authReady = false;
        sessionConfirmed = false;
        userId = null;
        userEmail = null;
        userRole = null;
        studentId = null;
        studentProfile = null;
        accessToken = null;
        return { authenticated: false, configured: true, user: null, session: null, role: null, studentId: null, profile: null, error: null };
      }
      userId = sess.user.id;
      userEmail = sess.user.email || null;
      accessToken = sess.access_token || null;
      authReady = true;
      const roleInfo = await resolveUserRole();
      return {
        authenticated: true,
        configured: true,
        user: sess.user,
        session: sess,
        role: roleInfo.role,
        studentId: roleInfo.studentId,
        profile: roleInfo.profile,
        roleError: roleInfo.error || null,
        error: null
      };
    } catch (err) {
      return { authenticated: false, configured: true, user: null, session: null, role: null, studentId: null, profile: null, error: err && err.message ? err.message : String(err) };
    }
  }

  async function resolveUserRole() {
    if (!client || !userId) {
      return { role: null, studentId: null, profile: null, error: 'Not authenticated' };
    }
    try {
      const { data, error } = await client
        .from('user_roles')
        .select('role,student_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) {
        const msg = String(error.message || '');
        const code = String(error.code || '');
        const tableMissing = code === 'PGRST205' || code === '42P01' || msg.includes('user_roles');
        // Graceful fallback ONLY if migration 002 hasn't been applied yet and user is not a student domain email
        if (tableMissing && userEmail && !String(userEmail).toLowerCase().endsWith('@students.omnisx.com')) {
          userRole = 'admin';
          studentId = null;
          studentProfile = null;
          return { role: 'admin', studentId: null, profile: null, migrationPending: true, error: null };
        }
        userRole = null;
        studentId = null;
        studentProfile = null;
        return { role: 'unauthorized', studentId: null, profile: null, error: msg || 'Role lookup failed' };
      }

      if (!data || !data.role) {
        userRole = null;
        studentId = null;
        studentProfile = null;
        return { role: 'unauthorized', studentId: null, profile: null, error: 'Account has no assigned OMNIS-X role in user_roles.' };
      }

      if (data.role === 'student') {
        userRole = 'student';
        studentId = data.student_id || null;
        const profRes = await fetchStudentProfile(studentId);
        if (!profRes.ok || !profRes.profile) {
          return { role: 'unauthorized', studentId, profile: null, error: profRes.error || 'Student profile mapping not found.' };
        }
        studentProfile = profRes.profile;
        return { role: 'student', studentId: studentProfile.student_id, profile: studentProfile, error: null };
      }

      if (data.role === 'admin') {
        userRole = 'admin';
        studentId = null;
        studentProfile = null;
        return { role: 'admin', studentId: null, profile: null, error: null };
      }

      return { role: 'unauthorized', studentId: null, profile: null, error: 'Unsupported role' };
    } catch (err) {
      return { role: 'unauthorized', studentId: null, profile: null, error: err && err.message ? err.message : String(err) };
    }
  }

  async function fetchStudentProfile(targetStudentId) {
    if (!client || !userId) return { ok: false, profile: null, error: 'Not authenticated' };
    try {
      let query = client
        .from('student_profiles')
        .select('student_id,full_name,department,semester,section_id,bus_id,hostel_id')
        .eq('user_id', userId);
      if (targetStudentId) {
        query = client
          .from('student_profiles')
          .select('student_id,full_name,department,semester,section_id,bus_id,hostel_id')
          .eq('student_id', targetStudentId);
      }
      const { data, error } = await query.maybeSingle();
      if (error) return { ok: false, profile: null, error: error.message || 'Could not load student profile' };
      if (!data) return { ok: false, profile: null, error: 'No matching student profile record authorized for this user.' };
      return { ok: true, profile: data, error: null };
    } catch (err) {
      return { ok: false, profile: null, error: err && err.message ? err.message : String(err) };
    }
  }

  async function signInWithPassword(email, password) {
    const cleanEmail = String(email || '').trim();
    const rawPw = String(password || '');
    if (!cleanEmail || !rawPw) {
      return { ok: false, error: 'Email and password are required.' };
    }
    const init = ensureSupabaseClient();
    if (!init.ok || !client) {
      setConnectionState('connection_failed', init.error || 'Supabase unavailable');
      return { ok: false, error: init.error || 'Supabase client is not configured.' };
    }
    if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) {
      return { ok: false, error: 'You appear to be offline. Connect to the internet to authenticate.' };
    }
    setConnectionState('connecting', null);
    try {
      const { data, error } = await client.auth.signInWithPassword({ email: cleanEmail, password: rawPw });
      if (error) {
        setConnectionState('offline', error.message);
        return { ok: false, error: error.message || 'Invalid credentials', code: error.code || null };
      }
      if (!data || !data.session || !data.user) {
        setConnectionState('offline', 'Authentication returned no session');
        return { ok: false, error: 'Authentication failed: no active session returned.' };
      }
      userId = data.user.id;
      userEmail = data.user.email || cleanEmail;
      accessToken = data.session.access_token || null;
      authReady = true;

      const roleInfo = await resolveUserRole();
      if (roleInfo.role === 'admin') {
        readyPromise = null;
        await ready();
        return { ok: true, user: data.user, session: data.session, role: 'admin', studentId: null, profile: null, error: null };
      }
      if (roleInfo.role === 'student') {
        sessionConfirmed = false;
        setConnectionState('connected', null);
        return {
          ok: true,
          user: data.user,
          session: data.session,
          role: 'student',
          studentId: roleInfo.studentId,
          profile: roleInfo.profile,
          error: null
        };
      }

      try { await client.auth.signOut(); } catch (_) {}
      authReady = false;
      userId = null;
      userEmail = null;
      accessToken = null;
      setConnectionState('offline', roleInfo.error || 'Unauthorized role');
      return { ok: false, error: roleInfo.error || 'Your account does not have an assigned institutional role.' };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      setConnectionState('connection_failed', msg);
      return { ok: false, error: msg };
    }
  }

  async function signOutUser() {
    if (retryTimerId) { clearTimeout(retryTimerId); retryTimerId = null; }
    debounceTimers.forEach((t) => clearTimeout(t));
    debounceTimers.clear();
    unsubscribeStudentUpdates();

    try {
      if (client && authReady && userRole === 'admin' && sessionConfirmed && (typeof global.navigator === 'undefined' || global.navigator.onLine !== false)) {
        await flushOutbox(true);
      }
    } catch (_) {}

    try {
      if (client) await client.auth.signOut();
    } catch (_) {}

    authReady = false;
    sessionConfirmed = false;
    userId = null;
    userEmail = null;
    userRole = null;
    studentId = null;
    studentProfile = null;
    accessToken = null;
    readyPromise = null;
    syncState = 'idle';
    lastSyncError = null;
    sessionId = null;

    try {
      global.localStorage.removeItem(SESSION_STORAGE_KEY);
      global.localStorage.removeItem(CACHE_STORAGE_KEY);
      global.localStorage.removeItem(OUTBOX_STORAGE_KEY);
      global.localStorage.removeItem(DEAD_LETTER_KEY);
    } catch (_) {}

    setConnectionState('offline', 'Signed out');
    return { ok: true, error: null };
  }

  async function ensureAuthenticatedSession() {
    const auth = await getAuthSession();
    if (!auth.authenticated || !auth.user) {
      return { ok: false, requiresAuth: true, error: auth.error || 'Authentication required' };
    }
    return { ok: true, userId: auth.user.id, email: auth.user.email };
  }

  /**
   * Rebind stale uncommitted session_ids in outbox & cache whenever sessionId changes or was never created.
   */
  function rebindStaleSessionInStorage(oldSid, newSid) {
    if (!newSid) return 0;
    let rebound = 0;
    const outbox = getOutbox().map((item) => {
      if (item && item.payload && Object.prototype.hasOwnProperty.call(item.payload, 'session_id')) {
        if (!oldSid || item.payload.session_id === oldSid || !item.payload.session_id) {
          rebound++;
          return { ...item, payload: { ...item.payload, session_id: newSid } };
        }
      }
      return item;
    });
    if (rebound > 0) setOutbox(outbox);
    return rebound;
  }

  /**
   * Ensure a confirmed sim_sessions row exists for the current authenticated user_id.
   * Reuses valid existing sessions; safely replaces stale/foreign local sessionIds without losing outbox records.
   */
  async function ensureConfirmedSession(meta) {
    if (!client || !userId) return { ok: false, error: 'Authentication required before confirming session' };
    sessionId = getOrCreateSessionId();
    const nowIso = new Date().toISOString();

    try {
      // 1) Check if current sessionId exists in Postgres for this authenticated user
      const { data: existing, error: selErr } = await client
        .from('sim_sessions')
        .select('id,user_id')
        .eq('id', sessionId)
        .maybeSingle();

      if (selErr) throw selErr;

      if (existing && existing.id === sessionId && existing.user_id === userId) {
        // Reuse & touch existing valid session
        const { error: updErr } = await client
          .from('sim_sessions')
          .update({ label: meta.sessionLabel, app_version: meta.appVersion, last_seen: nowIso })
          .eq('id', sessionId)
          .eq('user_id', userId);
        if (updErr) throw updErr;
        sessionConfirmed = true;
        return { ok: true, sessionId, reused: true };
      }

      // 2) Not found under current user -> attempt creating this sessionId row cleanly
      const newRow = {
        id: sessionId,
        user_id: userId,
        label: meta.sessionLabel,
        app_version: meta.appVersion,
        last_seen: nowIso
      };
      const { data: insData, error: insErr } = await client
        .from('sim_sessions')
        .insert(newRow)
        .select('id')
        .single();

      if (!insErr && insData && insData.id === sessionId) {
        sessionConfirmed = true;
        return { ok: true, sessionId, created: true };
      }

      // 3) If stale sessionId collided with another owner's row (42501 / 23505), rotate safely
      const errCode = String((insErr && insErr.code) || '');
      if (insErr && (errCode === '42501' || errCode === '23505')) {
        const previousSid = sessionId;
        sessionId = generateUUID();
        safeStorageSet(SESSION_STORAGE_KEY, sessionId);
        const { data: rotData, error: rotErr } = await client
          .from('sim_sessions')
          .insert({
            id: sessionId,
            user_id: userId,
            label: meta.sessionLabel,
            app_version: meta.appVersion,
            last_seen: nowIso
          })
          .select('id')
          .single();
        if (rotErr || !rotData) throw rotErr || new Error('Failed to confirm rotated session');
        rebindStaleSessionInStorage(previousSid, sessionId);
        sessionConfirmed = true;
        return { ok: true, sessionId, rotated: true };
      }

      if (insErr) throw insErr;
      sessionConfirmed = true;
      return { ok: true, sessionId };
    } catch (err) {
      sessionConfirmed = false;
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  async function initClientAndAuth() {
    sessionId = getOrCreateSessionId();
    sessionConfirmed = false;
    const init = ensureSupabaseClient();
    if (!init.ok) {
      authReady = false;
      if (init.error && init.error.includes('service_role')) {
        console.error('[OMNIS_DB]', init.error);
        setConnectionState('connection_failed', init.error);
      } else {
        setConnectionState('offline', init.error || 'Supabase not configured');
      }
      return { ok: false, offline: true, sessionId, userId: null, error: init.error };
    }

    if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) {
      setConnectionState('offline', 'Browser is offline');
      return { ok: false, offline: true, sessionId, userId: null, error: 'Browser is offline' };
    }

    setConnectionState('connecting', null);

    const authRes = await ensureAuthenticatedSession();
    if (!authRes.ok) {
      authReady = false;
      setConnectionState('offline', authRes.error);
      return { ok: false, requiresAuth: Boolean(authRes.requiresAuth), offline: false, sessionId, userId: null, error: authRes.error };
    }
    authReady = true;

    const sessRes = await ensureConfirmedSession(init.check);
    if (!sessRes.ok) {
      setConnectionState('connection_failed', sessRes.error);
      return { ok: false, offline: true, sessionId, userId, error: sessRes.error };
    }

    setConnectionState('connected', null);
    await reconcileAndFlush();
    return { ok: true, offline: false, sessionId, userId, error: null };
  }

  function ready() {
    if (!readyPromise) readyPromise = initClientAndAuth();
    return readyPromise;
  }

  function resetOutboxBackoff() {
    if (retryTimerId) { clearTimeout(retryTimerId); retryTimerId = null; }
    const outbox = getOutbox();
    if (outbox.some((it) => it.nextRetryAt && it.nextRetryAt > 0)) {
      setOutbox(outbox.map((it) => ({ ...it, nextRetryAt: 0 })));
    }
  }

  async function touchSession() {
    try {
      if (!configured || !authReady || !sessionConfirmed) {
        readyPromise = null;
        return await ready();
      }
      setConnectionState('connecting', null);
      const res = await ensureConfirmedSession(validateConfig());
      if (!res.ok) {
        setConnectionState('connection_failed', res.error);
        return { ok: false, error: res.error };
      }
      resetOutboxBackoff();
      setConnectionState('connected', null);
      const flushRes = await reconcileAndFlush(true);
      return { ok: true, syncOk: flushRes.ok, syncError: flushRes.error || null, error: null };
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      setConnectionState('connection_failed', msg);
      return { ok: false, error: msg };
    }
  }

  // ==================== ERROR CLASSIFICATION & RECONCILIATION ====================

  function computeBackoffMs(attempts) {
    const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1)));
    const jitter = Math.floor(Math.random() * Math.min(1000, exp * 0.25));
    return Math.min(MAX_BACKOFF_MS, exp + jitter);
  }

  function classifyDbError(err) {
    const code = String((err && err.code) || '');
    const status = Number((err && err.status) || 0);
    const msg = String((err && err.message) || '').toLowerCase();
    const hasDbCode = Boolean(code) && (code.length === 5 || code.startsWith('PGRST'));
    const isFk = code === '23503' || msg.includes('foreign key constraint');
    const isNetwork = !hasDbCode && (
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('network error') ||
      msg.includes('load failed') ||
      msg.includes('timeout') ||
      status >= 500 ||
      status === 429
    );
    const isConstraint = !isNetwork && (
      isFk ||
      ['23514', '23502', '22P02', '42703', '42501', 'PGRST204'].includes(code) ||
      status === 400 || status === 401 || status === 403 || status === 409 ||
      msg.includes('violates check constraint') || msg.includes('invalid input syntax') || msg.includes('permission denied')
    );
    return {
      isFk,
      isNetwork,
      permanent: isConstraint,
      code: code || (status ? `HTTP_${status}` : 'ERR'),
      message: (err && err.message) ? err.message : String(err || 'Database error')
    };
  }

  function logAppEventSync(level, message, context = {}) {
    try {
      if (level === 'error') console.error('[OMNIS_DB]', message, context);
      else if (level === 'warn') console.warn('[OMNIS_DB]', message, context);
    } catch (_) {}

    const payload = sanitizeJsonValue({
      session_id: sessionConfirmed ? sessionId : null,
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
   * Reconcile dead-lettered / queued records that failed earlier because of pre-auth setup,
   * stale uncommitted local session IDs, or parent simulation_runs not yet flushed.
   */
  async function reconcilePendingAndDeadLetterRecords() {
    if (!client || !userId || !sessionConfirmed || !sessionId) return;

    let outbox = getOutbox();
    const deadLetters = getDeadLetters();
    const remainingDead = [];
    let rescuedCount = 0;

    // 1) Rescue earlier FK/setup-blocked rows safely back into outbox for reconciliation
    deadLetters.forEach((dl) => {
      const reasonLower = String(dl.failureReason || '').toLowerCase();
      const recoverableSetupOrFk =
        dl.failureCode === '23503' ||
        reasonLower.includes('foreign key constraint') ||
        reasonLower.includes('permission denied') ||
        reasonLower.includes('anonymous sign-ins are disabled');

      if (recoverableSetupOrFk && dl.table && dl.payload && ON_CONFLICT_BY_TABLE[dl.table]) {
        const cleanItem = {
          opId: dl.opId || generateUUID(),
          table: dl.table,
          op: dl.op || 'upsert',
          onConflict: dl.onConflict || ON_CONFLICT_BY_TABLE[dl.table],
          dedupeKey: dl.dedupeKey || null,
          payload: dl.payload,
          clientUpdatedAt: dl.clientUpdatedAt || new Date().toISOString(),
          attempts: 0,
          repairedOnce: false,
          ts: dl.ts || Date.now(),
          nextRetryAt: 0
        };
        if (!outbox.some((o) => o.opId === cleanItem.opId)) {
          outbox.push(cleanItem);
          rescuedCount++;
        }
      } else {
        remainingDead.push(dl);
      }
    });

    if (rescuedCount > 0) {
      writeJsonArray(DEAD_LETTER_KEY, remainingDead);
      setOutbox(outbox);
    }

    if (outbox.length === 0) {
      return;
    }

    // 2) Verify all referenced session_ids against existing sim_sessions owned by auth.uid()
    const distinctSids = Array.from(new Set(
      outbox.map((o) => o.payload && o.payload.session_id).filter(Boolean)
    ));
    const validSids = new Set([sessionId]);
    const otherSids = distinctSids.filter((s) => s !== sessionId);
    if (otherSids.length > 0) {
      try {
        const { data } = await client.from('sim_sessions').select('id').in('id', otherSids);
        if (Array.isArray(data)) data.forEach((r) => validSids.add(r.id));
      } catch (_) {}
    }

    // Re-read outbox after network awaits so concurrent enqueueWrite calls are NEVER overwritten
    let latestOutbox = getOutbox();
    const queuedRunIds = new Set(
      latestOutbox
        .filter((o) => o.table === 'simulation_runs' && o.payload)
        .map((o) => o.payload.id || o.payload.client_run_id)
        .filter(Boolean)
    );

    const referencedUnqueuedRunIds = Array.from(new Set(
      latestOutbox
        .filter((o) => (o.table === 'recovery_events' || o.table === 'notifications') && o.payload && o.payload.run_id && !queuedRunIds.has(o.payload.run_id))
        .map((o) => o.payload.run_id)
    ));

    const validRemoteRunIds = new Set();
    if (referencedUnqueuedRunIds.length > 0) {
      try {
        const { data } = await client.from('simulation_runs').select('id').in('id', referencedUnqueuedRunIds);
        if (Array.isArray(data)) data.forEach((r) => validRemoteRunIds.add(r.id));
      } catch (_) {}
    }

    // Re-read fresh outbox again right before patching
    latestOutbox = getOutbox();
    const latestQueuedRunIds = new Set(
      latestOutbox
        .filter((o) => o.table === 'simulation_runs' && o.payload)
        .map((o) => o.payload.id || o.payload.client_run_id)
        .filter(Boolean)
    );

    let repairedSids = 0;
    let detachedOrphanRuns = 0;

    latestOutbox = latestOutbox.map((item) => {
      if (!item || !item.payload) return item;
      const nextPayload = { ...item.payload };

      if (Object.prototype.hasOwnProperty.call(nextPayload, 'session_id')) {
        if (item.table === 'app_log') {
          if (nextPayload.session_id && !validSids.has(nextPayload.session_id)) {
            nextPayload.session_id = sessionId;
            repairedSids++;
          }
        } else if (!nextPayload.session_id || !validSids.has(nextPayload.session_id)) {
          nextPayload.session_id = sessionId;
          repairedSids++;
        }
      }

      if ((item.table === 'recovery_events' || item.table === 'notifications') && nextPayload.run_id) {
        if (!latestQueuedRunIds.has(nextPayload.run_id) && !validRemoteRunIds.has(nextPayload.run_id)) {
          nextPayload.run_id = null;
          detachedOrphanRuns++;
        }
      }

      return { ...item, payload: nextPayload };
    });

    setOutbox(latestOutbox);

    if (rescuedCount > 0 || repairedSids > 0 || detachedOrphanRuns > 0) {
      logAppEventSync('info', 'Reconciled pending/dead-lettered records against confirmed session', {
        rescuedCount,
        repairedSids,
        detachedOrphanRuns,
        confirmedSessionId: sessionId
      });
    }
  }

  // ==================== WRITE-AHEAD OUTBOX & DEPENDENCY-ORDERED FLUSH ====================

  function enqueueWrite(table, rawPayload, opts = {}) {
    if (!ON_CONFLICT_BY_TABLE[table]) return Promise.resolve({ ok: false, error: `Unsupported table: ${table}` });
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
      repairedOnce: false,
      ts: Date.now(),
      nextRetryAt: 0
    };

    const outbox = getOutbox();
    const filtered = opItem.dedupeKey
      ? outbox.filter((item) => !(item.table === table && item.dedupeKey === opItem.dedupeKey))
      : outbox;
    filtered.push(opItem);
    setOutbox(filtered);

    if (computeIsOnline()) {
      setSyncState('syncing', null);
    } else {
      emitStatus();
    }

    if (opts.debounceMs && opts.debounceMs > 0) {
      const timerKey = opts.debounceKey || table;
      if (debounceTimers.has(timerKey)) clearTimeout(debounceTimers.get(timerKey));
      const tid = setTimeout(() => { debounceTimers.delete(timerKey); flushOutbox(); }, opts.debounceMs);
      debounceTimers.set(timerKey, tid);
    } else {
      flushOutbox();
    }
    return Promise.resolve({ ok: true, opId: opItem.opId, error: null });
  }

  async function checkOptimisticConcurrency(item) {
    if (item.table !== 'failure_queue' || !client || !userId || !item.payload.session_id || !item.payload.client_id) {
      return { proceed: true };
    }
    try {
      const { data, error } = await client
        .from('failure_queue')
        .select('updated_at')
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
    if (retryTimerId) { clearTimeout(retryTimerId); retryTimerId = null; }
    if (!Number.isFinite(delayMs) || delayMs < 0) return;
    retryTimerId = setTimeout(() => { retryTimerId = null; flushOutbox(); }, delayMs);
  }

  async function processSingleBatch(batch) {
    const first = batch[0];
    const rowsToWrite = [];
    for (const item of batch) {
      if (item.table === 'failure_queue') {
        const occ = await checkOptimisticConcurrency(item);
        if (!occ.proceed) continue;
      }
      const row = { ...item.payload, user_id: userId };
      if (Object.prototype.hasOwnProperty.call(row, 'session_id') && !row.session_id && item.table !== 'app_log') {
        row.session_id = sessionId;
      }
      rowsToWrite.push(row);
    }
    if (rowsToWrite.length === 0) return { ok: true };
    const { error } = await client.from(first.table).upsert(rowsToWrite, { onConflict: first.onConflict });
    return error ? { ok: false, error } : { ok: true };
  }

  async function reconcileAndFlush(forceResetBackoff = false) {
    if (forceResetBackoff) resetOutboxBackoff();
    if (flushInFlight) await flushInFlight;
    return flushOutbox(forceResetBackoff);
  }

  async function flushOutbox(forceImmediate = false) {
    if (flushInFlight) {
      if (!forceImmediate) return flushInFlight;
      await flushInFlight;
    }
    if (forceImmediate) resetOutboxBackoff();

    flushInFlight = (async () => {
      try {
        if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) {
          setConnectionState('offline', 'Network offline');
          return { ok: false, flushed: 0, remaining: getOutbox().length, error: 'Network offline' };
        }

        if (!configured || !client || !authReady || !sessionConfirmed) {
          const boot = await ready();
          if (!boot.ok || !sessionConfirmed) {
            return { ok: false, flushed: 0, remaining: getOutbox().length, error: boot.error || 'Connection not ready' };
          }
        }

        // Reconcile stale/dead-lettered records ONCE against confirmed DB session before ordering batches
        await reconcilePendingAndDeadLetterRecords();

        let remaining = getOutbox();
        if (remaining.length === 0) {
          setSyncState(getDeadLetters().length > 0 ? 'sync_failed' : 'synced', getDeadLetters().length > 0 ? 'Some historical records could not sync' : null);
          return { ok: getDeadLetters().length === 0, flushed: 0, remaining: 0, error: lastSyncError };
        }

        setSyncState('syncing', null);
        let flushedCount = 0;
        let soonestRetryMs = null;

        while (remaining.length > 0) {
          const now = Date.now();
          const readyItems = remaining
            .filter((it) => !it.nextRetryAt || it.nextRetryAt <= now)
            .sort((a, b) => {
              const pa = TABLE_SYNC_PRIORITY[a.table] ?? 99;
              const pb = TABLE_SYNC_PRIORITY[b.table] ?? 99;
              if (pa !== pb) return pa - pb;
              return (a.ts || 0) - (b.ts || 0);
            });

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
            const info = classifyDbError(res.error);

            // If a parent session/run wasn't confirmed or stale FK hit on first attempt, attempt ONE parent re-verify & repair
            if (info.isFk && batch.some((b) => !b.repairedOnce)) {
              await ensureConfirmedSession(validateConfig());
              await reconcilePendingAndDeadLetterRecords();
              const marked = getOutbox().map((it) => (batchOpIds.has(it.opId) ? { ...it, repairedOnce: true } : it));
              setOutbox(marked);
              remaining = marked;
              const retryRes = await processSingleBatch(marked.filter((it) => batchOpIds.has(it.opId)));
              if (retryRes.ok) {
                remaining = getOutbox().filter((it) => !batchOpIds.has(it.opId));
                setOutbox(remaining);
                flushedCount += batch.length;
                continue;
              }
            }

            const updatedRemaining = [];
            for (const item of remaining) {
              if (!batchOpIds.has(item.opId)) {
                updatedRemaining.push(item);
                continue;
              }
              const nextAttempts = (item.attempts || 0) + 1;
              // Never blindly retry permanent FK / constraint errors 8 times
              if (info.permanent || nextAttempts >= MAX_ATTEMPTS) {
                pushDeadLetter(item, info.message, info.code);
                if (item.table !== 'app_log') {
                  logAppEventSync('error', `Moved ${item.table} write to dead-letter (${info.code}): ${info.message}`, {
                    opId: item.opId, table: item.table, attempts: nextAttempts
                  });
                }
              } else {
                const backoff = computeBackoffMs(nextAttempts);
                soonestRetryMs = soonestRetryMs === null ? backoff : Math.min(soonestRetryMs, backoff);
                updatedRemaining.push({ ...item, attempts: nextAttempts, nextRetryAt: Date.now() + backoff, lastError: info.message });
              }
            }

            setOutbox(updatedRemaining);
            if (info.isNetwork) {
              setConnectionState('connection_failed', info.message);
            } else {
              // Supabase IS reachable — mark Sync Failed rather than Connection Failed
              setConnectionState('connected', null);
              setSyncState('sync_failed', info.message);
            }
            if (soonestRetryMs !== null) scheduleRetry(soonestRetryMs);
            return { ok: false, flushed: flushedCount, remaining: updatedRemaining.length, error: info.message };
          }
        }

        if (soonestRetryMs !== null) scheduleRetry(soonestRetryMs);
        const dlCount = getDeadLetters().length;
        if (remaining.length > 0) {
          setSyncState('syncing', null);
        } else if (dlCount > 0) {
          setSyncState('sync_failed', `${dlCount} failed sync item(s) in dead-letter queue`);
        } else {
          setSyncState('synced', null);
        }
        return { ok: remaining.length === 0 && dlCount === 0, flushed: flushedCount, remaining: remaining.length, error: lastSyncError };
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        setSyncState('sync_failed', msg);
        return { ok: false, flushed: 0, remaining: getOutbox().length, error: msg };
      } finally {
        flushInFlight = null;
      }
    })();

    return flushInFlight;
  }

  function flushOnUnload() {
    const queue = getOutbox();
    if (!queue.length || !configured || !authReady || !sessionConfirmed || !restConfig || !accessToken || !userId || typeof global.fetch !== 'function') return;

    const sorted = [...queue]
      .filter((it) => !it.nextRetryAt || it.nextRetryAt <= Date.now())
      .sort((a, b) => (TABLE_SYNC_PRIORITY[a.table] ?? 99) - (TABLE_SYNC_PRIORITY[b.table] ?? 99));

    const grouped = new Map();
    sorted.slice(0, MAX_BATCH_SIZE).forEach((item) => {
      const gk = `${item.table}|${item.onConflict}`;
      if (!grouped.has(gk)) grouped.set(gk, { table: item.table, onConflict: item.onConflict, rows: [] });
      grouped.get(gk).rows.push({ ...item.payload, user_id: userId });
    });

    grouped.forEach((grp) => {
      try {
        const endpoint = `${restConfig.url}/rest/v1/${encodeURIComponent(grp.table)}?on_conflict=${encodeURIComponent(grp.onConflict)}`;
        global.fetch(endpoint, {
          method: 'POST', keepalive: true,
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

  // ==================== DOMAIN PERSISTENCE HELPERS ====================

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
        return enqueueWrite('failure_queue', { session_id: sessionId, client_id: String(clientId), config: cleanCfg, position: idx, deleted: false }, {
          dedupeKey: `fq:${clientId}`, debounceMs: DEBOUNCE_QUEUE_MS, debounceKey: 'failure_queue_batch'
        });
      });
      return Promise.all(tasks).then(() => ({ ok: true, error: null }));
    } catch (err) { return Promise.resolve({ ok: false, error: err && err.message ? err.message : String(err) }); }
  }

  function softDeleteQueueItems(clientIds = []) {
    try {
      if (!sessionId) sessionId = getOrCreateSessionId();
      const existing = Array.isArray(readCache().queuedFailureConfigs) ? readCache().queuedFailureConfigs : [];
      const idSet = new Set(clientIds.map(String));
      writeCachePatch({ queuedFailureConfigs: existing.filter((x) => !idSet.has(String(x._qid))) });
      const tasks = Array.from(idSet).map((cid) =>
        enqueueWrite('failure_queue', {
          session_id: sessionId, client_id: cid,
          config: existing.find((x) => String(x._qid) === cid) || { scenarioType: 'UNKNOWN', softDeleted: true },
          position: 0, deleted: true
        }, { dedupeKey: `fq:${cid}`, debounceMs: DEBOUNCE_QUEUE_MS, debounceKey: 'failure_queue_batch' })
      );
      return Promise.all(tasks).then(() => ({ ok: true, error: null }));
    } catch (err) { return Promise.resolve({ ok: false, error: err && err.message ? err.message : String(err) }); }
  }

  function recordSimulationRun(runInput) {
    try {
      if (!sessionId) sessionId = getOrCreateSessionId();
      const runId = runInput.id || generateUUID();
      const payload = {
        id: runId, session_id: sessionId, client_run_id: runInput.client_run_id || runId,
        scenario_id: String(runInput.scenario_id || 'CUSTOM'),
        failure_configs: sanitizeJsonValue(runInput.failure_configs || []),
        metrics: sanitizeJsonValue(runInput.metrics || {}),
        impacted_count: Math.max(0, Number(runInput.impacted_count) || 0),
        campus_health_pct: Math.max(0, Math.min(100, Number(runInput.campus_health_pct) || 0))
      };
      writeCachePatch({ lastRun: { ...payload, created_at: new Date().toISOString() } });
      return enqueueWrite('simulation_runs', payload).then((r) => ({ ...r, data: payload }));
    } catch (err) { return Promise.resolve({ ok: false, error: err && err.message ? err.message : String(err) }); }
  }

  function recordRecoveryEvent(evInput) {
    try {
      if (!sessionId) sessionId = getOrCreateSessionId();
      const payload = {
        session_id: sessionId, run_id: evInput.run_id || null, client_event_id: evInput.client_event_id || generateUUID(),
        event_type: evInput.event_type, plan_rank: evInput.plan_rank || null, plan_name: evInput.plan_name || null,
        plan_stats: sanitizeJsonValue(evInput.plan_stats || {})
      };
      if (evInput.event_type === 'reset') writeCachePatch({ lastRun: null, lastRecoveryEvent: null });
      else writeCachePatch({ lastRecoveryEvent: { ...payload, created_at: new Date().toISOString() } });
      return enqueueWrite('recovery_events', payload);
    } catch (err) { return Promise.resolve({ ok: false, error: err && err.message ? err.message : String(err) }); }
  }

  function recordReadinessAudit(auditSummary, includeN2) {
    try {
      if (!sessionId) sessionId = getOrCreateSessionId();
      const compactResults = sanitizeJsonValue({
        timestamp: auditSummary.timestamp, certifiedPct: auditSummary.certifiedPct,
        avgStudentsAffected: auditSummary.avgStudentsAffected, totalUnprotectedCritical: auditSummary.totalUnprotectedCritical,
        failingIds: (auditSummary.failingItems || []).map((x) => x.id),
        items: (auditSummary.items || []).map((x) => ({
          id: x.id, name: x.name, category: x.category, studentsAffected: x.studentsAffected,
          recoveryPct: x.recoveryPct, criticalUnprotected: x.criticalUnprotected, fullyRecoverable: x.fullyRecoverable, riskScore: x.riskScore
        })),
        n2Count: (auditSummary.n2Items || []).length, n2CertifiedCount: auditSummary.n2CertifiedCount || 0
      });
      return enqueueWrite('readiness_audits', {
        session_id: sessionId, client_audit_id: generateUUID(), mode: includeN2 ? 'N-2' : 'N-1',
        score: Math.max(0, Math.min(100, Number(auditSummary.readinessScore) || 0)),
        certified_count: Math.max(0, Number(auditSummary.certifiedCount) || 0),
        total_count: Math.max(0, Number(auditSummary.totalCount) || 0),
        results: compactResults
      });
    } catch (err) { return Promise.resolve({ ok: false, error: err && err.message ? err.message : String(err) }); }
  }

  function recordNotifications(noticesList = [], runId = null) {
    try {
      if (!sessionId) sessionId = getOrCreateSessionId();
      return Promise.all((noticesList || []).map((n) => enqueueWrite('notifications', {
        session_id: sessionId, run_id: runId || null, client_notice_id: n.client_notice_id || generateUUID(),
        audience: String(n.audience || 'General'), message: String(n.message || ''), sent: Boolean(n.sent)
      }))).then(() => ({ ok: true, error: null }));
    } catch (err) { return Promise.resolve({ ok: false, error: err && err.message ? err.message : String(err) }); }
  }

  async function logAppEvent(level, message, context = {}) {
    try { logAppEventSync(level, message, context); flushOutbox(); return { ok: true, error: null }; }
    catch (err) { return { ok: false, error: err && err.message ? err.message : String(err) }; }
  }

  async function restoreSessionState() {
    try {
      const localCache = readCache();
      let restoredQueue = Array.isArray(localCache.queuedFailureConfigs) ? localCache.queuedFailureConfigs : [];
      let restoredLastRun = localCache.lastRun || null;
      let restoredRecovery = localCache.lastRecoveryEvent || null;
      let source = 'local-cache';

      const boot = await ready();
      if (boot.ok && client && userId && sessionConfirmed && sessionId) {
        const [qRes, rRes, evRes] = await Promise.all([
          client.from('failure_queue').select('client_id,config,position,deleted,updated_at').eq('session_id', sessionId).eq('deleted', false).order('position', { ascending: true }),
          client.from('simulation_runs').select('id,client_run_id,scenario_id,failure_configs,metrics,impacted_count,campus_health_pct,created_at').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(1),
          client.from('recovery_events').select('run_id,event_type,plan_rank,plan_name,plan_stats,created_at').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(1)
        ]);
        if (!qRes.error && Array.isArray(qRes.data) && qRes.data.length > 0) { restoredQueue = qRes.data.map((row) => ({ ...row.config, _qid: row.client_id })); source = 'supabase'; }
        if (!rRes.error && Array.isArray(rRes.data) && rRes.data.length > 0) { restoredLastRun = rRes.data[0]; source = 'supabase'; }
        if (!evRes.error && Array.isArray(evRes.data) && evRes.data.length > 0) {
          restoredRecovery = evRes.data[0];
          if (restoredRecovery.event_type === 'reset') { restoredLastRun = null; restoredQueue = []; }
        }
      }

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
            if (op.payload.event_type === 'reset') { restoredLastRun = null; queueMap.clear(); }
          }
        });
        restoredQueue = Array.from(queueMap.values());
      }
      return { ok: true, data: { source, queuedFailureConfigs: restoredQueue, lastRun: restoredLastRun, lastRecoveryEvent: restoredRecovery }, error: null };
    } catch (err) {
      return { ok: false, data: { source: 'fallback', queuedFailureConfigs: [], lastRun: null, lastRecoveryEvent: null }, error: err && err.message ? err.message : String(err) };
    }
  }

  async function fetchRecentRuns(limit = 10) {
    try {
      const mapById = new Map();
      getOutbox().forEach((op) => {
        if (op.table === 'simulation_runs' && op.payload) {
          mapById.set(op.payload.client_run_id, { ...op.payload, created_at: new Date(op.ts).toISOString(), pendingSync: true });
        }
      });
      const cache = readCache();
      if (cache.lastRun && !mapById.has(cache.lastRun.client_run_id)) mapById.set(cache.lastRun.client_run_id, cache.lastRun);
      const boot = await ready();
      if (boot.ok && client && userId && sessionConfirmed && sessionId) {
        const { data, error } = await client.from('simulation_runs').select('id,client_run_id,scenario_id,failure_configs,metrics,impacted_count,campus_health_pct,created_at').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(limit);
        if (!error && Array.isArray(data)) data.forEach((r) => { if (!mapById.has(r.client_run_id)) mapById.set(r.client_run_id, r); });
      }
      const list = Array.from(mapById.values()).sort((a, b) => Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0)).slice(0, limit);
      return { ok: true, data: list, error: null };
    } catch (err) { return { ok: false, data: [], error: err && err.message ? err.message : String(err) }; }
  }

  async function exportUserData() {
    try {
      const dump = { exportedAt: new Date().toISOString(), sessionId, userId, localCache: readCache(), outbox: getOutbox(), deadLetter: getDeadLetters(), remote: {} };
      const boot = await ready();
      if (boot.ok && client && userId) {
        const tables = ['sim_sessions', 'failure_queue', 'simulation_runs', 'recovery_events', 'readiness_audits', 'notifications', 'app_log'];
        await Promise.all(tables.map(async (tbl) => {
          try { const { data } = await client.from(tbl).select('*').order('created_at', { ascending: false }); dump.remote[tbl] = data || []; }
          catch (_) { dump.remote[tbl] = []; }
        }));
      }
      return { ok: true, data: dump, error: null };
    } catch (err) { return { ok: false, data: null, error: err && err.message ? err.message : String(err) }; }
  }

  function onStatusChange(cb) {
    if (typeof cb !== 'function') return () => {};
    statusListeners.add(cb);
    try { cb(buildStatusSnapshot()); } catch (_) {}
    return () => statusListeners.delete(cb);
  }

  function clearDeadLetters() {
    writeJsonArray(DEAD_LETTER_KEY, []);
    if (syncState === 'sync_failed' && getOutbox().length === 0) {
      setSyncState('synced', null);
    } else {
      emitStatus();
    }
  }

  // ==================== STUDENT RECOVERY COMMUNICATION & REALTIME ====================

  function unsubscribeStudentUpdates() {
    try {
      if (client && studentRealtimeChannel) {
        client.removeChannel(studentRealtimeChannel);
      }
    } catch (_) {}
    studentRealtimeChannel = null;
  }

  async function resolveVerifiedRunId(rawRunId) {
    if (!client || !userId || !sessionConfirmed || !rawRunId) return null;
    try {
      const { data, error } = await client
        .from('simulation_runs')
        .select('id')
        .eq('id', rawRunId)
        .maybeSingle();
      if (!error && data && data.id) return data.id;
    } catch (_) {}
    return null;
  }

  async function publishAdminRecoveryToStudents(payload = {}) {
    try {
      if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) {
        return { ok: false, error: 'Offline — cannot publish updates to Supabase.' };
      }
      const boot = await ready();
      if (!boot.ok || !client || !userId || userRole !== 'admin' || !sessionConfirmed || !sessionId) {
        return { ok: false, error: 'Admin database session not confirmed.' };
      }
      await flushOutbox(true);
      const verifiedRunId = await resolveVerifiedRunId(payload.runId || null);
      const nowIso = new Date().toISOString();

      // Mark previous active wave rows inactive (non-destructive, preserves full history)
      const { error: deactSchErr } = await client
        .from('student_schedule_updates')
        .update({ active: false, reverted_at: nowIso })
        .eq('published_by', userId)
        .eq('active', true);
      if (deactSchErr) {
        return { ok: false, error: deactSchErr.message || 'Failed to update prior student schedule rows.' };
      }

      const { error: deactNotifErr } = await client
        .from('student_notifications')
        .update({ active: false })
        .eq('published_by', userId)
        .eq('active', true);
      if (deactNotifErr) {
        return { ok: false, error: deactNotifErr.message || 'Failed to update prior student notifications.' };
      }

      const updates = Array.isArray(payload.scheduleUpdates) ? payload.scheduleUpdates : [];
      if (updates.length > 0) {
        const cleanUpdates = updates.map((u) => sanitizeJsonValue({
          published_by: userId,
          session_id: sessionId,
          run_id: verifiedRunId,
          client_update_id: String(u.client_update_id || generateUUID()),
          batch_id: String(payload.batchId || u.batch_id || generateUUID()),
          section_id: String(u.section_id),
          activity_id: String(u.activity_id),
          activity_kind: String(u.activity_kind || 'timetable'),
          subject_name: String(u.subject_name || 'Campus Session'),
          subject_code: u.subject_code ? String(u.subject_code) : null,
          change_status: String(u.change_status || 'RESCHEDULED'),
          previous_details: u.previous_details || {},
          updated_details: u.updated_details || {},
          reason: String(u.reason || 'Recovery plan applied'),
          plan_rank: u.plan_rank || null,
          plan_name: u.plan_name || null,
          resolved: Boolean(u.resolved !== false),
          active: true,
          reverted_at: null
        }));
        const { error: upErr } = await client
          .from('student_schedule_updates')
          .upsert(cleanUpdates, { onConflict: 'client_update_id' });
        if (upErr) {
          return { ok: false, error: upErr.message || 'Failed to publish student schedule updates.' };
        }
      }

      const notifs = Array.isArray(payload.notifications) ? payload.notifications : [];
      if (notifs.length > 0) {
        const cleanNotifs = notifs.map((n) => sanitizeJsonValue({
          published_by: userId,
          session_id: sessionId,
          run_id: verifiedRunId,
          client_notif_id: String(n.client_notif_id || generateUUID()),
          batch_id: String(payload.batchId || n.batch_id || generateUUID()),
          section_id: String(n.section_id),
          activity_id: n.activity_id ? String(n.activity_id) : null,
          change_status: String(n.change_status || 'RESCHEDULED'),
          title: String(n.title || 'Schedule Update'),
          description: String(n.description || ''),
          previous_summary: n.previous_summary ? String(n.previous_summary) : null,
          updated_summary: n.updated_summary ? String(n.updated_summary) : null,
          affected_date_time: n.affected_date_time ? String(n.affected_date_time) : null,
          reason: String(n.reason || 'Recovery plan applied'),
          active: true,
          reverted: false
        }));
        const { error: nErr } = await client
          .from('student_notifications')
          .upsert(cleanNotifs, { onConflict: 'client_notif_id' });
        if (nErr) {
          return { ok: false, error: nErr.message || 'Failed to publish student notifications.' };
        }
      }

      return { ok: true, updatesCount: updates.length, notificationsCount: notifs.length, error: null };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  async function revertAdminRecoveryForStudents(payload = {}) {
    try {
      if (typeof global.navigator !== 'undefined' && global.navigator.onLine === false) {
        return { ok: false, error: 'Offline — cannot revert student recovery state in Supabase.' };
      }
      const boot = await ready();
      if (!boot.ok || !client || !userId || userRole !== 'admin' || !sessionConfirmed || !sessionId) {
        return { ok: false, error: 'Admin database session not confirmed.' };
      }
      await flushOutbox(true);
      const nowIso = new Date().toISOString();

      const { data: activeRows, error: checkErr } = await client
        .from('student_schedule_updates')
        .select('id,section_id,subject_name,activity_id')
        .eq('published_by', userId)
        .eq('active', true);
      if (checkErr) {
        return { ok: false, error: checkErr.message || 'Could not query active student updates.' };
      }

      const activeSections = Array.from(new Set(
        (activeRows || []).map((r) => r.section_id).concat(Array.isArray(payload.affectedSections) ? payload.affectedSections : [])
      )).filter(Boolean);

      const { error: updSchErr } = await client
        .from('student_schedule_updates')
        .update({ active: false, reverted_at: nowIso })
        .eq('published_by', userId)
        .eq('active', true);
      if (updSchErr) {
        return { ok: false, error: updSchErr.message || 'Failed to deactivate student schedule updates.' };
      }

      const { error: updNotifErr } = await client
        .from('student_notifications')
        .update({ active: false, reverted: true })
        .eq('published_by', userId)
        .eq('active', true);
      if (updNotifErr) {
        return { ok: false, error: updNotifErr.message || 'Failed to mark prior student notifications reverted.' };
      }

      if (activeSections.length > 0 && payload.emitRevertNotice !== false) {
        const verifiedRunId = await resolveVerifiedRunId(payload.runId || null);
        const batchId = payload.batchId || generateUUID();
        const isReset = payload.eventType === 'reset';
        const revNotifs = activeSections.map((secId) => sanitizeJsonValue({
          published_by: userId,
          session_id: sessionId,
          run_id: verifiedRunId,
          client_notif_id: `${batchId}::revert::${secId}`,
          batch_id: batchId,
          section_id: secId,
          activity_id: null,
          change_status: 'REVERTED',
          title: isReset ? 'Schedule Restored (Simulation Reset)' : 'Recovery Plan Reverted — Schedule Restored',
          description: isReset
            ? `Your ${secId} timetable has been restored to the standard institutional schedule after simulation reset.`
            : `The previously applied recovery adjustments for ${secId} were reverted by the administrator. Your timetable has been restored.`,
          previous_summary: 'Applied recovery schedule overrides',
          updated_summary: 'Original baseline institutional timetable restored',
          affected_date_time: nowIso.slice(0, 10),
          reason: String(payload.reason || 'Administrator reverted applied recovery plan'),
          active: false,
          reverted: false
        }));
        const { error: revInsErr } = await client
          .from('student_notifications')
          .upsert(revNotifs, { onConflict: 'client_notif_id' });
        if (revInsErr) {
          return { ok: false, error: revInsErr.message || 'Schedule restored, but correction notification write failed.' };
        }
      }

      return { ok: true, revertedSections: activeSections, error: null };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  async function fetchStudentScheduleAndNotifications(sectionId) {
    if (!client || !userId || userRole !== 'student' || !sectionId) {
      return { ok: false, updates: [], notifications: [], error: 'Student session not authenticated.' };
    }
    try {
      const [updRes, notifRes] = await Promise.all([
        client
          .from('student_schedule_updates')
          .select('id,activity_id,activity_kind,section_id,subject_name,subject_code,change_status,previous_details,updated_details,reason,plan_rank,plan_name,resolved,active,created_at,updated_at')
          .eq('section_id', sectionId)
          .eq('active', true)
          .order('created_at', { ascending: true }),
        client
          .from('student_notifications')
          .select('id,client_notif_id,batch_id,section_id,activity_id,change_status,title,description,previous_summary,updated_summary,affected_date_time,reason,active,reverted,created_at,updated_at')
          .eq('section_id', sectionId)
          .order('created_at', { ascending: false })
          .limit(40)
      ]);
      if (updRes.error) {
        return { ok: false, updates: [], notifications: [], error: updRes.error.message || 'Could not load student schedule updates.' };
      }
      if (notifRes.error) {
        return { ok: false, updates: updRes.data || [], notifications: [], error: notifRes.error.message || 'Could not load student notifications.' };
      }
      return {
        ok: true,
        updates: Array.isArray(updRes.data) ? updRes.data : [],
        notifications: Array.isArray(notifRes.data) ? notifRes.data : [],
        error: null
      };
    } catch (err) {
      return { ok: false, updates: [], notifications: [], error: err && err.message ? err.message : String(err) };
    }
  }

  function subscribeToStudentUpdates(sectionId, onChange, onChannelStatus) {
    unsubscribeStudentUpdates();
    if (!client || !userId || userRole !== 'student' || !sectionId) {
      if (typeof onChannelStatus === 'function') onChannelStatus('FALLBACK');
      return () => {};
    }
    try {
      const chName = `omnis-student-${sectionId}-${Date.now()}`;
      studentRealtimeChannel = client
        .channel(chName)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'student_schedule_updates', filter: `section_id=eq.${sectionId}` },
          () => { if (typeof onChange === 'function') onChange('schedule'); }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'student_notifications', filter: `section_id=eq.${sectionId}` },
          () => { if (typeof onChange === 'function') onChange('notifications'); }
        )
        .subscribe((status) => {
          if (typeof onChannelStatus === 'function') {
            if (status === 'SUBSCRIBED') onChannelStatus('SUBSCRIBED');
            else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onChannelStatus('FALLBACK');
          }
        });
      return unsubscribeStudentUpdates;
    } catch (_) {
      if (typeof onChannelStatus === 'function') onChannelStatus('FALLBACK');
      return () => {};
    }
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('offline', () => setConnectionState('offline', 'Network offline'));
    global.addEventListener('online', () => {
      if (!authReady || userRole !== 'admin') return;
      if (!configured || !sessionConfirmed) { readyPromise = null; ready(); }
      else touchSession();
    });
    global.addEventListener('beforeunload', flushOnUnload);
  }
  if (typeof global.document !== 'undefined' && typeof global.document.addEventListener === 'function') {
    global.document.addEventListener('visibilitychange', () => {
      if (global.document.visibilityState === 'visible' && authReady && userRole === 'admin') flushOutbox();
    });
  }

  const dbApi = {
    STATUS_EVENT_NAME, AUTH_SIGNOUT_EVENT_NAME, ready, touchSession, getStatus: buildStatusSnapshot, onStatusChange,
    getAuthSession, resolveUserRole, fetchStudentProfile, signInWithPassword, signOutUser,
    getClient: () => client, getSessionId: () => sessionId, getUserId: () => userId, getUserEmail: () => userEmail,
    getUserRole: () => userRole, getStudentId: () => studentId, getStudentProfile: () => studentProfile,
    generateUUID, isSessionConfirmed: () => sessionConfirmed,
    enqueueWrite, flushOutbox, getOutbox, getDeadLetters, clearDeadLetters,
    saveQueueSnapshot, softDeleteQueueItems, recordSimulationRun, recordRecoveryEvent,
    recordReadinessAudit, recordNotifications, logAppEvent, restoreSessionState, fetchRecentRuns, exportUserData,
    publishAdminRecoveryToStudents, revertAdminRecoveryForStudents,
    fetchStudentScheduleAndNotifications, subscribeToStudentUpdates, unsubscribeStudentUpdates
  };

  Object.defineProperty(dbApi, 'isOnline', { enumerable: true, get: computeIsOnline });
  global.OMNIS_DB = dbApi;
  ensureSupabaseClient();
})(window);
