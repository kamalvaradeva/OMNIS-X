/**
 * OMNIS-X — JGIT Isolated Student Dashboard Controller
 * Role-enforced student portal strictly displaying institutional profile,
 * dynamic timetable (baseline + applied Supabase recovery updates),
 * and targeted recovery notifications. Never renders internal emails or admin tools.
 */

(function (global) {
  'use strict';

  const FALLBACK_POLL_MS = 12000;

  let studentState = {
    activated: false,
    profile: null,
    baseCampus: null,
    updates: [],
    notifications: [],
    viewMode: 'daily', // 'daily' | 'weekly'
    selectedDay: null,
    realtimeMode: 'connecting',
    lastError: null
  };

  let pollTimerId = null;
  let unsubscribeRealtime = null;
  let eventsBound = false;

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function getTodayWeekdayCode() {
    const idx = new Date().getDay();
    const map = { 1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri' };
    return map[idx] || null;
  }

  function formatTimestamp(isoStr) {
    if (!isoStr) return '';
    try {
      const dt = new Date(isoStr);
      if (Number.isNaN(dt.getTime())) return String(isoStr);
      return dt.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return String(isoStr);
    }
  }

  function getInitials(fullName) {
    const parts = String(fullName || 'ST').trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return 'ST';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function statusMeta(changeStatus) {
    switch (changeStatus) {
      case 'RESCHEDULED':
        return { label: 'Rescheduled', pillClass: 'status-rescheduled', cardClass: 'is-rescheduled' };
      case 'FACULTY_CHANGED':
        return { label: 'Faculty Changed', pillClass: 'status-faculty', cardClass: 'is-changed' };
      case 'CLASSROOM_CHANGED':
        return { label: 'Classroom Changed', pillClass: 'status-classroom', cardClass: 'is-changed' };
      case 'LAB_CHANGED':
        return { label: 'Laboratory Changed', pillClass: 'status-lab', cardClass: 'is-changed' };
      case 'CANCELLED':
        return { label: 'Cancelled', pillClass: 'status-cancelled', cardClass: 'is-cancelled' };
      case 'TRANSPORT_CHANGED':
        return { label: 'Bus Assignment Changed', pillClass: 'status-transport', cardClass: 'is-changed' };
      case 'INCOMPLETE_RECOVERY':
        return { label: 'Unresolved Disruption', pillClass: 'status-cancelled', cardClass: 'is-cancelled' };
      case 'REVERTED':
        return { label: 'Reverted', pillClass: 'status-reverted', cardClass: '' };
      default:
        return { label: 'Unchanged', pillClass: 'status-unchanged', cardClass: '' };
    }
  }

  function buildStudentScheduleEntries() {
    const profile = studentState.profile;
    const campus = studentState.baseCampus;
    if (!profile || !campus) return { entries: [], transportUpdates: [] };

    const secId = profile.section_id;
    const facMap = new Map(campus.faculty.map((f) => [f.id, f]));
    const roomMap = new Map([
      ...campus.classrooms.map((r) => [r.id, r]),
      ...campus.labs.map((l) => [l.id, l])
    ]);
    const slotMap = new Map(campus.meta.slots.map((s) => [s.id, s]));

    const updatesByActivity = new Map();
    const transportUpdates = [];
    (studentState.updates || []).forEach((u) => {
      if (!u || !u.active) return;
      if (u.activity_kind === 'transport') {
        transportUpdates.push(u);
      } else {
        updatesByActivity.set(u.activity_id, u);
      }
    });

    const baseActivities = [];

    (campus.timetable || [])
      .filter((t) => t.sectionId === secId)
      .forEach((t) => {
        const fac = facMap.get(t.facultyId);
        const rm = roomMap.get(t.roomId);
        const sl = slotMap.get(t.slotId);
        baseActivities.push({
          activityId: t.id,
          kind: t.activityType === 'LAB' ? 'Laboratory' : 'Lecture',
          subjectCode: t.subjectCode || '',
          subjectName: t.subjectName,
          day: t.day,
          date: campus.meta.referenceWeek ? campus.meta.referenceWeek[t.day] : '',
          slotId: t.slotId,
          timeLabel: sl ? sl.label : t.slotId,
          facultyId: t.facultyId,
          facultyName: fac ? fac.name : t.facultyId,
          roomId: t.roomId,
          roomName: rm ? rm.name : t.roomId,
          roomKind: t.roomType === 'lab' ? 'Laboratory' : 'Classroom'
        });
      });

    (campus.examinations || [])
      .filter((e) => e.sectionId === secId)
      .forEach((e) => {
        const fac = facMap.get(e.invigilatorId);
        const rm = roomMap.get(e.roomId);
        const sl = slotMap.get(e.slotId);
        baseActivities.push({
          activityId: e.id,
          kind: 'Examination',
          subjectCode: e.id,
          subjectName: e.title,
          day: e.day,
          date: e.scheduledDate || '',
          slotId: e.slotId,
          timeLabel: sl ? sl.label : e.slotId,
          facultyId: e.invigilatorId,
          facultyName: fac ? fac.name : e.invigilatorId,
          roomId: e.roomId,
          roomName: rm ? rm.name : e.roomId,
          roomKind: 'Examination Hall'
        });
      });

    (campus.placements || [])
      .filter((p) => p.sectionId === secId)
      .forEach((p) => {
        const fac = facMap.get(p.coordinatorId);
        const rm = roomMap.get(p.roomId);
        const sl = slotMap.get(p.slotId);
        baseActivities.push({
          activityId: p.id,
          kind: 'Placement Drive',
          subjectCode: p.id,
          subjectName: p.title,
          day: p.day,
          date: p.scheduledDate || '',
          slotId: p.slotId,
          timeLabel: sl ? sl.label : p.slotId,
          facultyId: p.coordinatorId,
          facultyName: fac ? fac.name : p.coordinatorId,
          roomId: p.roomId,
          roomName: rm ? rm.name : p.roomId,
          roomKind: 'Auditorium'
        });
      });

    (campus.events || [])
      .filter((ev) => ev.sectionId === secId)
      .forEach((ev) => {
        const fac = facMap.get(ev.coordinatorId);
        const rm = roomMap.get(ev.roomId);
        const sl = slotMap.get(ev.slotId);
        baseActivities.push({
          activityId: ev.id,
          kind: 'Event',
          subjectCode: ev.id,
          subjectName: ev.title,
          day: ev.day,
          date: ev.scheduledDate || '',
          slotId: ev.slotId,
          timeLabel: sl ? sl.label : ev.slotId,
          facultyId: ev.coordinatorId,
          facultyName: fac ? fac.name : ev.coordinatorId,
          roomId: ev.roomId,
          roomName: rm ? rm.name : ev.roomId,
          roomKind: 'Venue'
        });
      });

    const entries = baseActivities.map((base) => {
      const upd = updatesByActivity.get(base.activityId);
      if (!upd) {
        return {
          ...base,
          status: 'UNCHANGED',
          diffLines: [],
          reason: ''
        };
      }

      const prev = upd.previous_details || {};
      const next = upd.updated_details || {};
      const diffLines = [];

      if (upd.change_status === 'CANCELLED') {
        diffLines.push(`<strong>Affected Session:</strong> ${escapeHtml(prev.day || base.day)} ${escapeHtml(prev.timeText || base.timeLabel)} &bull; ${escapeHtml(prev.roomName || base.roomName)}`);
        diffLines.push(`<strong>Status:</strong> Cancelled due to unresolvable constraint disruption`);
      } else {
        if ((prev.roomId && next.roomId && prev.roomId !== next.roomId) || (prev.roomName && next.roomName && prev.roomName !== next.roomName)) {
          const rk = base.roomKind === 'Laboratory' ? 'laboratory' : 'classroom';
          diffLines.push(`<strong>Previous ${rk}:</strong> ${escapeHtml(prev.roomName || prev.roomId || base.roomName)}`);
          diffLines.push(`<strong>Updated ${rk}:</strong> ${escapeHtml(next.roomName || next.roomId)}`);
        }
        if ((prev.facultyId && next.facultyId && prev.facultyId !== next.facultyId) || (prev.facultyName && next.facultyName && prev.facultyName !== next.facultyName)) {
          diffLines.push(`<strong>Previous faculty:</strong> ${escapeHtml(prev.facultyName || prev.facultyId || base.facultyName)}`);
          diffLines.push(`<strong>Updated faculty:</strong> ${escapeHtml(next.facultyName || next.facultyId)}`);
        }
        if (prev.day !== next.day || prev.slotId !== next.slotId || (prev.date && next.date && prev.date !== next.date)) {
          diffLines.push(`<strong>Previous time:</strong> ${escapeHtml(prev.day || base.day)} (${escapeHtml(prev.timeText || base.timeLabel)})`);
          diffLines.push(`<strong>Updated time:</strong> ${escapeHtml(next.day || base.day)} (${escapeHtml(next.timeText || next.slotId)})`);
        }
        if (next.splitSummary) {
          diffLines.push(`<strong>Allocation note:</strong> ${escapeHtml(next.splitSummary)}`);
        }
      }

      if (upd.reason) {
        diffLines.push(`<strong>Reason:</strong> ${escapeHtml(upd.reason)}`);
      }

      const currentSlot = slotMap.get(next.slotId || base.slotId);
      return {
        ...base,
        day: next.day || base.day,
        date: next.date || base.date,
        slotId: next.slotId || base.slotId,
        timeLabel: currentSlot ? currentSlot.label : (next.timeText || base.timeLabel),
        facultyId: next.facultyId || base.facultyId,
        facultyName: next.facultyName || base.facultyName,
        roomId: next.roomId || base.roomId,
        roomName: next.roomName || base.roomName,
        status: upd.change_status || 'RESCHEDULED',
        diffLines,
        reason: upd.reason || ''
      };
    });

    const dayOrder = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5 };
    const slotOrder = { S1: 1, S2: 2, S3: 3, S4: 4, S5: 5 };
    entries.sort((a, b) => (dayOrder[a.day] || 9) - (dayOrder[b.day] || 9) || (slotOrder[a.slotId] || 9) - (slotOrder[b.slotId] || 9));

    return { entries, transportUpdates };
  }

  function renderProfileSidebar() {
    const p = studentState.profile;
    const campus = studentState.baseCampus;
    if (!p) return;

    const sectionObj = campus ? campus.sections.find((s) => s.id === p.section_id) : null;
    const setText = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };

    setText('stAvatar', getInitials(p.full_name));
    setText('stProfileName', p.full_name);
    setText('stProfileId', p.student_id);
    setText('stProfileDept', p.department);
    setText('stProfileSem', `Semester ${p.semester}`);
    setText('stProfileSec', sectionObj ? `${sectionObj.name} (${p.section_id})` : p.section_id);
    setText('stProfileBus', p.bus_id || 'Campus Resident');
    setText('stProfileHostel', p.hostel_id || 'Day Scholar');
    setText('stWelcomeTitle', `${p.full_name} — Academic Schedule`);
  }

  function renderSummaryAndBanner(entries, transportUpdates) {
    const todayCode = getTodayWeekdayCode();
    const activeDay = studentState.selectedDay || todayCode || 'Mon';
    const todaysClasses = todayCode ? entries.filter((e) => e.day === todayCode && e.status !== 'CANCELLED').length : 0;
    const rescheduledClasses = entries.filter((e) =>
      ['RESCHEDULED', 'FACULTY_CHANGED', 'CLASSROOM_CHANGED', 'LAB_CHANGED'].includes(e.status)
    ).length;
    const cancelledClasses = entries.filter((e) => e.status === 'CANCELLED').length;

    const kpiTodays = document.getElementById('stKpiTodays');
    const kpiTodaysFoot = document.getElementById('stKpiTodaysFoot');
    const kpiResched = document.getElementById('stKpiResched');
    const kpiCancelled = document.getElementById('stKpiCancelled');

    if (kpiTodays) kpiTodays.textContent = String(todaysClasses);
    if (kpiTodaysFoot) {
      kpiTodaysFoot.textContent = todayCode
        ? `Scheduled for ${todayCode} (${entries.filter((e) => e.day === activeDay).length} shown on ${activeDay})`
        : 'Weekend — switch day tabs to preview weekday classes';
    }
    if (kpiResched) kpiResched.textContent = String(rescheduledClasses);
    if (kpiCancelled) kpiCancelled.textContent = String(cancelledClasses);

    const bannerEl = document.getElementById('stStatusBanner');
    if (bannerEl) {
      const unresolvedNotifs = (studentState.notifications || []).filter((n) => n.active && (n.change_status === 'CANCELLED' || n.change_status === 'INCOMPLETE_RECOVERY'));
      bannerEl.classList.remove('tone-warn', 'tone-danger', 'tone-ok', 'hidden');
      if (cancelledClasses > 0 || unresolvedNotifs.length > 0) {
        bannerEl.classList.add('tone-danger');
        bannerEl.textContent = `Incomplete recovery notice: ${cancelledClasses || unresolvedNotifs.length} schedule/transit item(s) could not be resolved without constraint conflicts. Please review details below.`;
      } else if (rescheduledClasses > 0 || transportUpdates.length > 0) {
        bannerEl.classList.add('tone-warn');
        bannerEl.textContent = `Recovery updates active: ${rescheduledClasses} timetable session adjustment(s)${transportUpdates.length ? ` and ${transportUpdates.length} transport reroute(s)` : ''} have been published for your section.`;
      } else {
        bannerEl.classList.add('tone-ok');
        bannerEl.textContent = 'Your academic schedule is operating normally. No active disruptions.';
      }
    }
  }

  function renderTimetableSection(entries) {
    const wrap = document.getElementById('stTimetableWrap');
    const dayTabsEl = document.getElementById('stDayTabs');
    if (!wrap) return;

    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
    const todayCode = getTodayWeekdayCode();
    if (!studentState.selectedDay) {
      studentState.selectedDay = todayCode || 'Mon';
    }

    if (dayTabsEl) {
      dayTabsEl.classList.toggle('hidden', studentState.viewMode !== 'daily');
      dayTabsEl.innerHTML = days.map((d) => `
        <button type="button" class="st-tab-btn ${studentState.selectedDay === d ? 'active' : ''}" data-st-day="${d}">
          ${d}${todayCode === d ? ' (Today)' : ''}
        </button>
      `).join('');
    }

    const dailyBtn = document.getElementById('btnStViewDaily');
    const weeklyBtn = document.getElementById('btnStViewWeekly');
    if (dailyBtn) dailyBtn.classList.toggle('active', studentState.viewMode === 'daily');
    if (weeklyBtn) weeklyBtn.classList.toggle('active', studentState.viewMode === 'weekly');

    if (studentState.viewMode === 'daily') {
      const dayEntries = entries.filter((e) => e.day === studentState.selectedDay);
      if (dayEntries.length === 0) {
        wrap.innerHTML = `<div class="st-notif-empty">No classes scheduled on ${escapeHtml(studentState.selectedDay)} for your section.</div>`;
        return;
      }
      wrap.innerHTML = `<div class="st-tt-list">${dayEntries.map((entry) => {
        const meta = statusMeta(entry.status);
        return `
          <article class="st-tt-card ${meta.cardClass}">
            <div class="st-tt-top">
              <div>
                <div class="st-tt-subject">
                  <span class="st-tt-code">${escapeHtml(entry.subjectCode || entry.kind)}</span>
                  ${escapeHtml(entry.subjectName)}
                </div>
                <div style="font-size:12px; color:#94a3b8; margin-top:2px;">${escapeHtml(entry.kind)} &bull; ${escapeHtml(entry.day)} ${entry.date ? `(${escapeHtml(entry.date)})` : ''} &bull; ${escapeHtml(entry.timeLabel)}</div>
              </div>
              <span class="st-status-pill ${meta.pillClass}">${escapeHtml(meta.label)}</span>
            </div>
            <div class="st-tt-grid">
              <div>Time Slot<strong>${escapeHtml(entry.slotId)} (${escapeHtml(entry.timeLabel)})</strong></div>
              <div>Faculty<strong>${escapeHtml(entry.facultyName)}</strong></div>
              <div>${escapeHtml(entry.roomKind)}<strong>${escapeHtml(entry.roomName)} (${escapeHtml(entry.roomId)})</strong></div>
            </div>
            ${entry.diffLines.length > 0 ? `<div class="st-diff-box">${entry.diffLines.map((line) => `<div>${line}</div>`).join('')}</div>` : ''}
          </article>
        `;
      }).join('')}</div>`;
      return;
    }

    // Weekly Matrix View
    const slots = (studentState.baseCampus && studentState.baseCampus.meta.slots) || [];
    let html = `<div class="st-week-scroll"><table class="st-week-table"><thead><tr><th>Time Slot</th>${days.map((d) => `<th>${d}${todayCode === d ? ' (Today)' : ''}</th>`).join('')}</tr></thead><tbody>`;
    slots.forEach((sl) => {
      html += `<tr><td><strong>${escapeHtml(sl.id)}</strong><div style="font-size:11px;color:#94a3b8;">${escapeHtml(sl.label)}</div></td>`;
      days.forEach((d) => {
        const cellItems = entries.filter((e) => e.day === d && e.slotId === sl.id);
        if (cellItems.length === 0) {
          html += `<td style="color:#64748b;">&mdash;</td>`;
        } else {
          html += `<td>${cellItems.map((entry) => {
            const meta = statusMeta(entry.status);
            return `
              <div class="st-week-chip ${meta.cardClass}">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:4px;">
                  <strong>${escapeHtml(entry.subjectName)}</strong>
                </div>
                <div style="color:#cbd5e1;font-size:11px;">${escapeHtml(entry.facultyName)} &bull; ${escapeHtml(entry.roomId)}</div>
                <div><span class="st-status-pill ${meta.pillClass}">${escapeHtml(meta.label)}</span></div>
              </div>
            `;
          }).join('')}</td>`;
        }
      });
      html += `</tr>`;
    });
    html += `</tbody></table></div>`;
    wrap.innerHTML = html;
  }

  function renderNotificationsSection() {
    const wrap = document.getElementById('stNotificationsWrap');
    const countBadge = document.getElementById('stNotifCount');
    if (!wrap) return;

    const list = studentState.notifications || [];
    const activeCount = list.filter((n) => n.active).length;
    if (countBadge) {
      countBadge.textContent = activeCount > 0 ? `${activeCount} Active` : `${list.length} History`;
    }

    if (list.length === 0) {
      wrap.innerHTML = `<div class="st-notif-empty">Your academic schedule is operating normally. No recent disruptions.</div>`;
      return;
    }

    wrap.innerHTML = `<div class="st-notif-list">${list.map((n) => {
      const effectiveStatus = n.reverted ? 'REVERTED' : n.change_status;
      const meta = statusMeta(effectiveStatus);
      return `
        <article class="st-notif-card ${n.reverted ? 'is-reverted' : ''}">
          <div class="st-notif-head">
            <h4 class="st-notif-title">${escapeHtml(n.title)}</h4>
            <span class="st-status-pill ${meta.pillClass}">${n.reverted ? 'Reverted' : escapeHtml(meta.label)}</span>
          </div>
          <p class="st-notif-desc">${escapeHtml(n.description)}</p>
          <div class="st-notif-meta">
            ${n.previous_summary ? `<div><strong>Previous:</strong> ${escapeHtml(n.previous_summary)}</div>` : ''}
            ${n.updated_summary ? `<div><strong>Updated:</strong> ${escapeHtml(n.updated_summary)}</div>` : ''}
            ${n.affected_date_time ? `<div><strong>Affected Date &amp; Time:</strong> ${escapeHtml(n.affected_date_time)}</div>` : ''}
            <div><strong>Reason:</strong> ${escapeHtml(n.reason)}</div>
          </div>
          <div class="st-notif-time">${escapeHtml(formatTimestamp(n.created_at))}</div>
        </article>
      `;
    }).join('')}</div>`;
  }

  function renderStudentSyncBadge() {
    const dot = document.getElementById('stSyncDot');
    const lbl = document.getElementById('stSyncLabel');
    if (!dot || !lbl) return;
    if (studentState.lastError) {
      dot.classList.add('fallback');
      lbl.textContent = 'Sync retry active';
    } else if (studentState.realtimeMode === 'SUBSCRIBED') {
      dot.classList.remove('fallback');
      lbl.textContent = 'Realtime Sync Live';
    } else {
      dot.classList.add('fallback');
      lbl.textContent = 'Auto-Refresh Sync Active';
    }
  }

  function renderStudentDashboard() {
    if (!studentState.activated || !studentState.profile) return;
    renderProfileSidebar();
    const { entries, transportUpdates } = buildStudentScheduleEntries();
    renderSummaryAndBanner(entries, transportUpdates);
    renderTimetableSection(entries);
    renderNotificationsSection();
    renderStudentSyncBadge();
  }

  async function refreshStudentData() {
    if (!studentState.activated || !studentState.profile || !global.OMNIS_DB) return { ok: false };
    const res = await global.OMNIS_DB.fetchStudentScheduleAndNotifications(studentState.profile.section_id);
    if (res && res.ok) {
      studentState.updates = res.updates || [];
      studentState.notifications = res.notifications || [];
      studentState.lastError = null;
    } else {
      studentState.lastError = (res && res.error) || 'Failed to sync student updates';
    }
    renderStudentDashboard();
    return res;
  }

  function startRealtimeAndFallbackSync() {
    stopRealtimeAndFallbackSync();
    if (!global.OMNIS_DB || !studentState.profile) return;

    unsubscribeRealtime = global.OMNIS_DB.subscribeToStudentUpdates(
      studentState.profile.section_id,
      () => { refreshStudentData(); },
      (st) => {
        studentState.realtimeMode = st;
        renderStudentSyncBadge();
      }
    );

    pollTimerId = setInterval(() => {
      if (!studentState.activated) return;
      if (studentState.realtimeMode !== 'SUBSCRIBED') {
        refreshStudentData();
      }
    }, FALLBACK_POLL_MS);
  }

  function stopRealtimeAndFallbackSync() {
    if (pollTimerId) {
      clearInterval(pollTimerId);
      pollTimerId = null;
    }
    if (typeof unsubscribeRealtime === 'function') {
      try { unsubscribeRealtime(); } catch (_) {}
      unsubscribeRealtime = null;
    }
    if (global.OMNIS_DB && typeof global.OMNIS_DB.unsubscribeStudentUpdates === 'function') {
      global.OMNIS_DB.unsubscribeStudentUpdates();
    }
  }

  function bindStudentEvents() {
    if (eventsBound) return;
    eventsBound = true;

    const btnDaily = document.getElementById('btnStViewDaily');
    const btnWeekly = document.getElementById('btnStViewWeekly');
    const dayTabs = document.getElementById('stDayTabs');
    const btnRefresh = document.getElementById('btnStRefresh');
    const btnSignOut = document.getElementById('btnStudentSignOut');

    if (btnDaily) {
      btnDaily.addEventListener('click', () => {
        studentState.viewMode = 'daily';
        renderStudentDashboard();
      });
    }
    if (btnWeekly) {
      btnWeekly.addEventListener('click', () => {
        studentState.viewMode = 'weekly';
        renderStudentDashboard();
      });
    }
    if (dayTabs) {
      dayTabs.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-st-day]');
        if (!btn) return;
        studentState.selectedDay = btn.dataset.stDay;
        renderStudentDashboard();
      });
    }
    if (btnRefresh) {
      btnRefresh.addEventListener('click', () => refreshStudentData());
    }
    if (btnSignOut) {
      btnSignOut.addEventListener('click', () => {
        if (global.OMNIS_LOGIN && typeof global.OMNIS_LOGIN.signOutToLanding === 'function') {
          global.OMNIS_LOGIN.signOutToLanding(false);
        }
      });
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && studentState.activated) {
        refreshStudentData();
      }
    });
  }

  async function activateStudentDashboard() {
    bindStudentEvents();
    const shell = document.getElementById('studentDashboardShell');
    const adminShell = document.getElementById('appShell');
    const loginPage = document.getElementById('loginLandingPage');

    if (adminShell) adminShell.classList.add('hidden');

    if (!global.OMNIS_DB || typeof global.OMNIS_DB.getAuthSession !== 'function') {
      if (shell) shell.classList.add('hidden');
      if (loginPage) loginPage.classList.remove('hidden');
      return false;
    }

    const auth = await global.OMNIS_DB.getAuthSession();
    if (!auth || !auth.authenticated || auth.role !== 'student' || !auth.profile) {
      if (shell) shell.classList.add('hidden');
      if (loginPage) loginPage.classList.remove('hidden');
      return false;
    }

    studentState.activated = true;
    studentState.profile = auth.profile;
    studentState.baseCampus = global.OMNIS_DATA ? global.OMNIS_DATA.createInitialCampusState() : null;
    studentState.selectedDay = getTodayWeekdayCode() || 'Mon';
    studentState.realtimeMode = 'connecting';

    if (loginPage) loginPage.classList.add('hidden');
    if (shell) shell.classList.remove('hidden');

    await refreshStudentData();
    startRealtimeAndFallbackSync();
    return true;
  }

  function deactivateStudentDashboard() {
    studentState.activated = false;
    studentState.profile = null;
    studentState.updates = [];
    studentState.notifications = [];
    studentState.lastError = null;
    stopRealtimeAndFallbackSync();
    const shell = document.getElementById('studentDashboardShell');
    if (shell) shell.classList.add('hidden');
  }

  global.OMNIS_STUDENT = {
    activateStudentDashboard,
    deactivateStudentDashboard,
    refreshStudentData,
    isActivated: () => studentState.activated,
    getProfile: () => studentState.profile ? { ...studentState.profile } : null
  };
})(window);
