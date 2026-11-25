/**
 * OMNIS-X — Intelligent Campus Recovery System
 * Core Simulation & Constraint-Based Recovery Engine
 *
 * Modules:
 * 1. Timetable & Constraint Validator (zero-conflict verification)
 * 2. Institutional Dependency Graph Builder
 * 3. Time-Window & Capacity-Aware BFS Cascading Failure Simulator
 * 4. Multi-Plan Constraint-Based Recovery Solver & Ranker
 */

(function (global) {
  'use strict';

  const {
    DAYS,
    SLOTS,
    OPERATING_HOURS,
    toISODate,
    parseISODate,
    formatDateDMY,
    getWeekdayName
  } = global.OMNIS_DATA;

  const WEEK_SLOTS = [];
  DAYS.forEach((day) => {
    SLOTS.forEach((slot) => {
      WEEK_SLOTS.push({ day, slotId: slot.id, key: `${day}|${slot.id}` });
    });
  });

  function cloneState(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function addDaysISO(isoStr, daysToAdd) {
    const dt = parseISODate(isoStr);
    dt.setDate(dt.getDate() + daysToAdd);
    return toISODate(dt);
  }

  function parseTimeToMinutes(hhmm) {
    if (!hhmm || !/^\d{2}:\d{2}$/.test(String(hhmm))) return null;
    const [h, m] = String(hhmm).split(':').map(Number);
    if (h < 0 || h > 23 || m < 0 || m > 59) return null;
    return h * 60 + m;
  }

  function minutesToHHMM(mins) {
    const clamped = Math.max(0, Math.min(1439, Math.round(mins)));
    const h = String(Math.floor(clamped / 60)).padStart(2, '0');
    const m = String(clamped % 60).padStart(2, '0');
    return `${h}:${m}`;
  }

  function formatTime12h(hhmm) {
    const mins = parseTimeToMinutes(hhmm);
    if (mins === null) return String(hhmm || '');
    const h24 = Math.floor(mins / 60);
    const m = String(mins % 60).padStart(2, '0');
    const ampm = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${String(h12).padStart(2, '0')}:${m} ${ampm}`;
  }

  function computeDurationMinutes(startTime, endTime, allowOvernight = false) {
    const s = parseTimeToMinutes(startTime);
    const e = parseTimeToMinutes(endTime);
    if (s === null || e === null) return 0;
    if (e > s) return e - s;
    if (allowOvernight && e < s) return (1440 - s) + e;
    return 0;
  }

  function mergeTimeRanges(periods) {
    const parsed = (periods || [])
      .map((p) => ({
        startMin: parseTimeToMinutes(p.startTime),
        endMin: parseTimeToMinutes(p.endTime),
        startTime: p.startTime,
        endTime: p.endTime
      }))
      .filter((p) => p.startMin !== null && p.endMin !== null && p.endMin > p.startMin)
      .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);

    const merged = [];
    for (const p of parsed) {
      if (!merged.length || p.startMin > merged[merged.length - 1].endMin) {
        merged.push({ ...p });
      } else if (p.endMin > merged[merged.length - 1].endMin) {
        merged[merged.length - 1].endMin = p.endMin;
        merged[merged.length - 1].endTime = p.endTime;
      }
    }
    return merged;
  }

  /**
   * Validate an array of { startTime, endTime } periods.
   * Rejects empty/invalid times, end <= start (unless allowOvernight), and exact duplicates.
   * Automatically computes mergedPeriods when overlapping ranges exist.
   */
  function validateTimePeriods(periods, opts = {}) {
    const allowOvernight = Boolean(opts.allowOvernight);
    const list = Array.isArray(periods) ? periods : [];
    const errors = [];
    if (list.length === 0) {
      return { valid: false, errors: ['At least one time period is required.'], mergedPeriods: [], hasOverlaps: false, hasDuplicates: false };
    }

    const seen = new Set();
    let hasDuplicates = false;
    let hasOverlaps = false;
    const validNonOvernight = [];

    list.forEach((p, idx) => {
      const s = parseTimeToMinutes(p?.startTime);
      const e = parseTimeToMinutes(p?.endTime);
      if (s === null || e === null) {
        errors.push(`Period ${idx + 1}: Start and end times are required.`);
        return;
      }
      if (e === s) {
        errors.push(`Period ${idx + 1}: End time must differ from start time.`);
        return;
      }
      if (!allowOvernight && e < s) {
        errors.push(`Period ${idx + 1}: End time (${formatTime12h(p.endTime)}) must be later than start time (${formatTime12h(p.startTime)}).`);
        return;
      }
      const key = `${p.startTime}-${p.endTime}`;
      if (seen.has(key)) {
        hasDuplicates = true;
        errors.push(`Period ${idx + 1}: Duplicate time period (${formatTime12h(p.startTime)} – ${formatTime12h(p.endTime)}).`);
        return;
      }
      seen.add(key);
      if (e > s) validNonOvernight.push({ startMin: s, endMin: e, startTime: p.startTime, endTime: p.endTime });
    });

    // Check overlaps among non-overnight periods
    const sorted = [...validNonOvernight].sort((a, b) => a.startMin - b.startMin);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].startMin < sorted[i - 1].endMin) {
        hasOverlaps = true;
        break;
      }
    }

    const mergedPeriods = mergeTimeRanges(validNonOvernight);
    return {
      valid: errors.length === 0,
      errors,
      mergedPeriods,
      hasOverlaps,
      hasDuplicates
    };
  }

  /**
   * Return all institutional slot IDs whose [startMin, endMin] overlaps [startTime, endTime].
   */
  function getOverlappingSlotIds(startTime, endTime) {
    const s = parseTimeToMinutes(startTime);
    const e = parseTimeToMinutes(endTime);
    if (s === null || e === null || e <= s) return [];
    return SLOTS
      .filter((slot) => Math.max(s, slot.startMin) < Math.min(e, slot.endMin))
      .map((slot) => slot.id);
  }

  /**
   * Split a period (possibly overnight when endMin < startMin) into date-bounded segments.
   */
  function expandDateTimeSegments(dateStr, startTime, endTime, allowOvernight = false) {
    const s = parseTimeToMinutes(startTime);
    const e = parseTimeToMinutes(endTime);
    if (s === null || e === null || e === s) return [];
    if (e > s) {
      return [{ date: dateStr, startTime, endTime }];
    }
    if (allowOvernight && e < s) {
      return [
        { date: dateStr, startTime, endTime: '23:59' },
        { date: addDaysISO(dateStr, 1), startTime: '00:00', endTime }
      ];
    }
    return [];
  }

  /**
   * Return all institutional activities scheduled on a specific YYYY-MM-DD date.
   * Weekly lectures/labs occur on matching weekdays (Mon-Fri).
   * One-time exams, placements, and events occur ONLY on their scheduledDate.
   */
  function getActivitiesOnDate(state, dateStr) {
    if (!dateStr) return [];
    const weekday = getWeekdayName(dateStr);
    const all = getAllActivities(state);
    return all.filter((act) => {
      if (act.kind === 'timetable') {
        return act.day === weekday;
      }
      return act.original.scheduledDate === dateStr;
    });
  }

  /**
   * Expand (day, startSlotId, durationSlots) into a Set of "Day|SlotId" keys.
   */
  function expandTimeWindow(day, startSlotId = 'S1', durationSlots = 25) {
    const dur = Number(durationSlots) || 1;
    if (day === 'ALL' || dur >= 25) {
      return new Set(WEEK_SLOTS.map((w) => w.key));
    }
    const startKey = `${day}|${startSlotId || 'S1'}`;
    let startIdx = WEEK_SLOTS.findIndex((w) => w.key === startKey);
    if (startIdx < 0) startIdx = 0;
    const set = new Set();
    for (let i = startIdx; i < Math.min(WEEK_SLOTS.length, startIdx + dur); i++) {
      set.add(WEEK_SLOTS[i].key);
    }
    return set;
  }

  /**
   * Expand morning transit delay starting at S1 on selected day (or ALL days).
   */
  function expandBusDelayWindow(day = 'ALL', delaySlots = 2) {
    const count = Math.max(1, Math.min(5, Number(delaySlots) || 2));
    const slotIds = SLOTS.slice(0, count).map((s) => s.id);
    const set = new Set();
    const targetDays = day === 'ALL' ? DAYS : [day];
    targetDays.forEach((d) => {
      slotIds.forEach((sId) => set.add(`${d}|${sId}`));
    });
    return set;
  }

  /**
   * Collect all scheduled activities (Timetable Lectures/Labs, Exams, Placements, Events)
   */
  function getAllActivities(state) {
    const list = [];
    state.timetable.forEach((t) => {
      list.push({
        id: t.id,
        kind: 'timetable',
        activityType: t.activityType,
        priority: t.priority,
        title: `${t.subjectCode} — ${t.subjectName}`,
        department: t.department,
        sectionId: t.sectionId,
        subjectId: t.subjectId,
        facultyId: t.facultyId,
        roomId: t.roomId,
        roomType: t.roomType,
        labType: t.labType,
        day: t.day,
        slotId: t.slotId,
        studentCount: t.studentCount,
        adminId: null,
        original: t
      });
    });
    state.examinations.forEach((e) => {
      list.push({
        id: e.id,
        kind: 'examination',
        activityType: 'EXAM',
        priority: e.priority || 100,
        title: e.title,
        department: e.department,
        sectionId: e.sectionId,
        subjectId: null,
        facultyId: e.invigilatorId,
        roomId: e.roomId,
        roomType: 'exam-hall',
        labType: null,
        day: e.day,
        slotId: e.slotId,
        studentCount: e.studentCount,
        adminId: e.adminId || 'ADM-03',
        original: e
      });
    });
    state.placements.forEach((p) => {
      list.push({
        id: p.id,
        kind: 'placement',
        activityType: 'PLACEMENT',
        priority: p.priority || 80,
        title: p.title,
        department: p.department,
        sectionId: p.sectionId,
        subjectId: null,
        facultyId: p.coordinatorId,
        roomId: p.roomId,
        roomType: 'auditorium',
        labType: null,
        day: p.day,
        slotId: p.slotId,
        studentCount: p.studentCount,
        adminId: p.adminId || 'ADM-01',
        original: p
      });
    });
    state.events.forEach((ev) => {
      list.push({
        id: ev.id,
        kind: 'event',
        activityType: 'EVENT',
        priority: ev.priority || 20,
        title: ev.title,
        department: ev.department,
        sectionId: ev.sectionId,
        subjectId: null,
        facultyId: ev.coordinatorId,
        roomId: ev.roomId,
        roomType: 'auditorium',
        labType: null,
        day: ev.day,
        slotId: ev.slotId,
        studentCount: ev.studentCount,
        adminId: null,
        original: ev
      });
    });
    return list;
  }

  /**
   * Validate an entire campus schedule against all hard institutional constraints.
   */
  function validateSchedule(state) {
    const activities = getAllActivities(state);
    const facultyMap = new Map(state.faculty.map((f) => [f.id, f]));
    const sectionMap = new Map(state.sections.map((s) => [s.id, s]));
    const roomMap = new Map([...state.classrooms, ...state.labs].map((r) => [r.id, r]));

    const facSlots = new Map();
    const secSlots = new Map();
    const roomSlots = new Map();
    const facLoads = new Map();
    const conflicts = [];

    activities.forEach((act) => {
      const timeKey = `${act.day}|${act.slotId}`;

      const fKey = `${act.facultyId}|${timeKey}`;
      if (facSlots.has(fKey)) {
        conflicts.push({ type: 'FACULTY_CLASH', activities: [facSlots.get(fKey), act.id], resource: act.facultyId, time: timeKey });
      } else {
        facSlots.set(fKey, act.id);
      }

      const fac = facultyMap.get(act.facultyId);
      if (fac && act.subjectId && !fac.qualifications.includes(act.subjectId)) {
        conflicts.push({ type: 'QUALIFICATION_MISMATCH', activities: [act.id], resource: act.facultyId, subjectId: act.subjectId });
      }
      facLoads.set(act.facultyId, (facLoads.get(act.facultyId) || 0) + 1);

      const sKey = `${act.sectionId}|${timeKey}`;
      if (secSlots.has(sKey)) {
        conflicts.push({ type: 'SECTION_CLASH', activities: [secSlots.get(sKey), act.id], resource: act.sectionId, time: timeKey });
      } else {
        secSlots.set(sKey, act.id);
      }

      const rKey = `${act.roomId}|${timeKey}`;
      if (roomSlots.has(rKey)) {
        conflicts.push({ type: 'ROOM_CLASH', activities: [roomSlots.get(rKey), act.id], resource: act.roomId, time: timeKey });
      } else {
        roomSlots.set(rKey, act.id);
      }

      const room = roomMap.get(act.roomId);
      const sec = sectionMap.get(act.sectionId);
      if (room && sec && room.capacity < sec.studentCount) {
        conflicts.push({ type: 'CAPACITY_EXCEEDED', activities: [act.id], resource: act.roomId, capacity: room.capacity, required: sec.studentCount });
      }
      if (act.activityType === 'LAB' && room && room.labType !== act.labType) {
        conflicts.push({ type: 'LAB_TYPE_MISMATCH', activities: [act.id], resource: act.roomId });
      }
    });

    facLoads.forEach((load, facId) => {
      const fac = facultyMap.get(facId);
      if (fac && load > fac.maxWeeklyLoad) {
        conflicts.push({ type: 'WORKLOAD_EXCEEDED', resource: facId, load, max: fac.maxWeeklyLoad });
      }
    });

    return {
      valid: conflicts.length === 0,
      conflicts,
      totalActivities: activities.length
    };
  }

  /**
   * Build the Institutional Dependency Graph.
   */
  function buildDependencyGraph(state) {
    const nodes = new Map();
    const adj = new Map();

    function addNode(id, label, category, meta = {}) {
      if (!nodes.has(id)) {
        nodes.set(id, { id, label, category, meta });
        adj.set(id, []);
      }
    }

    function addEdge(from, to, relation, condition = null) {
      if (!adj.has(from) || !nodes.has(to)) return;
      adj.get(from).push({ to, relation, condition });
    }

    ['PZ-1', 'PZ-2', 'PZ-3'].forEach((pz) => {
      addNode(pz, `Power Zone ${pz}`, 'infrastructure', { powerZone: pz });
    });

    state.admin.forEach((a) => addNode(a.id, a.name, 'admin', a));
    state.buses.forEach((b) => addNode(b.id, b.name, 'bus', b));
    state.hostels.forEach((h) => addNode(h.id, h.name, 'hostel', h));
    state.classrooms.forEach((c) => addNode(c.id, `${c.id} (${c.name})`, 'classroom', c));
    state.labs.forEach((l) => addNode(l.id, `${l.id} (${l.name})`, 'lab', l));
    state.faculty.forEach((f) => addNode(f.id, `${f.id} (${f.name})`, 'faculty', f));
    state.sections.forEach((s) => addNode(s.id, s.name, 'section', s));
    state.departments.forEach((d) => addNode(d.id, d.name, 'department', d));

    const activities = getAllActivities(state);
    activities.forEach((act) => {
      addNode(act.id, `${act.activityType}: ${act.title}`, 'activity', act);
    });

    addEdge('ADM-02', 'PZ-1', 'supplies_power');
    addEdge('ADM-02', 'ADM-05', 'supplies_power');
    state.buses.forEach((b) => addEdge('ADM-04', b.id, 'dispatches_fleet'));

    state.classrooms.forEach((c) => addEdge(c.powerZone, c.id, 'powers_room'));
    state.labs.forEach((l) => {
      addEdge(l.powerZone, l.id, 'powers_lab');
      if (l.requiresNetwork) {
        addEdge('ADM-05', l.id, 'provides_network');
      }
    });
    state.hostels.forEach((h) => addEdge(h.powerZone, h.id, 'powers_hostel'));

    state.faculty.forEach((f) => {
      if (f.busId) {
        addEdge(f.busId, f.id, 'transports_faculty', { morningOnly: true });
      }
    });
    state.buses.forEach((b) => {
      b.linkedSections.forEach((secId) => {
        addEdge(b.id, secId, 'transports_students', { partialTransit: true });
      });
    });

    state.hostels.forEach((h) => {
      if (h.wardenId) addEdge(h.wardenId, h.id, 'wardens_hostel', { advisoryOnly: true });
      h.linkedSections.forEach((secId) => addEdge(h.id, secId, 'houses_students', { hostelImpact: true }));
    });

    activities.forEach((act) => {
      addEdge(act.facultyId, act.id, 'teaches_or_leads', { activityDay: act.day, activitySlot: act.slotId });
      addEdge(act.roomId, act.id, 'hosts_activity', { activityDay: act.day, activitySlot: act.slotId });
      if (act.adminId) {
        addEdge(act.adminId, act.id, 'administers');
      }
      if (act.activityType === 'PLACEMENT') {
        addEdge('ADM-05', act.id, 'provides_assessment_network');
      }
      addEdge(act.id, act.sectionId, 'scheduled_for_section');
      addEdge(act.sectionId, `DEPT-${act.department}`, 'belongs_to_department');
    });

    return { nodes, adj, activities };
  }

  /**
   * Convert legacy flat failedIds + conflictInjections into structured failureConfigs.
   */
  function legacyToConfigs(state, failedIds = [], conflictInjections = []) {
    const configs = [];
    failedIds.forEach((id) => {
      if (id.startsWith('FAC-')) {
        const fac = state.faculty.find((f) => f.id === id);
        if (fac) {
          configs.push({
            scenarioType: 'SCN-FACULTY-ABSENCE',
            department: fac.department,
            facultyId: fac.id,
            reason: 'Direct Absence',
            day: 'ALL',
            startSlotId: 'S1',
            durationSlots: 25
          });
        }
      } else if (id.startsWith('LAB-')) {
        const lab = state.labs.find((l) => l.id === id);
        if (lab) {
          configs.push({
            scenarioType: 'SCN-LAB-FAILURE',
            department: lab.department,
            labId: lab.id,
            failureType: 'equipment',
            equipmentUnavailablePct: 100,
            day: 'ALL',
            startSlotId: 'S1',
            durationSlots: 25
          });
        }
      } else if (id.startsWith('CR-')) {
        const cr = state.classrooms.find((c) => c.id === id);
        if (cr) {
          configs.push({
            scenarioType: cr.type === 'exam-hall' ? 'SCN-EXAM-HALL-FAILURE' : 'SCN-CLASSROOM-UNAVAILABLE',
            building: cr.block,
            classroomId: cr.id,
            roomId: cr.id,
            examId: 'ALL',
            reason: 'Unavailable',
            capacityUnavailablePct: 100,
            day: 'ALL',
            startSlotId: 'S1',
            durationSlots: 25
          });
        }
      } else if (id.startsWith('BUS-')) {
        configs.push({
          scenarioType: 'SCN-BUS-BREAKDOWN',
          busId: id,
          breakdownType: 'Mechanical Breakdown',
          day: 'ALL',
          delaySlots: 2,
          spareBusAvailable: false
        });
      } else if (id === 'ADM-02' || id.startsWith('PZ-')) {
        configs.push({
          scenarioType: 'SCN-POWER-FAILURE',
          powerZone: id.startsWith('PZ-') ? id : 'PZ-1',
          failureSource: 'Main Substation (ADM-02)',
          day: 'ALL',
          startSlotId: 'S1',
          durationSlots: 25,
          backupAvailable: false,
          backupCapacityPct: 0
        });
      } else {
        configs.push({ scenarioType: 'GENERIC_NODE', nodeId: id });
      }
    });

    conflictInjections.forEach((inj) => {
      if (inj.type === 'PLACEMENT_EXAM_CLASH') {
        configs.push({
          scenarioType: 'SCN-PLACEMENT-EXAM-CONFLICT',
          placementId: inj.placementId,
          examId: inj.examId,
          conflictDay: inj.day,
          conflictSlotId: inj.slotId,
          reschedulingPriority: 'EXAM_FIRST'
        });
      }
    });

    return configs;
  }

  /**
   * Helper: compute Monday ISO of the week containing isoStr (for per-week workload tracking)
   */
  function getWeekMondayISO(isoStr) {
    const dt = parseISODate(isoStr);
    const dayIdx = dt.getDay();
    const diff = dayIdx === 0 ? -6 : 1 - dayIdx;
    const mon = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + diff);
    return toISODate(mon);
  }

  /**
   * Normalize dates & time periods from a failureConfig (supports both new calendar/time-picker
   * format AND legacy { day, startSlotId, durationSlots } format).
   * Returns Array<{ date: string, slotId: string, timeLabel: string }>
   */
  function resolveConfigDateSlots(state, cfg, options = {}) {
    const refWeek = state.meta.referenceWeek || {};
    const allowOvernight = Boolean(options.allowOvernight);
    const results = [];

    // Case 1: New calendar format with dates array
    if (Array.isArray(cfg.dates) && cfg.dates.length > 0) {
      cfg.dates.forEach((dateStr) => {
        if (!dateStr) return;
        let periods = [];
        if (cfg.fullDay && !cfg.perDateTimes) {
          periods = [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }];
        } else if (cfg.perDateTimes && cfg.dateTimePeriods && Array.isArray(cfg.dateTimePeriods[dateStr])) {
          const entry = cfg.dateTimePeriods[dateStr];
          periods = entry;
        } else if (Array.isArray(cfg.timePeriods) && cfg.timePeriods.length > 0) {
          periods = cfg.timePeriods;
        } else if (cfg.startTime && (cfg.endTime || cfg.restorationTime)) {
          periods = [{ startTime: cfg.startTime, endTime: cfg.endTime || cfg.restorationTime }];
        }

        periods.forEach((p) => {
          if (!p || !p.startTime || !p.endTime) return;
          const segments = expandDateTimeSegments(dateStr, p.startTime, p.endTime, allowOvernight);
          segments.forEach((seg) => {
            const slotIds = getOverlappingSlotIds(seg.startTime, seg.endTime);
            const label = `${formatTime12h(seg.startTime)}–${formatTime12h(seg.endTime)}`;
            slotIds.forEach((slotId) => {
              results.push({ date: seg.date, slotId, timeLabel: label });
            });
          });
        });
      });
      return results;
    }

    // Case 2: Single breakdown/proposed date
    if (cfg.date && (cfg.startTime && (cfg.endTime || cfg.restorationTime))) {
      const endT = cfg.endTime || cfg.restorationTime;
      const segments = expandDateTimeSegments(cfg.date, cfg.startTime, endT, allowOvernight);
      segments.forEach((seg) => {
        const slotIds = getOverlappingSlotIds(seg.startTime, seg.endTime);
        const label = `${formatTime12h(seg.startTime)}–${formatTime12h(seg.endTime)}`;
        slotIds.forEach((slotId) => {
          results.push({ date: seg.date, slotId, timeLabel: label });
        });
      });
      return results;
    }

    // Case 3: Legacy { day, startSlotId, durationSlots } fallback using referenceWeek
    const win = options.isBusDelay
      ? expandBusDelayWindow(cfg.day || 'ALL', cfg.delaySlots || 2)
      : expandTimeWindow(cfg.day || 'ALL', cfg.startSlotId || 'S1', cfg.durationSlots || 25);

    win.forEach((daySlotKey) => {
      const [dayName, slotId] = daySlotKey.split('|');
      const dateStr = refWeek[dayName];
      const slotObj = SLOTS.find((s) => s.id === slotId);
      if (dateStr) {
        results.push({
          date: dateStr,
          slotId,
          timeLabel: slotObj ? `${formatTime12h(slotObj.startTime)}–${formatTime12h(slotObj.endTime)}` : slotId
        });
      }
    });
    return results;
  }

  /**
   * Simulate Cascading Failures from structured Scenario-Aware FailureConfigs.
   * Supports multiple dates, multiple time ranges, multiple faculty/rooms/labs/buses,
   * overnight power outages, actual time-slot overlaps, and occurrence deduplication.
   */
  function simulateFromConfigs(rawState, failureConfigs = []) {
    const state = cloneState(rawState);
    const refWeek = state.meta.referenceWeek || {};

    const blockedFacultyOcc = new Map(); // facId -> Set("YYYY-MM-DD|Slot")
    const blockedFacultyReason = new Map(); // facId -> reason
    const blockedRoomOcc = new Map(); // roomId -> Set("YYYY-MM-DD|Slot")
    const roomCapacityRules = new Map(); // roomId -> Array<{ occSet, usableCapacity, forceFullOutage, reason }>
    const blockedHostelNodes = new Set();
    const blockedAdminOcc = new Map(); // admId -> Set("YYYY-MM-DD|Slot")
    const rootFailedNodes = new Map(); // nodeId -> reason
    const rootAffectedNodes = new Map(); // nodeId -> reason
    const busBreakdowns = [];
    const injectedClashes = [];
    const touchedDates = new Set();

    function addBlockedOcc(map, id, dateSlotPairs) {
      if (!map.has(id)) map.set(id, new Set());
      const target = map.get(id);
      dateSlotPairs.forEach((pair) => {
        target.add(`${pair.date}|${pair.slotId}`);
        touchedDates.add(pair.date);
      });
    }

    function registerSelectedDates(cfg) {
      if (Array.isArray(cfg.dates)) cfg.dates.forEach((d) => { if (d) touchedDates.add(d); });
      if (cfg.date) touchedDates.add(cfg.date);
      if (cfg.proposedDate) touchedDates.add(cfg.proposedDate);
    }

    // 1. Parse all structured FailureConfigs
    failureConfigs.forEach((cfg) => {
      if (!cfg) return;
      registerSelectedDates(cfg);

      if (cfg.scenarioType === 'SCN-FACULTY-ABSENCE') {
        if (cfg.scheduleMode === 'individual' && Array.isArray(cfg.facultyEntries)) {
          cfg.facultyEntries.forEach((entry) => {
            if (!entry || !entry.facultyId) return;
            registerSelectedDates(entry);
            const pairs = resolveConfigDateSlots(state, entry);
            addBlockedOcc(blockedFacultyOcc, entry.facultyId, pairs);
            const dateList = (entry.dates || []).map(formatDateDMY).join(', ') || 'Selected dates';
            const msg = `${entry.reason || cfg.reason || 'Absent'} (${dateList})`;
            blockedFacultyReason.set(entry.facultyId, msg);
            rootFailedNodes.set(entry.facultyId, msg);
          });
        } else {
          const facIds = Array.isArray(cfg.facultyIds) && cfg.facultyIds.length
            ? cfg.facultyIds
            : (cfg.facultyId ? [cfg.facultyId] : []);
          const pairs = resolveConfigDateSlots(state, cfg);
          const dateList = Array.isArray(cfg.dates) && cfg.dates.length
            ? cfg.dates.map(formatDateDMY).join(', ')
            : (cfg.day === 'ALL' ? 'Full Week' : `${cfg.day} ${cfg.startSlotId || ''}`);
          facIds.forEach((fId) => {
            if (!fId) return;
            addBlockedOcc(blockedFacultyOcc, fId, pairs);
            const msg = `${cfg.reason || 'Absent'} (${dateList})`;
            blockedFacultyReason.set(fId, msg);
            rootFailedNodes.set(fId, msg);
          });
        }
      }

      else if (cfg.scenarioType === 'SCN-LAB-FAILURE') {
        const labIds = Array.isArray(cfg.labIds) && cfg.labIds.length
          ? cfg.labIds
          : (cfg.labId ? [cfg.labId] : []);
        const pairs = resolveConfigDateSlots(state, cfg);
        const occSet = new Set(pairs.map((p) => `${p.date}|${p.slotId}`));
        const pct = Number(cfg.equipmentUnavailablePct ?? 100);

        labIds.forEach((lId) => {
          const lab = state.labs.find((l) => l.id === lId);
          if (!lab) return;
          const usableCap = Math.floor((lab.capacity * Math.max(0, 100 - pct)) / 100);
          const totalSystemDown = pct >= 100 || ((cfg.failureType === 'server' || cfg.failureType === 'network' || cfg.failureType === 'cooling') && pct >= 50);

          if (totalSystemDown) {
            addBlockedOcc(blockedRoomOcc, lab.id, pairs);
          }
          if (!roomCapacityRules.has(lab.id)) roomCapacityRules.set(lab.id, []);
          roomCapacityRules.get(lab.id).push({
            occSet,
            usableCapacity: totalSystemDown ? 0 : usableCap,
            forceFullOutage: totalSystemDown,
            reason: `${cfg.failureType} failure (${pct}% unavailable, usable cap: ${totalSystemDown ? 0 : usableCap}/${lab.capacity})`
          });
          rootFailedNodes.set(lab.id, `${cfg.failureType} failure: ${pct}% equipment unavailable`);
        });
      }

      else if (cfg.scenarioType === 'SCN-CLASSROOM-UNAVAILABLE') {
        const roomIds = Array.isArray(cfg.classroomIds) && cfg.classroomIds.length
          ? cfg.classroomIds
          : (cfg.classroomId ? [cfg.classroomId] : []);
        const pairs = resolveConfigDateSlots(state, cfg);
        const dateDesc = Array.isArray(cfg.dates) && cfg.dates.length
          ? cfg.dates.map(formatDateDMY).join(', ')
          : (cfg.day === 'ALL' ? 'Full Week' : `${cfg.day || ''}`);

        roomIds.forEach((rId) => {
          if (!rId) return;
          addBlockedOcc(blockedRoomOcc, rId, pairs);
          rootFailedNodes.set(rId, `${cfg.reason || 'Unavailable'} (${dateDesc})`);
        });
      }

      else if (cfg.scenarioType === 'SCN-BUS-BREAKDOWN') {
        const busIds = Array.isArray(cfg.busIds) && cfg.busIds.length
          ? cfg.busIds
          : (cfg.busId ? [cfg.busId] : []);
        const pairs = resolveConfigDateSlots(state, cfg, { isBusDelay: true });
        const durMins = (cfg.startTime && cfg.restorationTime)
          ? computeDurationMinutes(cfg.startTime, cfg.restorationTime, false)
          : (Number(cfg.delaySlots) || 2) * 60;

        busIds.forEach((bId) => {
          const bus = state.buses.find((b) => b.id === bId);
          if (!bus) return;
          const timeDesc = (cfg.startTime && cfg.restorationTime)
            ? `${formatTime12h(cfg.startTime)}–${formatTime12h(cfg.restorationTime)} (${durMins} min)`
            : `${cfg.delaySlots || 2} slot delay`;
          const dateDesc = cfg.date ? formatDateDMY(cfg.date) : (Array.isArray(cfg.dates) ? cfg.dates.map(formatDateDMY).join(', ') : 'Weekdays');
          const msg = `${cfg.breakdownType || 'Breakdown'} (${timeDesc} on ${dateDesc})`;
          rootFailedNodes.set(bus.id, msg);
          busBreakdowns.push({
            busId: bus.id,
            dates: cfg.date ? [cfg.date] : (cfg.dates || Object.values(refWeek)),
            delayMinutes: durMins,
            spareBusAvailable: Boolean(cfg.spareBusAvailable),
            breakdownType: cfg.breakdownType || 'Breakdown'
          });
          bus.linkedFaculty.forEach((fId) => {
            addBlockedOcc(blockedFacultyOcc, fId, pairs);
            blockedFacultyReason.set(fId, `Delayed (${timeDesc}) due to ${bus.id} (${cfg.breakdownType})`);
          });
        });
      }

      else if (cfg.scenarioType === 'SCN-EXAM-HALL-FAILURE') {
        const room = state.classrooms.find((r) => r.id === cfg.roomId);
        if (!room) return;
        let usableCap;
        let pct;
        if (cfg.availableSeating !== undefined && cfg.availableSeating !== '' && cfg.availableSeating !== null) {
          usableCap = Math.max(0, Math.min(room.capacity, Number(cfg.availableSeating)));
          pct = Math.round(((room.capacity - usableCap) / room.capacity) * 100);
        } else {
          pct = Number(cfg.capacityUnavailablePct ?? 100);
          usableCap = Math.floor((room.capacity * Math.max(0, 100 - pct)) / 100);
        }

        let pairs = [];
        if (Array.isArray(cfg.dates) && cfg.dates.length > 0) {
          pairs = resolveConfigDateSlots(state, cfg);
        } else {
          const exam = cfg.examId && cfg.examId !== 'ALL'
            ? state.examinations.find((e) => e.id === cfg.examId)
            : state.examinations.find((e) => e.roomId === room.id);
          const dur = Number(cfg.durationSlots) || 5;
          const legacyWin = exam && dur < 25
            ? expandTimeWindow(exam.day, dur >= 5 ? 'S1' : exam.slotId, dur)
            : expandTimeWindow('ALL', 'S1', 25);
          legacyWin.forEach((k) => {
            const [dName, sId] = k.split('|');
            if (refWeek[dName]) pairs.push({ date: refWeek[dName], slotId: sId });
          });
        }
        const occSet = new Set(pairs.map((p) => `${p.date}|${p.slotId}`));

        if (usableCap === 0) {
          addBlockedOcc(blockedRoomOcc, room.id, pairs);
        }
        if (!roomCapacityRules.has(room.id)) roomCapacityRules.set(room.id, []);
        roomCapacityRules.get(room.id).push({
          occSet,
          usableCapacity: usableCap,
          forceFullOutage: usableCap === 0,
          examFilter: cfg.examId && cfg.examId !== 'ALL' ? cfg.examId : null,
          reason: `${cfg.reason || 'Hall failure'} (${usableCap}/${room.capacity} seats usable)`
        });
        rootFailedNodes.set(room.id, `${cfg.reason || 'Exam hall failure'}: ${usableCap}/${room.capacity} seats usable`);
      }

      else if (cfg.scenarioType === 'SCN-POWER-FAILURE') {
        const powerCfg = { ...cfg };
        if (powerCfg.startTime && powerCfg.endTime && (!Array.isArray(powerCfg.timePeriods) || powerCfg.timePeriods.length === 0)) {
          powerCfg.timePeriods = [{ startTime: powerCfg.startTime, endTime: powerCfg.endTime }];
        }
        const pairs = resolveConfigDateSlots(state, powerCfg, { allowOvernight: true });
        const zones = cfg.powerZone === 'ALL_ZONES' ? ['PZ-1', 'PZ-2', 'PZ-3'] : [cfg.powerZone || 'PZ-1'];
        const backupPct = cfg.backupAvailable ? Number(cfg.backupCapacityPct || 0) : 0;

        if (zones.includes('PZ-1') || String(cfg.failureSource).includes('ADM-02')) {
          rootFailedNodes.set('ADM-02', `${cfg.failureSource} (Backup: ${backupPct}%)`);
        }
        zones.forEach((z) => {
          rootFailedNodes.set(z, `Power outage from ${cfg.failureSource} (Backup: ${backupPct}%)`);
        });

        if (backupPct < 100) {
          if (zones.includes('PZ-1') && backupPct === 0) {
            addBlockedOcc(blockedAdminOcc, 'ADM-05', pairs);
            rootAffectedNodes.set('ADM-05', 'Core Network lost utility power in PZ-1');
          }
          state.classrooms.forEach((c) => {
            if (!zones.includes(c.powerZone)) return;
            const shielded =
              (backupPct > 0 && c.type === 'exam-hall') ||
              (backupPct >= 50 && c.type === 'auditorium') ||
              (backupPct >= 75 && c.type === 'lecture');
            if (!shielded) {
              addBlockedOcc(blockedRoomOcc, c.id, pairs);
            }
          });
          state.labs.forEach((l) => {
            const zoneDown = zones.includes(l.powerZone);
            const netDown = l.requiresNetwork && zones.includes('PZ-1') && backupPct === 0;
            if (zoneDown || netDown) {
              addBlockedOcc(blockedRoomOcc, l.id, pairs);
            }
          });
          state.hostels.forEach((h) => {
            if (zones.includes(h.powerZone) && backupPct < 50) {
              blockedHostelNodes.add(h.id);
            }
          });
        }
      }

      else if (cfg.scenarioType === 'SCN-PLACEMENT-EXAM-CONFLICT') {
        const plc = state.placements.find((p) => p.id === cfg.placementId);
        const exm = state.examinations.find((e) => e.id === cfg.examId);
        if (plc && exm) {
          const targetDate = cfg.proposedDate || exm.scheduledDate;
          const targetDay = cfg.proposedDate ? getWeekdayName(cfg.proposedDate) : (cfg.conflictDay || exm.day);
          const overlapSlots = (cfg.proposedStartTime && cfg.proposedEndTime)
            ? getOverlappingSlotIds(cfg.proposedStartTime, cfg.proposedEndTime)
            : [cfg.conflictSlotId || exm.slotId];
          const targetSlot = overlapSlots.includes(exm.slotId) ? exm.slotId : (overlapSlots[0] || exm.slotId);
          const prioMode = cfg.reschedulingPriority || 'EXAM_FIRST';

          if (targetDate) touchedDates.add(targetDate);

          // Move placement to proposed date & slot
          plc.day = targetDay;
          plc.scheduledDate = targetDate;
          plc.slotId = targetSlot;

          // If using legacy conflictDay/Slot without proposedDate, keep legacy behavior
          if (!cfg.proposedDate && cfg.conflictDay) {
            exm.day = cfg.conflictDay;
            exm.scheduledDate = refWeek[cfg.conflictDay] || exm.scheduledDate;
            exm.slotId = targetSlot;
          }

          if (prioMode === 'PLACEMENT_FIRST') {
            plc.priority = 110;
            exm.priority = 80;
          } else if (prioMode === 'BALANCED') {
            exm.priority = 95;
            plc.priority = 85;
          } else {
            exm.priority = 100;
            plc.priority = 80;
          }

          // Check whether proposed placement actually collides with the selected examination or other scheduled activities
          const clashesWithExam = (targetDate === exm.scheduledDate) && overlapSlots.includes(exm.slotId);
          if (clashesWithExam && plc.sectionId !== exm.sectionId && plc.roomId !== exm.roomId) {
            plc.roomId = exm.roomId;
          }

          injectedClashes.push({
            id: `CLASH-${plc.id}-${exm.id}`,
            placementId: plc.id,
            examId: exm.id,
            sectionId: exm.sectionId,
            plcSectionId: plc.sectionId,
            roomId: exm.roomId,
            plcRoomId: plc.roomId,
            exmFacultyId: exm.invigilatorId,
            plcFacultyId: plc.coordinatorId,
            date: targetDate,
            day: targetDay,
            slotId: targetSlot,
            overlapSlots,
            clashesWithExam,
            reschedulingPriority: prioMode
          });
        }
      }

      else if (cfg.scenarioType === 'GENERIC_NODE' && cfg.nodeId) {
        rootFailedNodes.set(cfg.nodeId, 'Direct failure injected');
        if (cfg.nodeId.startsWith('HST-')) blockedHostelNodes.add(cfg.nodeId);
        if (cfg.nodeId.startsWith('ADM-')) {
          const allPairs = [];
          Object.values(refWeek).forEach((dStr) => {
            SLOTS.forEach((s) => allPairs.push({ date: dStr, slotId: s.id }));
          });
          addBlockedOcc(blockedAdminOcc, cfg.nodeId, allPairs);
        }
      }
    });

    const graph = buildDependencyGraph(state);
    const nodeStatus = new Map();
    const nodeImpactReason = new Map();
    const nodeHop = new Map();
    const morningBlockedFaculty = new Set();
    const bfsTrace = [];

    graph.nodes.forEach((_, id) => nodeStatus.set(id, 'operational'));

    const queue = [];
    const visited = new Set();

    function markNode(id, status, hop, reason, causedBy, relation) {
      const prev = nodeStatus.get(id);
      if (prev === 'operational' || (prev === 'affected' && status === 'failed')) {
        nodeStatus.set(id, status);
        nodeHop.set(id, hop);
        nodeImpactReason.set(id, reason);
        bfsTrace.push({
          hop,
          nodeId: id,
          label: graph.nodes.get(id)?.label || id,
          category: graph.nodes.get(id)?.category || 'resource',
          status,
          causedBy,
          relation
        });
      }
      if (!visited.has(id)) {
        visited.add(id);
        queue.push({ id, hop });
      }
    }

    rootFailedNodes.forEach((reason, id) => {
      if (graph.nodes.has(id)) {
        markNode(id, 'failed', 0, reason, 'ROOT', 'direct_failure');
      }
    });

    rootAffectedNodes.forEach((reason, id) => {
      if (graph.nodes.has(id)) {
        markNode(id, 'affected', 1, reason, 'ADM-02', 'supplies_power');
      }
    });

    // Track impacted occurrences deduplicated by (activityId, occurrenceDate)
    const impactedOccurrencesMap = new Map(); // `${act.id}@${dateStr}` -> occObj
    function addImpactedOccurrence(act, dateStr, reason, causedBy, relation, hop = 1) {
      const occKey = `${act.id}@${dateStr}`;
      if (!impactedOccurrencesMap.has(occKey)) {
        impactedOccurrencesMap.set(occKey, {
          occKey,
          activity: act,
          occurrenceDate: dateStr,
          occurrenceDateDMY: formatDateDMY(dateStr),
          weekday: getWeekdayName(dateStr),
          reason,
          causedBy,
          relation
        });
      }
      markNode(act.id, nodeStatus.get(act.id) === 'failed' ? 'failed' : 'affected', hop, reason, causedBy, relation);
      markNode(act.sectionId, 'affected', hop + 1, `Students impacted via ${act.id} on ${formatDateDMY(dateStr)}`, act.id, 'scheduled_for_section');
      markNode(`DEPT-${act.department}`, 'affected', hop + 2, `Department impacted via ${act.sectionId}`, act.sectionId, 'belongs_to_department');
    }

    // Evaluate Clash Injections on exact target date & overlapping slots
    injectedClashes.forEach((clash) => {
      const activitiesOnClashDate = getActivitiesOnDate(state, clash.date);
      if (clash.clashesWithExam) {
        const exmFirst = clash.reschedulingPriority !== 'PLACEMENT_FIRST';
        const loserId = exmFirst ? clash.placementId : clash.examId;
        const winnerId = exmFirst ? clash.examId : clash.placementId;
        const loserAct = graph.activities.find((a) => a.id === loserId);
        const winRoom = exmFirst ? clash.roomId : clash.plcRoomId;
        const winFac = exmFirst ? clash.exmFacultyId : clash.plcFacultyId;
        const winSec = exmFirst ? clash.sectionId : clash.plcSectionId;

        if (loserAct) {
          markNode(
            loserId,
            'failed',
            0,
            `Priority conflict with ${winnerId} on ${formatDateDMY(clash.date)} (${clash.day} ${clash.slotId}, ${clash.reschedulingPriority})`,
            'CLASH_INJECTION',
            'schedule_conflict'
          );
          addImpactedOccurrence(
            loserAct,
            clash.date,
            `Priority conflict with ${winnerId} on ${formatDateDMY(clash.date)} (${clash.day} ${clash.slotId})`,
            'CLASH_INJECTION',
            'schedule_conflict',
            0
          );
        }

        activitiesOnClashDate.forEach((act) => {
          if (act.id === clash.placementId || act.id === clash.examId) return;
          if (clash.overlapSlots.includes(act.slotId)) {
            if (act.sectionId === winSec || act.roomId === winRoom || act.facultyId === winFac) {
              addImpactedOccurrence(
                act,
                clash.date,
                `Slot collision on ${formatDateDMY(clash.date)} (${clash.day} ${act.slotId}) caused by ${winnerId}`,
                winnerId,
                'slot_collision',
                1
              );
            }
          }
        });
      } else {
        // Proposed placement date/time did NOT collide with the selected exam; check if it collides with regular sessions
        const plcAct = graph.activities.find((a) => a.id === clash.placementId);
        let collided = false;
        activitiesOnClashDate.forEach((act) => {
          if (act.id === clash.placementId) return;
          if (clash.overlapSlots.includes(act.slotId)) {
            if (act.sectionId === clash.plcSectionId || act.roomId === clash.plcRoomId || act.facultyId === clash.plcFacultyId) {
              collided = true;
              addImpactedOccurrence(
                act,
                clash.date,
                `Slot collision on ${formatDateDMY(clash.date)} (${clash.day} ${act.slotId}) with ${clash.placementId}`,
                clash.placementId,
                'slot_collision',
                1
              );
            }
          }
        });
        if (collided && plcAct) {
          addImpactedOccurrence(
            plcAct,
            clash.date,
            `Proposed placement overlaps existing activity on ${formatDateDMY(clash.date)} (${clash.day} ${clash.slotId})`,
            'CLASH_INJECTION',
            'schedule_conflict',
            0
          );
        }
      }
    });

    // Helper: check if an activity fails on a specific occurrence dateStr
    function evaluateActivityOnDate(act, dateStr) {
      const occSlotKey = `${dateStr}|${act.slotId}`;

      const facBlocked = blockedFacultyOcc.get(act.facultyId);
      if (facBlocked && facBlocked.has(occSlotKey)) {
        return {
          failed: true,
          causedBy: act.facultyId,
          relation: 'teaches_or_leads',
          reason: `${blockedFacultyReason.get(act.facultyId) || `${act.facultyId} unavailable`} on ${formatDateDMY(dateStr)} (${act.day} ${act.slotId})`
        };
      }

      const roomBlocked = blockedRoomOcc.get(act.roomId);
      if (roomBlocked && roomBlocked.has(occSlotKey)) {
        return {
          failed: true,
          causedBy: act.roomId,
          relation: 'hosts_activity',
          reason: `${act.roomId} unavailable / unpowered on ${formatDateDMY(dateStr)} (${act.day} ${act.slotId})`
        };
      }

      const capRules = roomCapacityRules.get(act.roomId);
      if (capRules) {
        for (const rule of capRules) {
          if (rule.examFilter && act.id !== rule.examFilter) continue;
          if (rule.occSet.has(occSlotKey) && (rule.forceFullOutage || act.studentCount > rule.usableCapacity)) {
            return {
              failed: true,
              causedBy: act.roomId,
              relation: 'capacity_constraint',
              reason: `${act.roomId} usable capacity (${rule.usableCapacity}) < ${act.studentCount} seats on ${formatDateDMY(dateStr)} (${rule.reason})`
            };
          }
        }
      }

      if (act.adminId && blockedAdminOcc.has(act.adminId) && blockedAdminOcc.get(act.adminId).has(occSlotKey)) {
        return {
          failed: true,
          causedBy: act.adminId,
          relation: 'administers',
          reason: `${act.adminId} offline on ${formatDateDMY(dateStr)} (${act.day} ${act.slotId})`
        };
      }

      return null;
    }

    const evaluationDates = touchedDates.size > 0
      ? Array.from(touchedDates).sort()
      : Object.values(refWeek);

    const datesWithNoActivities = [];
    evaluationDates.forEach((dateStr) => {
      const dayActs = getActivitiesOnDate(state, dateStr);
      if (dayActs.length === 0) {
        datesWithNoActivities.push(dateStr);
        return;
      }
      dayActs.forEach((act) => {
        const failInfo = evaluateActivityOnDate(act, dateStr);
        if (failInfo) {
          addImpactedOccurrence(act, dateStr, failInfo.reason, failInfo.causedBy, failInfo.relation, 1);
        }
      });
    });

    // BFS propagation for infrastructure/bus/hostel/section visual & trace status
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      const edges = graph.adj.get(current.id) || [];

      for (const edge of edges) {
        const targetNode = graph.nodes.get(edge.to);
        if (!targetNode) continue;
        if (edge.condition && edge.condition.advisoryOnly) continue;

        if (edge.condition && edge.condition.morningOnly) {
          morningBlockedFaculty.add(edge.to);
          const fWin = blockedFacultyOcc.get(edge.to);
          if (fWin && fWin.size > 0) {
            markNode(edge.to, 'affected', current.hop + 1, blockedFacultyReason.get(edge.to) || `Delayed due to ${current.id}`, current.id, edge.relation);
          }
          continue;
        }

        if (targetNode.category === 'classroom' || targetNode.category === 'lab') {
          if (blockedRoomOcc.has(edge.to) && blockedRoomOcc.get(edge.to).size > 0) {
            markNode(edge.to, 'affected', current.hop + 1, `Lost power/network from ${current.id}`, current.id, edge.relation);
          }
          continue;
        }

        if (targetNode.category === 'hostel') {
          if (blockedHostelNodes.has(edge.to)) {
            markNode(edge.to, 'affected', current.hop + 1, `Power outage from ${current.id}`, current.id, edge.relation);
          }
          continue;
        }

        if (targetNode.category === 'section' || targetNode.category === 'department') {
          const srcSt = nodeStatus.get(current.id);
          if (srcSt === 'failed' || srcSt === 'affected') {
            markNode(edge.to, 'affected', current.hop + 1, `Impacted via ${current.id}`, current.id, edge.relation);
          }
        }
      }
    }

    // Deduplicated unique activities list (preserve activity metadata + all affected occurrenceDates)
    const impactedOccurrences = Array.from(impactedOccurrencesMap.values());
    const impactedByActivityId = new Map();
    impactedOccurrences.forEach((occ) => {
      if (!impactedByActivityId.has(occ.activity.id)) {
        impactedByActivityId.set(occ.activity.id, {
          ...occ.activity,
          occurrenceDates: [occ.occurrenceDate],
          occurrenceLabels: [occ.occurrenceDateDMY]
        });
      } else {
        const existing = impactedByActivityId.get(occ.activity.id);
        if (!existing.occurrenceDates.includes(occ.occurrenceDate)) {
          existing.occurrenceDates.push(occ.occurrenceDate);
          existing.occurrenceLabels.push(occ.occurrenceDateDMY);
        }
      }
    });
    const impactedActivities = Array.from(impactedByActivityId.values());

    // Deduplicated unique student count per section (never double-counts across multiple dates or failures)
    const sectionImpactedStudents = new Map();
    state.sections.forEach((s) => sectionImpactedStudents.set(s.id, 0));

    impactedActivities.forEach((act) => {
      const sec = state.sections.find((s) => s.id === act.sectionId);
      if (sec) sectionImpactedStudents.set(sec.id, sec.studentCount);
    });

    busBreakdowns.forEach((bb) => {
      const bus = state.buses.find((b) => b.id === bb.busId);
      if (!bus) return;
      const busHasActiveWeekday = (bb.dates || []).some((dStr) => {
        const wd = getWeekdayName(dStr);
        return DAYS.includes(wd);
      });
      if (!busHasActiveWeekday) return;
      bus.linkedSections.forEach((secId) => {
        const sec = state.sections.find((s) => s.id === secId);
        if (sec) {
          const cur = sectionImpactedStudents.get(secId) || 0;
          const commuterSlice = Math.round(sec.busCommuters / 2);
          sectionImpactedStudents.set(secId, Math.min(sec.studentCount, Math.max(cur, commuterSlice)));
        }
      });
    });

    state.hostels.forEach((h) => {
      if (blockedHostelNodes.has(h.id)) {
        h.linkedSections.forEach((secId) => {
          const sec = state.sections.find((s) => s.id === secId);
          if (sec) {
            const cur = sectionImpactedStudents.get(secId) || 0;
            sectionImpactedStudents.set(secId, Math.min(sec.studentCount, Math.max(cur, sec.hostelResidents)));
          }
        });
      }
    });

    let affectedStudents = 0;
    sectionImpactedStudents.forEach((cnt) => { affectedStudents += cnt; });

    const operationalFaculty = state.faculty.filter((f) => nodeStatus.get(f.id) === 'operational').length;
    const operationalClassrooms = state.classrooms.filter((c) => nodeStatus.get(c.id) === 'operational').length;
    const operationalLabs = state.labs.filter((l) => nodeStatus.get(l.id) === 'operational').length;
    const operationalBuses = state.buses.filter((b) => nodeStatus.get(b.id) === 'operational').length;

    const totalResWeight = 50 + 25 + 10 + 8 + 5;
    const downRes =
      (50 - operationalFaculty) * 0.9 +
      (25 - operationalClassrooms) * 1.1 +
      (10 - operationalLabs) * 1.4 +
      (8 - operationalBuses) * 0.9 +
      state.admin.filter((a) => nodeStatus.get(a.id) !== 'operational').length * 2.5;
    const actPenalty = impactedActivities.reduce((acc, a) => acc + (a.activityType === 'EXAM' ? 4.0 : a.activityType === 'PLACEMENT' ? 2.8 : 1.0), 0);
    const rawHealth = 100 - ((downRes / totalResWeight) * 55 + (actPenalty / Math.max(1, graph.activities.length)) * 85);
    const campusHealthPct = Math.max(0, Math.min(100, Math.round(rawHealth * 10) / 10));

    return {
      state,
      graph,
      failureConfigs: cloneState(failureConfigs),
      failedIds: Array.from(rootFailedNodes.keys()),
      injectedClashes,
      nodeStatus,
      nodeImpactReason,
      nodeHop,
      morningBlockedFaculty,
      bfsTrace,
      impactedActivities,
      impactedOccurrences,
      evaluationDates,
      datesWithNoActivities,
      noScheduledActivitiesOnly: evaluationDates.length > 0 && datesWithNoActivities.length === evaluationDates.length && impactedActivities.length === 0,
      constraintsContext: {
        blockedFacultyOcc,
        blockedRoomOcc,
        roomCapacityRules,
        blockedHostelNodes,
        blockedAdminOcc,
        busBreakdowns
      },
      metrics: {
        campusHealthPct,
        availableFaculty: operationalFaculty,
        totalFaculty: state.faculty.length,
        availableClassrooms: operationalClassrooms,
        totalClassrooms: state.classrooms.length,
        availableLabs: operationalLabs,
        totalLabs: state.labs.length,
        availableBuses: operationalBuses,
        totalBuses: state.buses.length,
        affectedStudents,
        totalStudents: state.meta.totalStudents,
        activeDisruptions: impactedOccurrences.length + injectedClashes.filter((c) => c.clashesWithExam).length + (impactedOccurrences.length > 0 ? rootFailedNodes.size : 0),
        impactedSessionsCount: impactedOccurrences.length,
        uniqueImpactedActivitiesCount: impactedActivities.length,
        unresolvedConflicts: impactedOccurrences.length
      }
    };
  }

  function simulateCascade(rawState, failedIds = [], conflictInjections = []) {
    const configs = legacyToConfigs(rawState, failedIds, conflictInjections);
    return simulateFromConfigs(rawState, configs);
  }

  /**
   * Configurable relative cost weights for recovery actions (Relative Recovery Cost Score).
   * Higher weights penalize more disruptive operations (e.g., exam rescheduling, unresolved critical items).
   */
  const RECOVERY_COST_WEIGHTS = {
    facultySubstitution: 25,
    classroomRelocation: 15,
    labRelocation: 20,
    timeSlotShift: 35,
    extraFacultyLoadSurcharge: 10,
    transportReallocation: 12,
    spareBusDispatch: 30,
    examReschedulePenalty: 55,
    batchSplitPenalty: 18,
    backupResourceUsage: 20,
    lowPriorityPreemption: 28,
    unresolvedCriticalPenalty: 120,
    unresolvedStandardPenalty: 45
  };

  /**
   * Compute canonical signature from exact recovery actions, preemptions, splits, and transit routes.
   * Used to eliminate mathematically identical duplicate plans cleanly.
   */
  function buildPlanSignature(plan) {
    const actSig = [...plan.actions]
      .sort((a, b) => a.occKey.localeCompare(b.occKey))
      .map((a) => `${a.occKey}:${a.resolved}:${a.newDate}:${a.newSlotId}:${a.newFacultyId}:${a.newRoomId}:${a.splitSummary || ''}:${a.preemptedFrom || ''}`)
      .join('|');
    const preSig = [...(plan.preemptions || [])]
      .sort((a, b) => a.occKey.localeCompare(b.occKey))
      .map((p) => `${p.occKey}:${p.newDate}:${p.newSlotId}:${p.newRoomId}`)
      .join('|');
    const trSig = [...plan.transitActions]
      .sort((a, b) => a.busId.localeCompare(b.busId))
      .map((t) => `${t.busId}:${t.reroutedTo}:${t.reroutedStudents}`)
      .join('|');
    return `${actSig}::${preSig}::${trSig}`;
  }

  /**
   * Compare two non-identical plans that may share similar summary counts and explain operational differences.
   */
  function describeOperationalDifference(plan, otherPlans) {
    const others = otherPlans.filter((o) => o !== plan);
    if (others.length === 0) return '';
    const myFacs = new Set(plan.actions.filter((a) => a.resolved && a.facChanged).map((a) => `${a.activityId}->${a.newFacultyId}`));
    const myRooms = new Set(plan.actions.filter((a) => a.resolved && a.roomChanged).map((a) => `${a.activityId}->${a.newRoomId}`));
    const mySlots = new Set(plan.actions.filter((a) => a.resolved && a.timeChanged).map((a) => `${a.activityId}->${a.newDay} ${a.newSlotId}`));
    const mySplits = plan.actions.filter((a) => a.isSplit).length;
    const myPreempt = (plan.preemptions || []).length;

    const notes = [];
    const anyDifferentFacs = others.some((o) => {
      const oFacs = new Set(o.actions.filter((a) => a.resolved && a.facChanged).map((a) => `${a.activityId}->${a.newFacultyId}`));
      if (oFacs.size !== myFacs.size) return true;
      for (const x of myFacs) if (!oFacs.has(x)) return true;
      return false;
    });
    const anyDifferentRooms = others.some((o) => {
      const oRooms = new Set(o.actions.filter((a) => a.resolved && a.roomChanged).map((a) => `${a.activityId}->${a.newRoomId}`));
      if (oRooms.size !== myRooms.size) return true;
      for (const x of myRooms) if (!oRooms.has(x)) return true;
      return false;
    });
    const anyDifferentSlots = others.some((o) => {
      const oSlots = new Set(o.actions.filter((a) => a.resolved && a.timeChanged).map((a) => `${a.activityId}->${a.newDay} ${a.newSlotId}`));
      if (oSlots.size !== mySlots.size) return true;
      for (const x of mySlots) if (!oSlots.has(x)) return true;
      return false;
    });

    if (anyDifferentSlots) notes.push('uses distinct time-slot assignments');
    if (anyDifferentFacs) notes.push('assigns different substitute/reserve faculty');
    if (anyDifferentRooms) notes.push('relocates activities to different rooms/labs');
    if (mySplits > 0) notes.push(`applies ${mySplits} capacity-based batch/hall split(s)`);
    if (myPreempt > 0) notes.push(`defers ${myPreempt} lower-priority activity(ies) to shield critical sessions`);
    if (plan.transitActions.length > 0) {
      notes.push(`routes transit using ${plan.transitPolicyLabel}`);
    }
    if (!notes.length) return '';
    return `Operationally distinct: ${notes.join(', ')}.`;
  }

  /**
   * Build explainable Rank #1 recommendation summary from actual evaluation metrics.
   */
  function buildRankReason(winner, allPlans) {
    const s = winner.stats;
    if (allPlans.length === 1) {
      return `Only unique valid plan (${s.resolvedCount}/${s.totalImpacted} recovered, ${s.recoveryPct}%, ${s.unresolvedConflicts} unresolved, ${s.recoveryCost} relative cost pts).`;
    }
    const runnerUp = allPlans[1];
    const rs = runnerUp.stats;
    const reasons = [];
    if (s.unresolvedCriticalCount < rs.unresolvedCriticalCount) {
      reasons.push(`protects more critical activities (${s.criticalRecovered}/${s.criticalTotal} vs ${rs.criticalRecovered}/${rs.criticalTotal})`);
    }
    if (s.unresolvedConflicts < rs.unresolvedConflicts) {
      reasons.push(`leaves fewer unresolved conflicts (${s.unresolvedConflicts} vs ${rs.unresolvedConflicts})`);
    }
    if (s.affectedStudentsAfter < rs.affectedStudentsAfter) {
      reasons.push(`reduces remaining affected students further (${s.affectedStudentsAfter} vs ${rs.affectedStudentsAfter})`);
    }
    if (s.resolvedCount > rs.resolvedCount) {
      reasons.push(`recovers more sessions (${s.resolvedCount} vs ${rs.resolvedCount})`);
    }
    if (s.scheduleChanges < rs.scheduleChanges) {
      reasons.push(`requires fewer schedule changes (${s.scheduleChanges} vs ${rs.scheduleChanges})`);
    }
    if (s.workloadMetrics.loadStdDev < rs.workloadMetrics.loadStdDev - 0.05) {
      reasons.push(`achieves tighter faculty workload balance (σ ${s.workloadMetrics.loadStdDev}% vs ${rs.workloadMetrics.loadStdDev}%)`);
    }
    if (s.recoveryCost < rs.recoveryCost) {
      reasons.push(`incurs a lower relative recovery cost score (${s.recoveryCost} vs ${rs.recoveryCost} pts)`);
    }
    if (!reasons.length) {
      reasons.push(`resolves ${s.resolvedCount}/${s.totalImpacted} impacted sessions cleanly with zero hard-constraint violations`);
    }
    return `Ranked #1 over "${runnerUp.name}" because it ${reasons.join(', ')}.`;
  }

  /**
   * Constraint-Based Recovery Engine
   * Independently evaluates 3 genuinely distinct strategies on deep-cloned campus state,
   * validates hard institutional constraints, deduplicates equivalent action sets,
   * and dynamically ranks valid alternatives.
   */
  function generateRecoveryPlans(cascadeResult) {
    const { impactedOccurrences, failedIds, injectedClashes, constraintsContext } = cascadeResult;
    const hasExamClash = injectedClashes.some((c) => c.clashesWithExam);
    const hasBusImpact = constraintsContext.busBreakdowns.length > 0 && impactedOccurrences.length > 0;
    const hasBusBreakdowns = constraintsContext.busBreakdowns.length > 0;

    if (impactedOccurrences.length === 0 && !hasExamClash && !hasBusImpact && !hasBusBreakdowns && failedIds.length === 0) {
      return [];
    }
    if (impactedOccurrences.length === 0 && cascadeResult.metrics.affectedStudents === 0) {
      return [];
    }

    const strategies = [
      {
        id: 'PLAN-MIN-CHANGE',
        name: 'Minimal-Disruption In-Slot Recovery',
        badge: 'Preserve Timings',
        description: 'Keeps original dates and time slots intact wherever valid substitutes/rooms exist, using same-block rooms and minimal swaps; reschedules only when in-slot recovery is impossible.',
        mode: 'minChange',
        transitMode: 'greedy-minimal'
      },
      {
        id: 'PLAN-BALANCED-OPT',
        name: 'Balanced Load & Smart Rescheduling',
        badge: 'Load Balanced',
        description: 'Balances weekly and daily faculty workloads, avoids reusing the same substitute repeatedly, spreads room utilization, and shifts slots when beneficial for balance.',
        mode: 'balancedLoad',
        transitMode: 'proportional-balanced'
      },
      {
        id: 'PLAN-PRIORITY-SHIELD',
        name: 'Priority Shield & Reserve Pool',
        badge: 'High Resilience',
        description: 'Protects Examinations, Labs & Placements first using low-risk reserve faculty, UPS/backup infrastructure, capacity batch-splits, afternoon bus-recovery preservation, and low-priority preemption.',
        mode: 'priorityShield',
        transitMode: 'priority-reserve-shuttle'
      }
    ];

    // Deep isolation: each strategy solves against its own fresh clone of cascadeResult.state
    const evaluated = [];
    strategies.forEach((strat) => {
      const plan = solveWithStrategy(cascadeResult, strat);
      // Verify hard schedule validity strictly; reject plans with hard violations unless all plans fail
      evaluated.push(plan);
    });

    const validPlans = evaluated.filter((p) => p.validation.valid);
    const candidatePool = validPlans.length > 0 ? validPlans : evaluated;

    // Deduplicate plans with identical canonical action + preemption + transit signatures
    const uniquePlans = [];
    const sigToPlan = new Map();

    candidatePool.forEach((plan) => {
      const sig = buildPlanSignature(plan);
      plan.canonicalSignature = sig;
      if (sigToPlan.has(sig)) {
        const existing = sigToPlan.get(sig);
        existing.convergedStrategies.push(plan.name);
        if (!existing.convergedStrategyIds.includes(plan.strategyId)) {
          existing.convergedStrategyIds.push(plan.strategyId);
        }
      } else {
        plan.convergedStrategies = [plan.name];
        plan.convergedStrategyIds = [plan.strategyId];
        sigToPlan.set(sig, plan);
        uniquePlans.push(plan);
      }
    });

    // Rank strictly by institutional objectives (never permanently by strategy name)
    uniquePlans.sort((a, b) => {
      const sa = a.stats;
      const sb = b.stats;
      // 1. Unresolved critical activities (Exams & Placements)
      if (sa.unresolvedCriticalCount !== sb.unresolvedCriticalCount) {
        return sa.unresolvedCriticalCount - sb.unresolvedCriticalCount;
      }
      // 2. Total unresolved conflicts
      if (sa.unresolvedConflicts !== sb.unresolvedConflicts) {
        return sa.unresolvedConflicts - sb.unresolvedConflicts;
      }
      // 3. Remaining affected students
      if (sa.affectedStudentsAfter !== sb.affectedStudentsAfter) {
        return sa.affectedStudentsAfter - sb.affectedStudentsAfter;
      }
      // 4. Higher recovered activity count
      if (sa.resolvedCount !== sb.resolvedCount) {
        return sb.resolvedCount - sa.resolvedCount;
      }
      // 5. Fewer schedule changes
      if (sa.scheduleChanges !== sb.scheduleChanges) {
        return sa.scheduleChanges - sb.scheduleChanges;
      }
      // 6. Better faculty workload balance (lower utilization std-dev)
      if (Math.abs(sa.workloadMetrics.loadStdDev - sb.workloadMetrics.loadStdDev) > 0.05) {
        return sa.workloadMetrics.loadStdDev - sb.workloadMetrics.loadStdDev;
      }
      // 7. Lower relative recovery cost score
      return sa.recoveryCost - sb.recoveryCost;
    });

    const allConverged = uniquePlans.length === 1 && uniquePlans[0].convergedStrategies.length === strategies.length;
    const winnerReason = uniquePlans.length > 0 ? buildRankReason(uniquePlans[0], uniquePlans) : '';

    uniquePlans.forEach((p, idx) => {
      p.rank = idx + 1;
      p.allConverged = allConverged;
      p.convergenceMessage = allConverged
        ? 'All evaluated strategies converge on the same optimal recovery plan.'
        : (p.convergedStrategies.length > 1
          ? `Converged solution shared by: ${p.convergedStrategies.join(' & ')}.`
          : '');
      p.rankReason = idx === 0 ? winnerReason : '';
      p.operationalDifferenceNote = uniquePlans.length > 1
        ? describeOperationalDifference(p, uniquePlans)
        : '';
    });

    return uniquePlans;
  }

  function solveWithStrategy(cascadeResult, strat) {
    const recoveredState = cloneState(cascadeResult.state);
    const {
      nodeStatus,
      morningBlockedFaculty,
      impactedOccurrences,
      constraintsContext
    } = cascadeResult;
    const {
      blockedFacultyOcc,
      blockedRoomOcc,
      roomCapacityRules,
      blockedHostelNodes,
      blockedAdminOcc,
      busBreakdowns
    } = constraintsContext;

    const impactedOccKeySet = new Set(impactedOccurrences.map((o) => o.occKey));
    const impactedActDateSet = new Set(impactedOccurrences.map((o) => `${o.activity.id}|${o.occurrenceDate}`));

    // Per-date & template occupancy tracking (strictly isolated to this strategy run)
    const busyFacultyOcc = new Set(); // `${facId}|${dateStr}|${slotId}`
    const busySectionOcc = new Set();
    const busyRoomOcc = new Set();
    const seededDates = new Set();

    const facultyWeekLoad = new Map(); // `${facId}|${weekMon}` -> count
    const facultyDayLoad = new Map();  // `${facId}|${dateStr}` -> count
    const substituteUseCount = new Map(); // facId -> times used as substitute
    const roomWeekUsage = new Map();   // roomId -> total uses across week
    const seededWeeks = new Set();

    // Template-level occupancy for non-clashing weekly template updates
    const tplBusyFaculty = new Set();
    const tplBusySection = new Set();
    const tplBusyRoom = new Set();
    const initialActs = getAllActivities(recoveredState);
    initialActs.forEach((act) => {
      const hasAnyImpact = impactedOccurrences.some((o) => o.activity.id === act.id);
      if (hasAnyImpact) return;
      tplBusyFaculty.add(`${act.facultyId}|${act.day}|${act.slotId}`);
      tplBusySection.add(`${act.sectionId}|${act.day}|${act.slotId}`);
      tplBusyRoom.add(`${act.roomId}|${act.day}|${act.slotId}`);
    });

    function ensureDateSeeded(dateStr) {
      if (seededDates.has(dateStr)) return;
      seededDates.add(dateStr);
      const dayActs = getActivitiesOnDate(recoveredState, dateStr);
      dayActs.forEach((act) => {
        if (impactedActDateSet.has(`${act.id}|${dateStr}`)) return;
        busyFacultyOcc.add(`${act.facultyId}|${dateStr}|${act.slotId}`);
        busySectionOcc.add(`${act.sectionId}|${dateStr}|${act.slotId}`);
        busyRoomOcc.add(`${act.roomId}|${dateStr}|${act.slotId}`);
        facultyDayLoad.set(`${act.facultyId}|${dateStr}`, (facultyDayLoad.get(`${act.facultyId}|${dateStr}`) || 0) + 1);
      });
    }

    function ensureWeekSeeded(weekMon) {
      if (seededWeeks.has(weekMon)) return;
      seededWeeks.add(weekMon);
      recoveredState.faculty.forEach((f) => facultyWeekLoad.set(`${f.id}|${weekMon}`, 0));
      DAYS.forEach((dayName, idx) => {
        const dt = addDaysISO(weekMon, idx);
        const dayActs = getActivitiesOnDate(recoveredState, dt);
        dayActs.forEach((act) => {
          roomWeekUsage.set(act.roomId, (roomWeekUsage.get(act.roomId) || 0) + 1);
          if (impactedActDateSet.has(`${act.id}|${dt}`)) return;
          const k = `${act.facultyId}|${weekMon}`;
          facultyWeekLoad.set(k, (facultyWeekLoad.get(k) || 0) + 1);
        });
      });
    }

    // Priority ordering:
    // Priority Shield strictly prioritizes higher priority + higher semester first;
    // others prioritize priority desc -> date -> id.
    const sectionMap = new Map(recoveredState.sections.map((s) => [s.id, s]));
    const facultyMap = new Map(recoveredState.faculty.map((f) => [f.id, f]));
    const roomMap = new Map([...recoveredState.classrooms, ...recoveredState.labs].map((r) => [r.id, r]));
    const allRoomsPool = [...recoveredState.classrooms, ...recoveredState.labs];

    const sortedImpacted = [...impactedOccurrences].sort((a, b) => {
      if (b.activity.priority !== a.activity.priority) return b.activity.priority - a.activity.priority;
      if (strat.mode === 'priorityShield') {
        const semA = sectionMap.get(a.activity.sectionId)?.semester || 0;
        const semB = sectionMap.get(b.activity.sectionId)?.semester || 0;
        if (semB !== semA) return semB - semA;
      }
      if (a.occurrenceDate !== b.occurrenceDate) return a.occurrenceDate.localeCompare(b.occurrenceDate);
      return a.activity.id.localeCompare(b.activity.id);
    });

    function isFacultyAvailable(fac, act, dateStr, slotId, weekMon) {
      const occSlotKey = `${dateStr}|${slotId}`;
      const fBlocked = blockedFacultyOcc.get(fac.id);
      if (fBlocked && fBlocked.has(occSlotKey)) return false;
      if (busyFacultyOcc.has(`${fac.id}|${occSlotKey}`)) return false;
      const wKey = `${fac.id}|${weekMon}`;
      if ((facultyWeekLoad.get(wKey) || 0) + 1 > fac.maxWeeklyLoad) return false;
      if (act.subjectId) {
        if (!fac.qualifications.includes(act.subjectId)) return false;
      } else if (fac.department !== act.department) {
        return false;
      }
      return true;
    }

    function getEffectiveRoomCapacity(room, dateStr, slotId, activityId = null) {
      const occSlotKey = `${dateStr}|${slotId}`;
      const rBlocked = blockedRoomOcc.get(room.id);
      if (rBlocked && rBlocked.has(occSlotKey)) return 0;

      let cap = room.capacity;
      const rules = roomCapacityRules.get(room.id);
      if (rules) {
        for (const rule of rules) {
          if (rule.examFilter && activityId && rule.examFilter !== activityId) continue;
          if (rule.occSet.has(occSlotKey)) {
            cap = Math.min(cap, rule.forceFullOutage ? 0 : rule.usableCapacity);
          }
        }
      }
      return cap;
    }

    function isRoomTypeCompatible(room, act) {
      if (act.activityType === 'LAB') {
        return Boolean(room.labType && room.labType === act.labType);
      }
      if (act.activityType === 'EXAM') {
        return room.type === 'exam-hall' || room.type === 'auditorium' || room.type === 'lecture';
      }
      if (act.activityType === 'PLACEMENT' || act.activityType === 'EVENT') {
        return room.type === 'auditorium' || room.type === 'lecture';
      }
      return !room.labType && room.type !== undefined;
    }

    function isRoomAvailable(room, act, requiredSeats, dateStr, slotId) {
      const occSlotKey = `${dateStr}|${slotId}`;
      if (busyRoomOcc.has(`${room.id}|${occSlotKey}`)) return false;
      if (!isRoomTypeCompatible(room, act)) return false;
      const effCap = getEffectiveRoomCapacity(room, dateStr, slotId, act.id);
      if (effCap < requiredSeats) return false;
      // For Placement/Event prefer auditorium unless none usable
      if ((act.activityType === 'PLACEMENT' || act.activityType === 'EVENT') && room.type !== 'auditorium' && room.type !== 'lecture') {
        return false;
      }
      return true;
    }

    function computeCandidateObjective(ts, fac, room, act, origRoom, sec, weekMon) {
      const facChanged = fac.id !== act.facultyId;
      const roomChanged = room.id !== act.roomId;
      const timeChanged = !ts.isOriginal;
      const sameDay = ts.date === act.origDateRef;
      const sameBlock = Boolean(origRoom && room.block === origRoom.block);
      const effCap = getEffectiveRoomCapacity(room, ts.date, ts.slotId, act.id);
      const excessSeats = Math.max(0, effCap - sec.studentCount);

      const origDateKey = `${act.origDateRef}|${act.slotId}`;
      const origFacBlocked = Boolean(blockedFacultyOcc.get(act.facultyId)?.has(origDateKey));
      const origRoomBlocked = origRoom
        ? getEffectiveRoomCapacity(origRoom, act.origDateRef, act.slotId, act.id) < sec.studentCount
        : true;

      const wLoad = facultyWeekLoad.get(`${fac.id}|${weekMon}`) || 0;
      const utilPct = (wLoad / Math.max(1, fac.maxWeeklyLoad)) * 100;
      const dLoad = facultyDayLoad.get(`${fac.id}|${ts.date}`) || 0;
      const subRepeats = facChanged ? (substituteUseCount.get(fac.id) || 0) : 0;
      const rUses = roomWeekUsage.get(room.id) || 0;
      const sameDept = fac.department === act.department;

      let score = 0;

      if (strat.mode === 'minChange') {
        // Minimize timetable changes first: keep slot >> keep operational fac/room >> same block >> tight capacity
        if (timeChanged) score += sameDay ? 380 : 620;
        if (facChanged) score += origFacBlocked ? 30 : 420;
        if (roomChanged) score += origRoomBlocked ? 18 : 360;
        if (!sameBlock) score += 18;
        if (!sameDept) score += 45;
        score += excessSeats * 0.45;
        score += wLoad * 1.5;
        if (act.activityType === 'EXAM' && room.type !== 'exam-hall') score += 35;
        if ((act.activityType === 'PLACEMENT' || act.activityType === 'EVENT') && room.type !== 'auditorium') score += 30;
      } else if (strat.mode === 'balancedLoad') {
        // Balance weekly & daily faculty workload + distribute substitutes + balance room usage;
        // Preserve operational faculty/rooms, and replace blocked faculty/rooms on the same date before postponing to other days
        const isOrigMorningDelayed = morningBlockedFaculty.has(act.facultyId);
        const slotIsAfternoon = ['S3', 'S4', 'S5'].includes(ts.slotId);
        if (timeChanged) {
          score += sameDay ? (isOrigMorningDelayed && !facChanged && slotIsAfternoon ? 18 : 65) : 220;
          if (act.activityType === 'EXAM') score += 480;
        }
        if (facChanged) score += origFacBlocked ? 28 : 420;
        if (roomChanged) score += origRoomBlocked ? 15 : 360;
        score += subRepeats * 95;     // Strong diversity spread across distinct qualified faculty
        score += dLoad * 42;          // Penalize clustering multiple sessions on the same faculty day
        score += utilPct * 2.4;       // Strongly favor lowest % weekly utilization faculty
        score += rUses * 10;          // Spread utilization across classrooms & labs
        if (!sameBlock) score += 6;
        if (!sameDept) score += 30;
        score += excessSeats * 0.15;
        if (act.activityType === 'EXAM' && room.type !== 'exam-hall') score += 40;
        if ((act.activityType === 'PLACEMENT' || act.activityType === 'EVENT') && room.type !== 'auditorium') score += 22;
      } else {
        // priorityShield: Protect critical exams/placements/labs, favor non-bus reserve faculty
        // ONLY when substitution/relocation is needed, and keep regular bus-delayed faculty via same-day afternoon arrival shifts
        const isCritical = act.activityType === 'EXAM' || act.activityType === 'PLACEMENT';
        const isOrigMorningDelayed = morningBlockedFaculty.has(act.facultyId);
        const slotIsAfternoon = ['S3', 'S4', 'S5'].includes(ts.slotId);

        if (isOrigMorningDelayed && !facChanged && sameDay && slotIsAfternoon && timeChanged) {
          // Afternoon Arrival Preservation: keep original instructor instead of handing class to substitute
          score -= 65;
        } else if (timeChanged) {
          score += sameDay ? (isCritical ? 120 : 85) : (isCritical ? 290 : 250);
          if (act.activityType === 'EXAM') score += 480;
        }

        if (facChanged) score += origFacBlocked ? (isOrigMorningDelayed ? 55 : 30) : 420;
        if (roomChanged) score += origRoomBlocked ? (act.activityType === 'PLACEMENT' && room.id === 'CR-25' ? 8 : 18) : 360;

        // Reserve faculty pool preference: non-commuting (no transit risk) + generous headroom
        if (facChanged) {
          if (fac.busId) score += isCritical ? 55 : 22; // Prefer own/campus-resident reserve faculty
          else score -= 30;
          const headroom = fac.maxWeeklyLoad - wLoad;
          score -= Math.min(8, headroom) * 4;
          if (isCritical && (fac.designation.includes('Professor') || fac.designation.includes('HOD'))) {
            score -= 18;
          }
          if (!isCritical && fac.designation.includes('Assistant')) {
            score -= 12; // Reserve senior HODs for critical shielding, let junior faculty cover lectures
          }
          score += subRepeats * 22;
        }

        // UPS / independent network / high-capacity wing preference
        if (act.activityType === 'LAB') {
          if (room.name.includes('UPS')) score -= 32;
          if (!room.requiresNetwork) score -= 18;
        }
        if (isCritical && room.type === 'exam-hall') score -= 45;
        if (act.activityType === 'PLACEMENT' && room.id === 'CR-25') score -= 24; // Seminar wing isolation
        if (act.activityType === 'PLACEMENT' && room.type === 'auditorium') score -= 35;
        score += excessSeats * 0.08; // Allow larger buffer rooms cleanly
        if (!sameDept) score += 35;
      }

      return score;
    }

    function getCandidateOccurrenceSlots(origDate, origSlotId, act) {
      const weekMon = getWeekMondayISO(origDate);
      const origDay = getWeekdayName(origDate);
      const list = [];

      list.push({ date: origDate, day: origDay, slotId: origSlotId, isOriginal: true });

      const slotOrder = strat.mode === 'priorityShield'
        ? ['S3', 'S4', 'S5', 'S1', 'S2']
        : SLOTS.map((s) => s.id);

      // Same-day alternatives
      slotOrder.forEach((sId) => {
        if (sId !== origSlotId) {
          list.push({ date: origDate, day: origDay, slotId: sId, isOriginal: false });
        }
      });

      // Rest of the week
      DAYS.forEach((d, idx) => {
        if (d === origDay) return;
        const altDate = addDaysISO(weekMon, idx);
        slotOrder.forEach((sId) => {
          list.push({ date: altDate, day: d, slotId: sId, isOriginal: false });
        });
      });

      return list;
    }

    /**
     * Find a clean free future slot on the recovered schedule to relocate a single activity
     * (used for In-Slot Classroom Capacity Swaps and Priority-Shield Low-Priority Preemption).
     */
    function findRelocationForVictim(victimAct, dateStr, avoidSlotId, sameSlotOnly, excludeRoomId) {
      const weekMon = getWeekMondayISO(dateStr);
      const victimSec = sectionMap.get(victimAct.sectionId);
      const victimFac = facultyMap.get(victimAct.facultyId);
      if (!victimSec || !victimFac) return null;

      const slotsToCheck = sameSlotOnly
        ? [{ date: dateStr, day: victimAct.day, slotId: victimAct.slotId, isSameSlot: true }]
        : getCandidateOccurrenceSlots(dateStr, victimAct.slotId, victimAct).filter(
            (ts) => !(ts.date === dateStr && ts.slotId === avoidSlotId)
          );

      for (const ts of slotsToCheck) {
        ensureDateSeeded(ts.date);
        const wMon = getWeekMondayISO(ts.date);
        ensureWeekSeeded(wMon);
        const key = `${ts.date}|${ts.slotId}`;

        if (!ts.isSameSlot) {
          if (busySectionOcc.has(`${victimAct.sectionId}|${key}`)) continue;
          const fBlocked = blockedFacultyOcc.get(victimFac.id);
          if (fBlocked && fBlocked.has(key)) continue;
          if (busyFacultyOcc.has(`${victimFac.id}|${key}`)) continue;
        }
        if (victimAct.adminId && blockedAdminOcc.has(victimAct.adminId) && blockedAdminOcc.get(victimAct.adminId).has(key)) {
          continue;
        }

        const candRooms = allRoomsPool
          .filter((r) => r.id !== excludeRoomId && isRoomAvailable(r, victimAct, victimSec.studentCount, ts.date, ts.slotId))
          .sort((a, b) => a.capacity - b.capacity);

        if (candRooms.length > 0) {
          return { date: ts.date, day: ts.day, slotId: ts.slotId, weekMon: wMon, room: candRooms[0], isSameSlot: Boolean(ts.isSameSlot) };
        }
      }
      return null;
    }

    function applyTemplateUpdateIfEligible(act, solution) {
      const tplFKey = `${solution.faculty.id}|${solution.day}|${solution.slotId}`;
      const tplSKey = `${act.sectionId}|${solution.day}|${solution.slotId}`;
      const tplRKey = `${solution.room.id}|${solution.day}|${solution.slotId}`;

      // Guard against weekly template collisions when multiple distinct dates map into weekly grid
      if (tplBusyFaculty.has(tplFKey) || tplBusySection.has(tplSKey) || tplBusyRoom.has(tplRKey)) {
        return false;
      }
      tplBusyFaculty.add(tplFKey);
      tplBusySection.add(tplSKey);
      tplBusyRoom.add(tplRKey);

      if (act.kind === 'timetable') {
        const item = recoveredState.timetable.find((t) => t.id === act.id);
        if (item) {
          item.facultyId = solution.faculty.id;
          item.roomId = solution.room.id;
          item.day = solution.day;
          item.slotId = solution.slotId;
          item.recovered = true;
          if (solution.splitInfo) item.batchSplitNote = solution.splitInfo;
        }
      } else if (act.kind === 'examination') {
        const item = recoveredState.examinations.find((e) => e.id === act.id);
        if (item) {
          item.invigilatorId = solution.faculty.id;
          item.roomId = solution.room.id;
          item.day = solution.day;
          item.slotId = solution.slotId;
          item.scheduledDate = solution.date;
          item.recovered = true;
          if (solution.splitInfo) item.splitNote = solution.splitInfo;
        }
      } else if (act.kind === 'placement') {
        const item = recoveredState.placements.find((p) => p.id === act.id);
        if (item) {
          item.coordinatorId = solution.faculty.id;
          item.roomId = solution.room.id;
          item.day = solution.day;
          item.slotId = solution.slotId;
          item.scheduledDate = solution.date;
          item.recovered = true;
        }
      } else if (act.kind === 'event') {
        const item = recoveredState.events.find((ev) => ev.id === act.id);
        if (item) {
          item.coordinatorId = solution.faculty.id;
          item.roomId = solution.room.id;
          item.day = solution.day;
          item.slotId = solution.slotId;
          item.scheduledDate = solution.date;
          item.recovered = true;
        }
      }
      return true;
    }

    const actions = [];
    const preemptions = [];
    const recoveredNodes = new Set();
    const updatedTemplateIds = new Set();

    let resolvedCount = 0;
    let unresolvedCount = 0;
    let unresolvedCriticalCount = 0;
    let facultySubstitutions = 0;
    let classroomChanges = 0;
    let labReallocations = 0;
    let rescheduledActivities = 0;
    let timetableChanges = 0;
    let scheduleChanges = 0;
    let batchSplitCount = 0;
    let examRescheduleCount = 0;
    let overloadSurchargeHrs = 0;
    let backupResourceUnits = 0;
    const stillImpactedSections = new Set();

    const costBreakdown = {
      facultySubstitution: { count: 0, points: 0 },
      classroomRelocation: { count: 0, points: 0 },
      labRelocation: { count: 0, points: 0 },
      timeSlotChanges: { count: 0, points: 0 },
      workloadSurcharge: { count: 0, points: 0 },
      transportReallocation: { count: 0, points: 0 },
      examReschedule: { count: 0, points: 0 },
      backupAndSplit: { count: 0, points: 0 },
      preemption: { count: 0, points: 0 },
      unresolvedPenalty: { count: 0, points: 0 },
      totalRelativeScore: 0
    };

    sortedImpacted.forEach((occ) => {
      const act = { ...occ.activity, origDateRef: occ.occurrenceDate };
      const origDate = occ.occurrenceDate;
      const sec = sectionMap.get(act.sectionId);
      const origRoom = roomMap.get(act.roomId);
      const origFac = facultyMap.get(act.facultyId);
      const candidateSlots = getCandidateOccurrenceSlots(origDate, act.slotId, act);

      let bestSolution = null;
      let bestScore = Infinity;

      // Evaluate valid candidates across eligible slots according to strategy objective
      for (const ts of candidateSlots) {
        ensureDateSeeded(ts.date);
        const weekMon = getWeekMondayISO(ts.date);
        ensureWeekSeeded(weekMon);

        // Strategy A stays strictly in-slot on first scan; if in-slot fails, evaluates time-shift loop cleanly
        if (strat.mode === 'minChange' && !ts.isOriginal && bestSolution !== null) {
          break;
        }

        const occSlotKey = `${ts.date}|${ts.slotId}`;
        if (act.adminId && blockedAdminOcc.has(act.adminId) && blockedAdminOcc.get(act.adminId).has(occSlotKey)) {
          continue;
        }
        if (busySectionOcc.has(`${act.sectionId}|${occSlotKey}`)) continue;

        const validFacs = recoveredState.faculty.filter((f) => isFacultyAvailable(f, act, ts.date, ts.slotId, weekMon));
        if (validFacs.length === 0) continue;

        const validRooms = allRoomsPool.filter((r) => isRoomAvailable(r, act, sec.studentCount, ts.date, ts.slotId));
        if (validRooms.length === 0) continue;

        for (const fac of validFacs) {
          for (const room of validRooms) {
            const sc = computeCandidateObjective(ts, fac, room, act, origRoom, sec, weekMon);
            if (sc < bestScore) {
              bestScore = sc;
              bestSolution = {
                date: ts.date,
                day: ts.day,
                slotId: ts.slotId,
                weekMon,
                isTimeChanged: !ts.isOriginal,
                faculty: fac,
                room,
                mode: 'standard',
                isSplit: false,
                splitSummary: '',
                splitExtraFac: null,
                splitRoom2: null,
                preemptedVictim: null,
                swapRelocation: null
              };
            }
          }
        }
      }

      // Secondary Advanced Solvers (when single full-room standard placement was unavailable):
      // 1) Capacity-Based Batch Splitting (Partial Lab Equipment or Partial Exam Hall Candidate Redistribution)
      if (!bestSolution && (act.activityType === 'LAB' || act.activityType === 'EXAM')) {
        const origKey = `${origDate}|${act.slotId}`;
        ensureDateSeeded(origDate);
        const weekMonOrig = getWeekMondayISO(origDate);
        ensureWeekSeeded(weekMonOrig);

        if (act.activityType === 'EXAM' && !busySectionOcc.has(`${act.sectionId}|${origKey}`) && !(act.adminId && blockedAdminOcc.get(act.adminId)?.has(origKey))) {
          // Dual-Hall Candidate Redistribution in same original exam slot
          const halfMin = Math.ceil(sec.studentCount * 0.4);
          const partialHalls = allRoomsPool
            .filter((r) => !busyRoomOcc.has(`${r.id}|${origKey}`) && isRoomTypeCompatible(r, act))
            .map((r) => ({ room: r, effCap: getEffectiveRoomCapacity(r, origDate, act.slotId, act.id) }))
            .filter((x) => x.effCap >= Math.min(25, halfMin) && x.effCap < sec.studentCount)
            .sort((a, b) => b.effCap - a.effCap);

          if (partialHalls.length >= 1) {
            const r1 = partialHalls[0];
            const remainingStudents = sec.studentCount - r1.effCap;
            const secondHalls = allRoomsPool
              .filter((r) => r.id !== r1.room.id && !busyRoomOcc.has(`${r.id}|${origKey}`) && isRoomTypeCompatible(r, act))
              .map((r) => ({ room: r, effCap: getEffectiveRoomCapacity(r, origDate, act.slotId, act.id) }))
              .filter((x) => x.effCap >= remainingStudents)
              .sort((a, b) => a.effCap - b.effCap);

            const availFacs = recoveredState.faculty
              .filter((f) => isFacultyAvailable(f, act, origDate, act.slotId, weekMonOrig))
              .sort((a, b) => (a.id === act.facultyId ? -1 : b.id === act.facultyId ? 1 : (facultyWeekLoad.get(`${a.id}|${weekMonOrig}`) || 0) - (facultyWeekLoad.get(`${b.id}|${weekMonOrig}`) || 0)));

            if (secondHalls.length > 0 && availFacs.length >= 2) {
              const r2 = secondHalls[0];
              bestSolution = {
                date: origDate,
                day: act.day,
                slotId: act.slotId,
                weekMon: weekMonOrig,
                isTimeChanged: false,
                faculty: availFacs[0],
                room: r1.room,
                mode: 'exam-split',
                isSplit: true,
                splitRoom2: r2.room,
                splitExtraFac: availFacs[1],
                splitBatch1: r1.effCap,
                splitBatch2: remainingStudents,
                splitSummary: `Split ${sec.studentCount} candidates across ${r1.room.id} (${r1.effCap} seats) + ${r2.room.id} (${remainingStudents} seats, Invig: ${availFacs[1].id})`,
                preemptedVictim: null,
                swapRelocation: null
              };
            }
          }
        } else if (act.activityType === 'LAB' && strat.mode !== 'minChange') {
          // Lab Capacity-Based Half-Batch Splitting across two free compatible slots
          const batchSize = Math.ceil(sec.studentCount / 2);
          const slot1 = candidateSlots[0];
          const s1Key = `${slot1.date}|${slot1.slotId}`;
          const validFac1 = recoveredState.faculty.filter((f) => isFacultyAvailable(f, act, slot1.date, slot1.slotId, weekMonOrig));
          const halfLabs = allRoomsPool
            .filter((r) => r.labType === act.labType && !busyRoomOcc.has(`${r.id}|${s1Key}`) && getEffectiveRoomCapacity(r, slot1.date, slot1.slotId, act.id) >= batchSize);

          if (!busySectionOcc.has(`${act.sectionId}|${s1Key}`) && validFac1.length > 0 && halfLabs.length > 0) {
            const chosenLab = halfLabs[0];
            const chosenFac = validFac1.find((f) => f.id === act.facultyId) || validFac1[0];
            // Find second slot on same/next day for Batch B
            const batch2Slot = candidateSlots.find((ts) => {
              if (ts.date === slot1.date && ts.slotId === slot1.slotId) return false;
              ensureDateSeeded(ts.date);
              const w2 = getWeekMondayISO(ts.date);
              ensureWeekSeeded(w2);
              const k2 = `${ts.date}|${ts.slotId}`;
              return !busySectionOcc.has(`${act.sectionId}|${k2}`) &&
                !busyRoomOcc.has(`${chosenLab.id}|${k2}`) &&
                getEffectiveRoomCapacity(chosenLab, ts.date, ts.slotId, act.id) >= (sec.studentCount - batchSize) &&
                isFacultyAvailable(chosenFac, act, ts.date, ts.slotId, w2);
            });
            if (batch2Slot) {
              bestSolution = {
                date: slot1.date,
                day: slot1.day,
                slotId: slot1.slotId,
                weekMon: weekMonOrig,
                isTimeChanged: false,
                faculty: chosenFac,
                room: chosenLab,
                mode: 'lab-batch-split',
                isSplit: true,
                splitRoom2: chosenLab,
                splitBatch2Slot: batch2Slot,
                splitBatch1: batchSize,
                splitBatch2: sec.studentCount - batchSize,
                splitSummary: `Batch A (${batchSize} students) in ${slot1.day} ${slot1.slotId} + Batch B (${sec.studentCount - batchSize} students) in ${batch2Slot.day} ${batch2Slot.slotId} inside ${chosenLab.id}`,
                preemptedVictim: null,
                swapRelocation: null
              };
            }
          }
        }
      }

      // 2) Valid In-Slot Classroom Swap OR Strategy C Low-Priority Preemption
      if (!bestSolution) {
        const allowPreemption = strat.mode === 'priorityShield' && act.priority >= 60;
        const allowInSlotSwap = act.activityType === 'LECTURE' || act.activityType === 'EXAM' || act.activityType === 'PLACEMENT';
        if (allowInSlotSwap || allowPreemption) {
          for (const ts of candidateSlots.slice(0, strat.mode === 'minChange' ? 1 : 6)) {
            ensureDateSeeded(ts.date);
            const weekMon = getWeekMondayISO(ts.date);
            ensureWeekSeeded(weekMon);
            const k = `${ts.date}|${ts.slotId}`;
            if (busySectionOcc.has(`${act.sectionId}|${k}`)) continue;
            if (act.adminId && blockedAdminOcc.has(act.adminId) && blockedAdminOcc.get(act.adminId).has(k)) continue;
            const availFacs = recoveredState.faculty.filter((f) => isFacultyAvailable(f, act, ts.date, ts.slotId, weekMon));
            if (availFacs.length === 0) continue;

            // Find an active unaffected activity on this exact date & slot whose room suits our impacted activity
            const dayActs = getActivitiesOnDate(recoveredState, ts.date);
            for (const victim of dayActs) {
              if (victim.id === act.id || impactedOccKeySet.has(`${victim.id}@${ts.date}`)) continue;
              const vRoom = roomMap.get(victim.roomId);
              if (!vRoom || !isRoomTypeCompatible(vRoom, act)) continue;
              const vEffCap = getEffectiveRoomCapacity(vRoom, ts.date, ts.slotId, act.id);
              if (vEffCap < sec.studentCount) continue;

              const canSwapInSlot = victim.studentCount < sec.studentCount && ts.isOriginal;
              const canPreemptVictim = allowPreemption && victim.priority < act.priority;
              if (!canSwapInSlot && !canPreemptVictim) continue;

              const reloc = findRelocationForVictim(victim, ts.date, ts.slotId, canSwapInSlot && !canPreemptVictim, vRoom.id);
              if (reloc) {
                bestSolution = {
                  date: ts.date,
                  day: ts.day,
                  slotId: ts.slotId,
                  weekMon,
                  isTimeChanged: !ts.isOriginal,
                  faculty: availFacs[0],
                  room: vRoom,
                  mode: canSwapInSlot && reloc.isSameSlot ? 'classroom-swap' : 'preemption',
                  isSplit: false,
                  splitSummary: '',
                  preemptedVictim: victim,
                  swapRelocation: reloc
                };
                break;
              }
            }
            if (bestSolution) break;
          }
        }
      }

      if (bestSolution) {
        const facChanged = bestSolution.faculty.id !== act.facultyId;
        const roomChanged = bestSolution.room.id !== act.roomId;
        const timeChanged = bestSolution.isTimeChanged;
        const occSlotKey = `${bestSolution.date}|${bestSolution.slotId}`;

        // Commit swap / preemption victim relocation first so occupancy stays exact
        if (bestSolution.preemptedVictim && bestSolution.swapRelocation) {
          const v = bestSolution.preemptedVictim;
          const rel = bestSolution.swapRelocation;
          const oldKey = `${bestSolution.date}|${v.slotId}`;
          const newKey = `${rel.date}|${rel.slotId}`;
          busyRoomOcc.delete(`${v.roomId}|${oldKey}`);
          if (!rel.isSameSlot) {
            busySectionOcc.delete(`${v.sectionId}|${oldKey}`);
            busyFacultyOcc.delete(`${v.facultyId}|${oldKey}`);
            busySectionOcc.add(`${v.sectionId}|${newKey}`);
            busyFacultyOcc.add(`${v.facultyId}|${newKey}`);
          }
          busyRoomOcc.add(`${rel.room.id}|${newKey}`);

          // Apply victim relocation to weekly template safely
          if (!updatedTemplateIds.has(v.id)) {
            updatedTemplateIds.add(v.id);
            const vFacObj = facultyMap.get(v.facultyId);
            if (vFacObj) {
              applyTemplateUpdateIfEligible(v, {
                faculty: vFacObj,
                room: rel.room,
                day: rel.day,
                slotId: rel.slotId,
                date: rel.date
              });
            }
          }

          recoveredNodes.add(v.id);
          preemptions.push({
            occKey: `${v.id}@${bestSolution.date}`,
            activityId: v.id,
            title: v.title,
            activityType: v.activityType,
            priority: v.priority,
            sectionId: v.sectionId,
            origDate: bestSolution.date,
            origDay: v.day,
            origSlotId: v.slotId,
            origRoomId: v.roomId,
            newDate: rel.date,
            newDay: rel.day,
            newSlotId: rel.slotId,
            newRoomId: rel.room.id,
            forActivityId: act.id,
            isSameSlotSwap: rel.isSameSlot
          });
          costBreakdown.preemption.count += 1;
          costBreakdown.preemption.points += RECOVERY_COST_WEIGHTS.lowPriorityPreemption;
          scheduleChanges += 1;
        }

        // Commit primary activity occupancy
        busyFacultyOcc.add(`${bestSolution.faculty.id}|${occSlotKey}`);
        busySectionOcc.add(`${act.sectionId}|${occSlotKey}`);
        busyRoomOcc.add(`${bestSolution.room.id}|${occSlotKey}`);
        const wKey = `${bestSolution.faculty.id}|${bestSolution.weekMon}`;
        facultyWeekLoad.set(wKey, (facultyWeekLoad.get(wKey) || 0) + 1);
        const dKey = `${bestSolution.faculty.id}|${bestSolution.date}`;
        facultyDayLoad.set(dKey, (facultyDayLoad.get(dKey) || 0) + 1);
        roomWeekUsage.set(bestSolution.room.id, (roomWeekUsage.get(bestSolution.room.id) || 0) + 1);
        if (facChanged) {
          substituteUseCount.set(bestSolution.faculty.id, (substituteUseCount.get(bestSolution.faculty.id) || 0) + 1);
        }

        // Commit secondary split resources (extra exam hall/invigilator or batch 2 lab slot)
        if (bestSolution.mode === 'exam-split' && bestSolution.splitRoom2 && bestSolution.splitExtraFac) {
          busyRoomOcc.add(`${bestSolution.splitRoom2.id}|${occSlotKey}`);
          busyFacultyOcc.add(`${bestSolution.splitExtraFac.id}|${occSlotKey}`);
          const w2Key = `${bestSolution.splitExtraFac.id}|${bestSolution.weekMon}`;
          facultyWeekLoad.set(w2Key, (facultyWeekLoad.get(w2Key) || 0) + 1);
        } else if (bestSolution.mode === 'lab-batch-split' && bestSolution.splitBatch2Slot) {
          const b2Key = `${bestSolution.splitBatch2Slot.date}|${bestSolution.splitBatch2Slot.slotId}`;
          busySectionOcc.add(`${act.sectionId}|${b2Key}`);
          busyFacultyOcc.add(`${bestSolution.faculty.id}|${b2Key}`);
          busyRoomOcc.add(`${bestSolution.room.id}|${b2Key}`);
          const w2 = getWeekMondayISO(bestSolution.splitBatch2Slot.date);
          facultyWeekLoad.set(`${bestSolution.faculty.id}|${w2}`, (facultyWeekLoad.get(`${bestSolution.faculty.id}|${w2}`) || 0) + 1);
        }

        // Apply to weekly display template once per unique activity ID without creating template conflicts
        if (!updatedTemplateIds.has(act.id)) {
          updatedTemplateIds.add(act.id);
          applyTemplateUpdateIfEligible(act, {
            ...bestSolution,
            splitInfo: bestSolution.splitSummary
          });
        }

        // Track detailed counts & exact itemized cost breakdown
        const attrChanges = (facChanged ? 1 : 0) + (roomChanged ? 1 : 0) + (timeChanged ? 1 : 0) + (bestSolution.isSplit ? 1 : 0);
        scheduleChanges += Math.max(1, attrChanges);
        timetableChanges += 1;

        let actCost = 0;
        if (facChanged) {
          facultySubstitutions += 1;
          costBreakdown.facultySubstitution.count += 1;
          costBreakdown.facultySubstitution.points += RECOVERY_COST_WEIGHTS.facultySubstitution;
          actCost += RECOVERY_COST_WEIGHTS.facultySubstitution;
        }
        if (roomChanged) {
          if (act.activityType === 'LAB') {
            labReallocations += 1;
            costBreakdown.labRelocation.count += 1;
            costBreakdown.labRelocation.points += RECOVERY_COST_WEIGHTS.labRelocation;
            actCost += RECOVERY_COST_WEIGHTS.labRelocation;
          } else {
            classroomChanges += 1;
            costBreakdown.classroomRelocation.count += 1;
            costBreakdown.classroomRelocation.points += RECOVERY_COST_WEIGHTS.classroomRelocation;
            actCost += RECOVERY_COST_WEIGHTS.classroomRelocation;
          }
        } else if (bestSolution.mode === 'lab-batch-split') {
          labReallocations += 1;
        }
        if (timeChanged) {
          rescheduledActivities += 1;
          costBreakdown.timeSlotChanges.count += 1;
          costBreakdown.timeSlotChanges.points += RECOVERY_COST_WEIGHTS.timeSlotShift;
          actCost += RECOVERY_COST_WEIGHTS.timeSlotShift;
          if (act.activityType === 'EXAM') {
            examRescheduleCount += 1;
            costBreakdown.examReschedule.count += 1;
            costBreakdown.examReschedule.points += RECOVERY_COST_WEIGHTS.examReschedulePenalty;
            actCost += RECOVERY_COST_WEIGHTS.examReschedulePenalty;
          }
        }
        if (bestSolution.isSplit) {
          batchSplitCount += 1;
          costBreakdown.backupAndSplit.count += 1;
          costBreakdown.backupAndSplit.points += RECOVERY_COST_WEIGHTS.batchSplitPenalty;
          actCost += RECOVERY_COST_WEIGHTS.batchSplitPenalty;
        }
        // Workload surcharge if assigned faculty exceeds 65% weekly load OR >= 3 sessions on same date
        const assignedWeekLoad = facultyWeekLoad.get(wKey) || 0;
        const assignedDayLoad = facultyDayLoad.get(dKey) || 0;
        if (assignedWeekLoad > Math.floor(bestSolution.faculty.maxWeeklyLoad * 0.65) || assignedDayLoad >= 3) {
          overloadSurchargeHrs += 1;
          costBreakdown.workloadSurcharge.count += 1;
          costBreakdown.workloadSurcharge.points += RECOVERY_COST_WEIGHTS.extraFacultyLoadSurcharge;
          actCost += RECOVERY_COST_WEIGHTS.extraFacultyLoadSurcharge;
        }
        // Reserve/Backup infrastructure credit charge when Priority Shield places into UPS/reserve pool
        if (strat.mode === 'priorityShield' && (bestSolution.room.name.includes('UPS') || (facChanged && !bestSolution.faculty.busId && (act.activityType === 'EXAM' || act.activityType === 'PLACEMENT')))) {
          backupResourceUnits += 1;
          costBreakdown.backupAndSplit.count += 1;
          costBreakdown.backupAndSplit.points += Math.round(RECOVERY_COST_WEIGHTS.backupResourceUsage * 0.5);
          actCost += Math.round(RECOVERY_COST_WEIGHTS.backupResourceUsage * 0.5);
        }

        resolvedCount += 1;
        recoveredNodes.add(act.id);

        const newSlotObj = SLOTS.find((s) => s.id === bestSolution.slotId);
        const origSlotObj = SLOTS.find((s) => s.id === act.slotId);
        const newTimeText = newSlotObj ? `${formatTime12h(newSlotObj.startTime)}–${formatTime12h(newSlotObj.endTime)}` : bestSolution.slotId;
        const origTimeText = origSlotObj ? `${formatTime12h(origSlotObj.startTime)}–${formatTime12h(origSlotObj.endTime)}` : act.slotId;
        const effCap = getEffectiveRoomCapacity(bestSolution.room, bestSolution.date, bestSolution.slotId, act.id);

        const constraintsSatisfied = [];
        if (act.subjectId) constraintsSatisfied.push(`Qualified (${act.subjectId})`);
        else constraintsSatisfied.push(`Dept Match (${bestSolution.faculty.department})`);
        constraintsSatisfied.push(`Workload ${assignedWeekLoad}/${bestSolution.faculty.maxWeeklyLoad} hrs`);
        constraintsSatisfied.push(
          bestSolution.isSplit
            ? `Split Cap >= ${sec.studentCount} seats`
            : `Capacity ${effCap} >= ${sec.studentCount} seats`
        );
        if (act.activityType === 'LAB') constraintsSatisfied.push(`Lab Type (${bestSolution.room.labType})`);
        constraintsSatisfied.push('Zero Double-Booking');
        constraintsSatisfied.push(timeChanged ? 'Section Free Slot Verified' : 'Original Slot Preserved');

        const reasonParts = [`Date: ${formatDateDMY(bestSolution.date)} (${bestSolution.day}, ${newTimeText}).`];
        if (facChanged) {
          reasonParts.push(
            `Substituted ${origFac ? origFac.name : act.facultyId} with ${bestSolution.faculty.name} (${bestSolution.faculty.id}, Load: ${assignedWeekLoad}/${bestSolution.faculty.maxWeeklyLoad} hrs).`
          );
        } else {
          reasonParts.push(`Preserved assigned instructor ${bestSolution.faculty.name} (${bestSolution.faculty.id}).`);
        }
        if (roomChanged) {
          reasonParts.push(
            `Relocated from ${act.roomId} to ${bestSolution.room.id} (${bestSolution.room.name}, ${bestSolution.room.block}, ${effCap} seats).`
          );
        }
        if (bestSolution.isSplit) {
          reasonParts.push(`${bestSolution.splitSummary}.`);
        }
        if (bestSolution.preemptedVictim && bestSolution.swapRelocation) {
          reasonParts.push(
            bestSolution.swapRelocation.isSameSlot
              ? `In-slot room swap freed ${bestSolution.room.id} by shifting smaller activity ${bestSolution.preemptedVictim.id} to ${bestSolution.swapRelocation.room.id}.`
              : `Priority shield moved lower-priority ${bestSolution.preemptedVictim.id} to ${bestSolution.swapRelocation.day} ${bestSolution.swapRelocation.slotId} (${bestSolution.swapRelocation.room.id}).`
          );
        }
        if (timeChanged) {
          reasonParts.push(
            `Rescheduled from ${formatDateDMY(origDate)} (${act.day} ${origTimeText}) to ${formatDateDMY(bestSolution.date)} (${bestSolution.day} ${newTimeText}) cleanly.`
          );
        } else if (!bestSolution.isSplit) {
          reasonParts.push(`Original timing (${origTimeText}) preserved with zero student timetable shift.`);
        }

        actions.push({
          occKey: occ.occKey,
          activityId: act.id,
          activityType: act.activityType,
          priority: act.priority,
          title: act.title,
          sectionId: act.sectionId,
          studentCount: act.studentCount,
          occurrenceDate: origDate,
          occurrenceDateDMY: formatDateDMY(origDate),
          origDay: act.day,
          origSlotId: act.slotId,
          origTimeText,
          origFacultyId: act.facultyId,
          origFacultyName: origFac ? origFac.name : act.facultyId,
          origRoomId: act.roomId,
          origRoomName: origRoom ? origRoom.name : act.roomId,
          newDate: bestSolution.date,
          newDateDMY: formatDateDMY(bestSolution.date),
          newDay: bestSolution.day,
          newSlotId: bestSolution.slotId,
          newTimeText,
          newFacultyId: bestSolution.faculty.id,
          newFacultyName: bestSolution.faculty.name,
          newRoomId: bestSolution.room.id,
          newRoomName: bestSolution.room.name,
          facChanged,
          roomChanged,
          timeChanged,
          isSplit: bestSolution.isSplit,
          splitSummary: bestSolution.splitSummary || '',
          preemptedFrom: bestSolution.preemptedVictim ? bestSolution.preemptedVictim.id : '',
          constraintsSatisfied,
          cost: actCost,
          resolved: true,
          explanation: reasonParts.join(' ')
        });
      } else {
        unresolvedCount += 1;
        const isCritical = act.activityType === 'EXAM' || act.activityType === 'PLACEMENT';
        if (isCritical) unresolvedCriticalCount += 1;
        stillImpactedSections.add(act.sectionId);

        const penalty = isCritical
          ? RECOVERY_COST_WEIGHTS.unresolvedCriticalPenalty
          : RECOVERY_COST_WEIGHTS.unresolvedStandardPenalty;
        costBreakdown.unresolvedPenalty.count += 1;
        costBreakdown.unresolvedPenalty.points += penalty;

        const origSlotObj = SLOTS.find((s) => s.id === act.slotId);
        const origTimeText = origSlotObj ? `${formatTime12h(origSlotObj.startTime)}–${formatTime12h(origSlotObj.endTime)}` : act.slotId;
        const reason = `No feasible operational ${act.activityType === 'LAB' ? `${act.labType} lab` : 'room/hall'} (>= ${sec.studentCount} usable seats) and qualified free faculty exist without violating hard constraints across ${act.sectionId}'s available slots.`;

        actions.push({
          occKey: occ.occKey,
          activityId: act.id,
          activityType: act.activityType,
          priority: act.priority,
          title: act.title,
          sectionId: act.sectionId,
          studentCount: act.studentCount,
          occurrenceDate: origDate,
          occurrenceDateDMY: formatDateDMY(origDate),
          origDay: act.day,
          origSlotId: act.slotId,
          origTimeText,
          origFacultyId: act.facultyId,
          origFacultyName: origFac ? origFac.name : act.facultyId,
          origRoomId: act.roomId,
          origRoomName: origRoom ? origRoom.name : act.roomId,
          newDate: origDate,
          newDateDMY: formatDateDMY(origDate),
          newDay: act.day,
          newSlotId: act.slotId,
          newTimeText: origTimeText,
          newFacultyId: act.facultyId,
          newFacultyName: origFac ? origFac.name : act.facultyId,
          newRoomId: act.roomId,
          newRoomName: origRoom ? origRoom.name : act.roomId,
          facChanged: false,
          roomChanged: false,
          timeChanged: false,
          isSplit: false,
          splitSummary: '',
          preemptedFrom: '',
          constraintsSatisfied: [],
          cost: penalty,
          resolved: false,
          explanation: reason
        });
      }
    });

    // Strategy-differentiated Transit Rerouting (deduplicated per bus ID)
    const transitActions = [];
    let unreroutedTransitStudents = 0;
    const busSpareCapacity = new Map();
    recoveredState.buses.forEach((b) => {
      if (nodeStatus.get(b.id) === 'operational') {
        busSpareCapacity.set(b.id, Math.max(0, b.capacity - b.studentLoad));
      }
    });

    let sparePoolRemaining = busBreakdowns.some((bb) => bb.spareBusAvailable) ? 75 : 0;
    const handledBuses = new Set();

    busBreakdowns.forEach((bb) => {
      if (handledBuses.has(bb.busId)) return;
      handledBuses.add(bb.busId);
      const b = recoveredState.buses.find((x) => x.id === bb.busId);
      if (!b) return;
      let remainingLoad = b.studentLoad;
      const assignedAlternatives = [];
      let transitCostForBus = 0;

      if (bb.spareBusAvailable && sparePoolRemaining > 0 && remainingLoad > 0) {
        const take = Math.min(remainingLoad, sparePoolRemaining);
        sparePoolRemaining -= take;
        remainingLoad -= take;
        assignedAlternatives.push(`SPARE-BUS (${take} students)`);
        costBreakdown.transportReallocation.count += 1;
        transitCostForBus += RECOVERY_COST_WEIGHTS.spareBusDispatch;
      }

      if (strat.transitMode === 'greedy-minimal') {
        // Pack onto fewest highest-spare buses to minimize altered routes
        const sortedBuses = Array.from(busSpareCapacity.entries()).sort((a, b2) => b2[1] - a[1]);
        for (const [altId, spare] of sortedBuses) {
          if (remainingLoad <= 0) break;
          if (spare <= 0) continue;
          const take = Math.min(remainingLoad, spare);
          busSpareCapacity.set(altId, spare - take);
          remainingLoad -= take;
          assignedAlternatives.push(`${altId} (+${take})`);
          costBreakdown.transportReallocation.count += 1;
          transitCostForBus += RECOVERY_COST_WEIGHTS.transportReallocation;
        }
      } else if (strat.transitMode === 'proportional-balanced') {
        // Balance evenly across operational fleet in ~10-student slices so max bus utilization stays low
        const activeIds = Array.from(busSpareCapacity.keys());
        const perBusAssigned = new Map();
        while (remainingLoad > 0) {
          let progressed = false;
          // Pick bus with highest current spare
          activeIds.sort((idA, idB) => (busSpareCapacity.get(idB) || 0) - (busSpareCapacity.get(idA) || 0));
          const pickId = activeIds[0];
          const avail = busSpareCapacity.get(pickId) || 0;
          if (avail <= 0) break;
          const chunk = Math.min(remainingLoad, avail, Math.max(8, Math.ceil(b.studentLoad / 3)));
          busSpareCapacity.set(pickId, avail - chunk);
          perBusAssigned.set(pickId, (perBusAssigned.get(pickId) || 0) + chunk);
          remainingLoad -= chunk;
          progressed = true;
          if (!progressed) break;
        }
        perBusAssigned.forEach((cnt, altId) => {
          assignedAlternatives.push(`${altId} (+${cnt} balanced)`);
          costBreakdown.transportReallocation.count += 1;
          transitCostForBus += Math.round(RECOVERY_COST_WEIGHTS.transportReallocation * 0.85);
        });
      } else {
        // priority-reserve-shuttle: prioritize senior/exam-linked bus coverage via lowest-load buses first without stranding commuters
        const sortedLightest = Array.from(busSpareCapacity.entries()).sort((a, b2) => b2[1] - a[1]);
        for (const [altId, spare] of sortedLightest) {
          if (remainingLoad <= 0) break;
          if (spare <= 0) continue;
          const take = Math.min(remainingLoad, spare);
          busSpareCapacity.set(altId, spare - take);
          remainingLoad -= take;
          assignedAlternatives.push(`${altId} (Priority Feeder +${take})`);
          costBreakdown.transportReallocation.count += 1;
          transitCostForBus += RECOVERY_COST_WEIGHTS.transportReallocation;
        }
      }

      if (assignedAlternatives.length > 0) {
        costBreakdown.transportReallocation.points += transitCostForBus;
        recoveredNodes.add(b.id);
        transitActions.push({
          busId: b.id,
          reroutedTo: assignedAlternatives.join(', '),
          reroutedStudents: b.studentLoad - remainingLoad,
          remainingUnassigned: remainingLoad,
          explanation: `Rerouted ${b.studentLoad - remainingLoad} commuters from ${b.id} (${bb.breakdownType}) using ${strat.transitMode}: ${assignedAlternatives.join(', ')}.`
        });
      }
      unreroutedTransitStudents += remainingLoad;
    });

    // Total relative recovery cost strictly equals sum of itemized breakdown
    const recoveryCost =
      costBreakdown.facultySubstitution.points +
      costBreakdown.classroomRelocation.points +
      costBreakdown.labRelocation.points +
      costBreakdown.timeSlotChanges.points +
      costBreakdown.workloadSurcharge.points +
      costBreakdown.transportReallocation.points +
      costBreakdown.examReschedule.points +
      costBreakdown.backupAndSplit.points +
      costBreakdown.preemption.points +
      costBreakdown.unresolvedPenalty.points;
    costBreakdown.totalRelativeScore = recoveryCost;

    // Deduplicated unique remaining affected students
    const afterSectionMap = new Map();
    stillImpactedSections.forEach((secId) => {
      const sec = sectionMap.get(secId);
      if (sec) afterSectionMap.set(secId, sec.studentCount);
    });
    recoveredState.hostels.forEach((h) => {
      if (blockedHostelNodes.has(h.id)) {
        h.linkedSections.forEach((secId) => {
          const sec = sectionMap.get(secId);
          if (sec) {
            afterSectionMap.set(secId, Math.min(sec.studentCount, Math.max(afterSectionMap.get(secId) || 0, sec.hostelResidents)));
          }
        });
      }
    });

    let affectedStudentsAfter = unreroutedTransitStudents;
    afterSectionMap.forEach((cnt) => { affectedStudentsAfter += cnt; });
    affectedStudentsAfter = Math.min(recoveredState.meta.totalStudents, affectedStudentsAfter);

    const totalImpacted = impactedOccurrences.length;
    let recoveryPct = totalImpacted === 0
      ? (unreroutedTransitStudents === 0 ? 100 : 0)
      : Math.round((resolvedCount / totalImpacted) * 1000) / 10;
    if (unresolvedCount > 0 && recoveryPct >= 100) {
      recoveryPct = 99.9; // Never report 100% when unresolved impacted activities remain
    }

    // Faculty workload distribution statistics computed directly from final recoveredState
    const finalFacLoad = new Map();
    recoveredState.faculty.forEach((f) => finalFacLoad.set(f.id, 0));
    getAllActivities(recoveredState).forEach((a) => {
      finalFacLoad.set(a.facultyId, (finalFacLoad.get(a.facultyId) || 0) + 1);
    });
    const utilList = recoveredState.faculty.map((f) => ((finalFacLoad.get(f.id) || 0) / Math.max(1, f.maxWeeklyLoad)) * 100);
    const meanUtil = utilList.reduce((a, b) => a + b, 0) / utilList.length;
    const variance = utilList.reduce((acc, v) => acc + Math.pow(v - meanUtil, 2), 0) / utilList.length;
    const loadStdDev = Math.round(Math.sqrt(variance) * 10) / 10;
    const peakUtilizationPct = Math.round(Math.max(...utilList) * 10) / 10;
    const peakLoad = Math.max(...Array.from(finalFacLoad.values()));
    let maxDailyLoad = 0;
    facultyDayLoad.forEach((cnt) => { if (cnt > maxDailyLoad) maxDailyLoad = cnt; });
    const distinctSubstitutesUsed = substituteUseCount.size;

    const workloadMetrics = {
      peakLoad,
      peakUtilizationPct,
      loadStdDev,
      maxDailyLoad,
      distinctSubstitutesUsed,
      overloadSurchargeHrs,
      summaryLabel: `${distinctSubstitutesUsed} sub(s) • Peak ${peakUtilizationPct}% • σ ${loadStdDev}%`
    };

    const criticalTotal = impactedOccurrences.filter((o) => o.activity.activityType === 'EXAM' || o.activity.activityType === 'PLACEMENT').length;
    const criticalRecovered = actions.filter((a) => a.resolved && (a.activityType === 'EXAM' || a.activityType === 'PLACEMENT')).length;

    // Validate full recovered state against hard schedule rules
    const validation = validateSchedule(recoveredState);

    // Recalculate true Post-Recovery Campus Health from actual remaining offline hardware + remaining unresolved impacts
    const beforeHealth = cascadeResult.metrics.campusHealthPct;
    const totalResWeight = 50 + 25 + 10 + 8 + 5;
    const downFacRemain = recoveredState.faculty.filter((f) => nodeStatus.get(f.id) !== 'operational').length;
    const downCrRemain = recoveredState.classrooms.filter((c) => nodeStatus.get(c.id) !== 'operational' && !recoveredNodes.has(c.id)).length +
      recoveredState.classrooms.filter((c) => nodeStatus.get(c.id) !== 'operational' && recoveredNodes.has(c.id)).length * 0.35;
    const downLabRemain = recoveredState.labs.filter((l) => nodeStatus.get(l.id) !== 'operational').length * 0.35;
    const downBusRemain = recoveredState.buses.filter((b) => nodeStatus.get(b.id) !== 'operational' && !recoveredNodes.has(b.id)).length +
      recoveredState.buses.filter((b) => nodeStatus.get(b.id) !== 'operational' && recoveredNodes.has(b.id)).length * 0.25;
    const downAdminRemain = recoveredState.admin.filter((a) => nodeStatus.get(a.id) !== 'operational').length * 1.5;

    const remainingDownRes =
      downFacRemain * 0.45 +
      downCrRemain * 0.65 +
      downLabRemain * 0.9 +
      downBusRemain * 0.65 +
      downAdminRemain;

    const remainingActPenalty = actions.reduce((acc, a) => {
      if (!a.resolved) {
        return acc + (a.activityType === 'EXAM' ? 4.0 : a.activityType === 'PLACEMENT' ? 2.8 : 1.0);
      }
      // Small operational friction when time had to shift or batch split
      return acc + (a.timeChanged ? 0.12 : 0.04);
    }, 0);

    const rawAfterHealth = 100 - (
      (remainingDownRes / totalResWeight) * 42 +
      (remainingActPenalty / Math.max(1, cascadeResult.graph.activities.length)) * 85
    );
    const healthAfter = Math.max(beforeHealth, Math.min(100, Math.round(rawAfterHealth * 10) / 10));

    const offlineAssets = cascadeResult.failedIds.filter((id) => nodeStatus.get(id) === 'failed');
    const healthExplanation = healthAfter < 100
      ? (unresolvedCount === 0
        ? `100% of impacted scheduled activities were recovered, but Campus Health remains ${healthAfter}% because failed physical resource(s) (${offlineAssets.slice(0, 4).join(', ')}${offlineAssets.length > 4 ? ', ...' : ''}) stay offline until repaired/restored.`
        : `Campus Health is ${healthAfter}% due to ${unresolvedCount} unresolved activity conflict(s) and ${offlineAssets.length} offline resource(s) (${offlineAssets.slice(0, 3).join(', ')}).`)
      : 'All impacted activities and operational pathways are 100% healthy.';

    // Strategy-specific Advantages & Trade-offs computed strictly from actual results
    const advantages = [];
    const tradeOffs = [];
    if (rescheduledActivities === 0 && resolvedCount > 0) advantages.push('Preserves 100% of original student dates & time slots');
    else if (rescheduledActivities > 0) advantages.push(`Smartly shifts ${rescheduledActivities} slot(s) to preserve continuity`);
    if (criticalTotal > 0 && criticalRecovered === criticalTotal) advantages.push(`Protects 100% of critical Exams & Placements (${criticalRecovered}/${criticalTotal})`);
    if (distinctSubstitutesUsed >= 2) advantages.push(`Distributes substitution load across ${distinctSubstitutesUsed} qualified faculty (σ ${loadStdDev}%)`);
    if (batchSplitCount > 0) advantages.push(`Resolves partial capacity shortage via ${batchSplitCount} capacity split(s)`);
    if (preemptions.length > 0) advantages.push(`Shields high-priority sessions by deferring ${preemptions.length} lower-priority item(s)`);
    if (advantages.length === 0) advantages.push(`Recovers ${resolvedCount}/${totalImpacted} impacted occurrences (${recoveryPct}%) with 0 hard conflicts`);

    if (unresolvedCount > 0) tradeOffs.push(`Leaves ${unresolvedCount} unresolved conflict(s) & ${affectedStudentsAfter} affected students`);
    if (rescheduledActivities > 0) tradeOffs.push(`Requires ${rescheduledActivities} time-slot change(s) for sections`);
    if (facultySubstitutions > 0) tradeOffs.push(`Introduces ${facultySubstitutions} faculty substitution(s)`);
    if (overloadSurchargeHrs > 0) tradeOffs.push(`Triggers ${overloadSurchargeHrs} high-utilization faculty surcharge(s)`);
    if (batchSplitCount > 0 || preemptions.length > 0) tradeOffs.push(`Uses operational splitting/preemption to guarantee priority resilience`);
    if (tradeOffs.length === 0) tradeOffs.push(`Low-overhead adjustment (${recoveryCost} relative cost pts)`);

    return {
      strategyId: strat.id,
      mode: strat.mode,
      transitPolicyLabel: strat.transitMode,
      name: strat.name,
      badge: strat.badge,
      description: strat.description,
      rank: 0,
      allConverged: false,
      convergenceMessage: '',
      convergedStrategies: [strat.name],
      convergedStrategyIds: [strat.id],
      rankReason: '',
      operationalDifferenceNote: '',
      recoveredState,
      recoveredNodes,
      actions,
      preemptions,
      transitActions,
      validation,
      advantages,
      tradeOffs,
      stats: {
        totalImpacted,
        resolvedCount,
        unresolvedConflicts: unresolvedCount,
        unresolvedCriticalCount,
        criticalTotal,
        criticalRecovered,
        recoveryPct,
        scheduleChanges,
        timetableChanges,
        facultySubstitutions,
        classroomChanges,
        labReallocations,
        rescheduledActivities,
        batchSplitCount,
        preemptedCount: preemptions.length,
        examRescheduleCount,
        recoveryCost,
        costBreakdown,
        workloadMetrics,
        affectedStudentsBefore: cascadeResult.metrics.affectedStudents,
        affectedStudentsAfter,
        studentsRestored: Math.max(0, cascadeResult.metrics.affectedStudents - affectedStudentsAfter),
        healthBefore: beforeHealth,
        healthAfter,
        healthExplanation
      }
    };
  }

  global.OMNIS_ENGINE = {
    WEEK_SLOTS,
    RECOVERY_COST_WEIGHTS,
    cloneState,
    addDaysISO,
    parseTimeToMinutes,
    minutesToHHMM,
    formatTime12h,
    computeDurationMinutes,
    mergeTimeRanges,
    validateTimePeriods,
    getOverlappingSlotIds,
    expandDateTimeSegments,
    getActivitiesOnDate,
    expandTimeWindow,
    expandBusDelayWindow,
    getAllActivities,
    validateSchedule,
    buildDependencyGraph,
    simulateFromConfigs,
    simulateCascade,
    generateRecoveryPlans
  };
})(window);
