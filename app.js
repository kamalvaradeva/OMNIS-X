/**
 * OMNIS-X — Intelligent Campus Recovery System
 * Interactive UI Controller, SVG Propagation Graph & Timetable Views
 */

(function () {
  'use strict';

  const {
    DAYS,
    SLOTS,
    OPERATING_HOURS,
    toISODate,
    formatDateDMY,
    getWeekdayName,
    createInitialCampusState
  } = window.OMNIS_DATA;
  const Engine = window.OMNIS_ENGINE;

  const baseState = createInitialCampusState();
  const initialValidation = Engine.validateSchedule(baseState);
  const SCENARIO_TYPES = [
    'SCN-FACULTY-ABSENCE',
    'SCN-LAB-FAILURE',
    'SCN-CLASSROOM-UNAVAILABLE',
    'SCN-BUS-BREAKDOWN',
    'SCN-EXAM-HALL-FAILURE',
    'SCN-POWER-FAILURE',
    'SCN-PLACEMENT-EXAM-CONFLICT'
  ];

  const todayDate = new Date();
  const appState = {
    activeView: 'overview',
    activeScenarioId: null,
    activeFailureConfigs: [],
    draftCards: [],
    cardSeq: 1,
    queuedFailureConfigs: [],
    editingQueueId: null,
    queueSeq: 1,
    cascadeResult: null,
    recoveryPlans: [],
    selectedPlanIndex: 0,
    appliedPlanIndex: -1,
    recoveryApplied: false,
    baChartTab: 'impact',
    baMorphPct: 100,
    baFocusedMetric: 'health',
    baAnimFrame: null,
    selectedNodeId: null,
    twinDeptFilter: 'ALL',
    twinFocusFilter: 'IMPACTED_OR_SAMPLE',
    ttDeptFilter: 'ALL',
    ttSectionFilter: 'SEC-CSE-1',
    ttModeFilter: 'SIDE_BY_SIDE',
    dataTab: 'departments',
    dataSearch: '',
    readinessAudit: null,
    readinessRunning: false,
    readinessProgress: null,
    readinessIncludeN2: false,
    readinessSortKey: 'riskScore',
    readinessSortDir: 'desc',
    readinessCategoryFilter: 'ALL'
  };

  function getScenarioLabel(type) {
    if (!type) return 'No Scenario Selected';
    const found = baseState.scenarios.find((s) => s.id === type);
    return found ? found.name : type;
  }

  function createBlankCard(scenarioType) {
    const cid = `CARD-${appState.cardSeq++}`;
    const baseMeta = {
      _cid: cid,
      _collapsed: false,
      _calYear: todayDate.getFullYear(),
      _calMonth: todayDate.getMonth(),
      _calMode: 'multi',
      _rangeStart: null,
      _searchQuery: ''
    };

    if (scenarioType === 'SCN-FACULTY-ABSENCE') {
      return {
        ...baseMeta,
        scenarioType,
        department: '',
        scheduleMode: 'shared',
        facultyCount: 1,
        facultyIds: [''],
        facultyEntries: [{
          facultyId: '',
          reason: '',
          dates: [],
          fullDay: false,
          perDateTimes: false,
          timePeriods: [{ startTime: '', endTime: '' }],
          dateTimePeriods: {},
          _calYear: todayDate.getFullYear(),
          _calMonth: todayDate.getMonth(),
          _calMode: 'multi',
          _rangeStart: null
        }],
        reason: '',
        dates: [],
        fullDay: false,
        perDateTimes: false,
        timePeriods: [{ startTime: '', endTime: '' }],
        dateTimePeriods: {}
      };
    }
    if (scenarioType === 'SCN-LAB-FAILURE') {
      return {
        ...baseMeta,
        scenarioType,
        department: '',
        labIds: [],
        failureType: '',
        equipmentUnavailablePct: '',
        dates: [],
        fullDay: false,
        perDateTimes: false,
        timePeriods: [{ startTime: '', endTime: '' }],
        dateTimePeriods: {}
      };
    }
    if (scenarioType === 'SCN-CLASSROOM-UNAVAILABLE') {
      return {
        ...baseMeta,
        scenarioType,
        building: '',
        classroomIds: [],
        reason: '',
        dates: [],
        fullDay: false,
        perDateTimes: false,
        timePeriods: [{ startTime: '', endTime: '' }],
        dateTimePeriods: {}
      };
    }
    if (scenarioType === 'SCN-BUS-BREAKDOWN') {
      return {
        ...baseMeta,
        _calMode: 'single',
        scenarioType,
        busIds: [],
        breakdownType: '',
        date: '',
        dates: [],
        startTime: '',
        restorationTime: '',
        spareBusAvailable: ''
      };
    }
    if (scenarioType === 'SCN-EXAM-HALL-FAILURE') {
      return {
        ...baseMeta,
        scenarioType,
        roomId: '',
        examId: '',
        reason: '',
        availableSeating: '',
        dates: [],
        fullDay: false,
        perDateTimes: false,
        timePeriods: [{ startTime: '', endTime: '' }],
        dateTimePeriods: {}
      };
    }
    if (scenarioType === 'SCN-POWER-FAILURE') {
      return {
        ...baseMeta,
        scenarioType,
        powerZone: '',
        failureSource: '',
        dates: [],
        fullDay: false,
        perDateTimes: false,
        timePeriods: [{ startTime: '', endTime: '' }],
        dateTimePeriods: {},
        backupAvailable: '',
        backupCapacityPct: ''
      };
    }
    if (scenarioType === 'SCN-PLACEMENT-EXAM-CONFLICT') {
      return {
        ...baseMeta,
        _calMode: 'single',
        scenarioType,
        placementId: '',
        examId: '',
        proposedDate: '',
        proposedStartTime: '',
        proposedEndTime: '',
        reschedulingPriority: ''
      };
    }
    return null;
  }

  function hydrateCardFromConfig(cfg) {
    const blank = createBlankCard(cfg.scenarioType);
    if (!blank) return null;
    const merged = { ...blank, ...Engine.cloneState(cfg), _cid: `CARD-${appState.cardSeq++}`, _collapsed: false };
    // Ensure arrays & calendar view anchor cleanly
    if (merged.scenarioType === 'SCN-FACULTY-ABSENCE') {
      const fIds = Array.isArray(merged.facultyIds) && merged.facultyIds.length
        ? merged.facultyIds
        : (merged.facultyId ? [merged.facultyId] : ['']);
      merged.facultyIds = fIds;
      merged.facultyCount = fIds.length;
      if (!Array.isArray(merged.facultyEntries) || !merged.facultyEntries.length) {
        merged.facultyEntries = fIds.map((fId) => ({
          facultyId: fId,
          reason: merged.reason || '',
          dates: [...(merged.dates || [])],
          fullDay: Boolean(merged.fullDay),
          perDateTimes: Boolean(merged.perDateTimes),
          timePeriods: Engine.cloneState(merged.timePeriods || [{ startTime: '', endTime: '' }]),
          dateTimePeriods: Engine.cloneState(merged.dateTimePeriods || {}),
          _calYear: todayDate.getFullYear(),
          _calMonth: todayDate.getMonth(),
          _calMode: 'multi',
          _rangeStart: null
        }));
      }
    }
    if (merged.scenarioType === 'SCN-LAB-FAILURE') {
      merged.labIds = Array.isArray(merged.labIds) && merged.labIds.length ? merged.labIds : (merged.labId ? [merged.labId] : []);
    }
    if (merged.scenarioType === 'SCN-CLASSROOM-UNAVAILABLE') {
      merged.classroomIds = Array.isArray(merged.classroomIds) && merged.classroomIds.length ? merged.classroomIds : (merged.classroomId ? [merged.classroomId] : []);
    }
    if (merged.scenarioType === 'SCN-BUS-BREAKDOWN') {
      merged.busIds = Array.isArray(merged.busIds) && merged.busIds.length ? merged.busIds : (merged.busId ? [merged.busId] : []);
      if (!merged.date && Array.isArray(merged.dates) && merged.dates.length) {
        merged.date = merged.dates[0];
      }
    }
    const anchorDate = merged.dates?.[0] || merged.date || merged.proposedDate;
    if (anchorDate && /^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
      const [yy, mm] = anchorDate.split('-').map(Number);
      merged._calYear = yy;
      merged._calMonth = mm - 1;
    }
    return merged;
  }

  function isNonEmpty(val) {
    return val !== '' && val !== null && val !== undefined;
  }

  function validateTimeMapForCard(obj, allowOvernight = false) {
    if (!Array.isArray(obj.dates) || obj.dates.length === 0) {
      return { valid: false, errors: ['Select at least one date on the calendar.'], warnings: [] };
    }
    if (obj.fullDay && !obj.perDateTimes) {
      return { valid: true, errors: [], warnings: [] };
    }
    if (obj.perDateTimes) {
      const errors = [];
      const warnings = [];
      for (const dStr of obj.dates) {
        const periods = obj.dateTimePeriods?.[dStr] || [];
        const res = Engine.validateTimePeriods(periods, { allowOvernight });
        if (!res.valid) errors.push(`${formatDateDMY(dStr)}: ${res.errors[0]}`);
        if (res.hasOverlaps) warnings.push(`${formatDateDMY(dStr)}: Overlapping time periods will be merged.`);
      }
      return { valid: errors.length === 0, errors, warnings };
    }
    const res = Engine.validateTimePeriods(obj.timePeriods, { allowOvernight });
    const warnings = res.hasOverlaps ? ['Overlapping time periods will be merged automatically.'] : [];
    return { valid: res.valid, errors: res.errors, warnings };
  }

  /**
   * Validate a single collapsible disruption card and return { valid, errors, warnings }.
   */
  function validateCard(card) {
    if (!card || !card.scenarioType) return { valid: false, errors: ['Invalid card'], warnings: [] };
    const errors = [];
    const warnings = [];
    const t = card.scenarioType;

    if (t === 'SCN-FACULTY-ABSENCE') {
      if (!isNonEmpty(card.department)) errors.push('Select a department (or All Departments).');
      if (card.scheduleMode === 'individual') {
        const entries = card.facultyEntries || [];
        if (entries.length === 0 || entries.some((e) => !isNonEmpty(e.facultyId))) {
          errors.push('Select all absent faculty members.');
        }
        entries.forEach((e, idx) => {
          if (!isNonEmpty(e.reason)) errors.push(`Faculty ${idx + 1}: Select an absence reason.`);
          const tv = validateTimeMapForCard(e, false);
          if (!tv.valid) errors.push(`Faculty ${idx + 1}: ${tv.errors[0]}`);
          warnings.push(...tv.warnings);
        });
      } else {
        const fIds = card.facultyIds || [];
        if (fIds.length === 0 || fIds.some((id) => !isNonEmpty(id))) {
          errors.push('Select all absent faculty members.');
        }
        if (!isNonEmpty(card.reason)) errors.push('Select an absence reason.');
        const tv = validateTimeMapForCard(card, false);
        if (!tv.valid) errors.push(...tv.errors);
        warnings.push(...tv.warnings);
      }
    } else if (t === 'SCN-LAB-FAILURE') {
      if (!isNonEmpty(card.department)) errors.push('Select a department.');
      if (!card.labIds || card.labIds.length === 0) errors.push('Select at least one laboratory.');
      if (!isNonEmpty(card.failureType)) errors.push('Select a failure type.');
      if (!isNonEmpty(card.equipmentUnavailablePct)) errors.push('Select equipment unavailable percentage.');
      const tv = validateTimeMapForCard(card, false);
      if (!tv.valid) errors.push(...tv.errors);
      warnings.push(...tv.warnings);
    } else if (t === 'SCN-CLASSROOM-UNAVAILABLE') {
      if (!isNonEmpty(card.building)) errors.push('Select a building.');
      if (!card.classroomIds || card.classroomIds.length === 0) errors.push('Select at least one classroom.');
      if (!isNonEmpty(card.reason)) errors.push('Select a failure reason.');
      const tv = validateTimeMapForCard(card, false);
      if (!tv.valid) errors.push(...tv.errors);
      warnings.push(...tv.warnings);
    } else if (t === 'SCN-BUS-BREAKDOWN') {
      if (!card.busIds || card.busIds.length === 0) errors.push('Select at least one bus.');
      if (!isNonEmpty(card.breakdownType)) errors.push('Select a breakdown type.');
      if (!isNonEmpty(card.date) && (!card.dates || card.dates.length === 0)) errors.push('Select a breakdown date.');
      const tv = Engine.validateTimePeriods([{ startTime: card.startTime, endTime: card.restorationTime }], { allowOvernight: false });
      if (!tv.valid) errors.push(tv.errors[0].replace('Period 1: ', ''));
      if (!isNonEmpty(card.spareBusAvailable)) errors.push('Select spare bus availability.');
    } else if (t === 'SCN-EXAM-HALL-FAILURE') {
      if (!isNonEmpty(card.roomId)) errors.push('Select an examination hall.');
      if (!isNonEmpty(card.examId)) errors.push('Select a scheduled examination.');
      if (!isNonEmpty(card.reason)) errors.push('Select a failure reason.');
      const room = baseState.classrooms.find((r) => r.id === card.roomId);
      if (!isNonEmpty(card.availableSeating) || Number(card.availableSeating) < 0 || (room && Number(card.availableSeating) > room.capacity)) {
        errors.push(`Enter available seating capacity between 0 and ${room ? room.capacity : 140}.`);
      }
      const tv = validateTimeMapForCard(card, false);
      if (!tv.valid) errors.push(...tv.errors);
      warnings.push(...tv.warnings);
    } else if (t === 'SCN-POWER-FAILURE') {
      if (!isNonEmpty(card.powerZone)) errors.push('Select a power zone.');
      if (!isNonEmpty(card.failureSource)) errors.push('Select a failure source.');
      const tv = validateTimeMapForCard(card, true);
      if (!tv.valid) errors.push(...tv.errors);
      warnings.push(...tv.warnings);
      if (!isNonEmpty(card.backupAvailable)) errors.push('Select backup power availability.');
      if (card.backupAvailable === true && !isNonEmpty(card.backupCapacityPct)) {
        errors.push('Select backup power capacity percentage.');
      }
    } else if (t === 'SCN-PLACEMENT-EXAM-CONFLICT') {
      if (!isNonEmpty(card.placementId)) errors.push('Select a placement drive.');
      if (!isNonEmpty(card.examId)) errors.push('Select a scheduled examination.');
      if (!isNonEmpty(card.proposedDate)) errors.push('Select a proposed placement date.');
      const tv = Engine.validateTimePeriods([{ startTime: card.proposedStartTime, endTime: card.proposedEndTime }], { allowOvernight: false });
      if (!tv.valid) errors.push(tv.errors[0].replace('Period 1: ', ''));
      if (!isNonEmpty(card.reschedulingPriority)) errors.push('Select a rescheduling priority policy.');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Convert UI card (removing UI-only keys) into clean engine FailureConfig.
   */
  function cardToEngineConfig(card) {
    const clean = Engine.cloneState(card);
    delete clean._cid;
    delete clean._collapsed;
    delete clean._calYear;
    delete clean._calMonth;
    delete clean._calMode;
    delete clean._rangeStart;
    delete clean._searchQuery;
    if (clean.facultyEntries) {
      clean.facultyEntries = clean.facultyEntries.map((e) => {
        const ce = { ...e };
        delete ce._calYear;
        delete ce._calMonth;
        delete ce._calMode;
        delete ce._rangeStart;
        return ce;
      });
    }
    return clean;
  }

  function getValidDraftConfigs() {
    return appState.draftCards
      .filter((c) => validateCard(c).valid)
      .map(cardToEngineConfig);
  }

  // Colors matching prompt requirements:
  // green = operational, red = failed, orange = indirectly affected, blue = recovered
  const STATUS_COLORS = {
    operational: { fill: '#dcfce7', stroke: '#16a34a', text: '#14532d' },
    failed:      { fill: '#fee2e2', stroke: '#dc2626', text: '#7f1d1d' },
    affected:    { fill: '#ffedd5', stroke: '#ea580c', text: '#7c2d12' },
    recovered:   { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a8a' }
  };

  const VIEW_META = {
    overview: {
      title: 'Campus Command Overview',
      subtitle: 'Real-time institutional health, cascading dependency state & constraint-based recovery'
    },
    twin: {
      title: 'Campus Digital Twin & Dependency Graph',
      subtitle: 'Animated BFS failure propagation map across infrastructure, rooms, faculty & student sections'
    },
    simulator: {
      title: 'Disruption Simulator',
      subtitle: 'Launch predefined campus crises or inject custom multi-resource failures'
    },
    recovery: {
      title: 'Constraint-Based Recovery Center',
      subtitle: 'Ranked recovery alternatives, before/after analytics & explainable resource decisions'
    },
    timetable: {
      title: 'Timetable Comparison Matrix',
      subtitle: 'Side-by-side original vs. recovered weekly timetable with highlighted schedule changes'
    },
    data: {
      title: 'Institutional Data Registry',
      subtitle: '5 Departments • 50 Faculty • 1,200 Students (20 Sections) • 25 Classrooms • 10 Labs • 8 Buses'
    },
    readiness: {
      title: 'Zero-Failure Readiness Audit',
      subtitle: 'N-1 & N-2 institutional stress testing, Single Points of Failure ranking & weekly vulnerability heatmap'
    }
  };

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function recomputeSimulation() {
    // Always invalidate previous recovery plans & applied flags before simulating new state
    appState.recoveryApplied = false;
    appState.appliedPlanIndex = -1;
    appState.recoveryPlans = [];
    appState.selectedPlanIndex = 0;
    appState.baMorphPct = 100;

    appState.cascadeResult = Engine.simulateFromConfigs(
      baseState,
      appState.activeFailureConfigs
    );
    appState.recoveryPlans = Engine.generateRecoveryPlans(appState.cascadeResult);
    if (appState.selectedPlanIndex >= appState.recoveryPlans.length) {
      appState.selectedPlanIndex = 0;
    }
  }

  function getSelectedPlan() {
    if (!appState.recoveryPlans.length) return null;
    return appState.recoveryPlans[appState.selectedPlanIndex] || appState.recoveryPlans[0];
  }

  function getAppliedPlan() {
    if (!appState.recoveryApplied || appState.appliedPlanIndex < 0) return null;
    return appState.recoveryPlans[appState.appliedPlanIndex] || null;
  }

  function getActiveWorkingState() {
    const applied = getAppliedPlan();
    if (applied) {
      return applied.recoveredState;
    }
    return appState.cascadeResult ? appState.cascadeResult.state : baseState;
  }

  /**
   * Compute live display metrics reflecting the currently applied recovery plan (or disrupted state before applying).
   */
  function getDisplayMetrics() {
    const m = appState.cascadeResult.metrics;
    const applied = getAppliedPlan();
    const previewPlan = getSelectedPlan();
    if (applied) {
      return {
        campusHealthPct: applied.stats.healthAfter,
        availableFaculty: m.availableFaculty,
        totalFaculty: m.totalFaculty,
        availableClassrooms: m.availableClassrooms,
        totalClassrooms: m.totalClassrooms,
        availableLabs: m.availableLabs,
        totalLabs: m.totalLabs,
        affectedStudents: applied.stats.affectedStudentsAfter,
        totalStudents: m.totalStudents,
        activeDisruptions: applied.stats.unresolvedConflicts,
        recoveryPct: applied.stats.recoveryPct,
        resolvedCount: applied.stats.resolvedCount,
        totalImpacted: applied.stats.totalImpacted
      };
    }
    return {
      campusHealthPct: m.campusHealthPct,
      availableFaculty: m.availableFaculty,
      totalFaculty: m.totalFaculty,
      availableClassrooms: m.availableClassrooms,
      totalClassrooms: m.totalClassrooms,
      availableLabs: m.availableLabs,
      totalLabs: m.totalLabs,
      affectedStudents: m.affectedStudents,
      totalStudents: m.totalStudents,
      activeDisruptions: m.activeDisruptions,
      recoveryPct: previewPlan ? previewPlan.stats.recoveryPct : 100,
      resolvedCount: previewPlan ? previewPlan.stats.resolvedCount : 0,
      totalImpacted: m.impactedSessionsCount
    };
  }

  function getEffectiveNodeStatus(nodeId) {
    const applied = getAppliedPlan();
    if (applied && applied.recoveredNodes.has(nodeId)) {
      return 'recovered';
    }
    if (!appState.cascadeResult) return 'operational';
    return appState.cascadeResult.nodeStatus.get(nodeId) || 'operational';
  }

  function showBanner(message, tone = 'info') {
    const el = document.getElementById('actionBanner');
    el.textContent = message;
    el.className = `toast-banner ${tone === 'danger' ? 'banner-danger' : tone === 'success' ? 'banner-success' : ''}`;
    el.classList.remove('hidden');
  }

  function hideBanner() {
    document.getElementById('actionBanner').classList.add('hidden');
  }

  // ==================== ACTIONS ====================

  function hasActiveDisruption() {
    if (!appState.cascadeResult) return false;
    return (
      appState.activeFailureConfigs.length > 0 ||
      appState.cascadeResult.failedIds.length > 0 ||
      appState.cascadeResult.injectedClashes.length > 0
    );
  }

  function triggerScenario(scenarioId) {
    const scenario = baseState.scenarios.find((s) => s.id === scenarioId);
    if (!scenario) return;

    appState.activeScenarioId = scenario.id;
    appState.recoveryApplied = false;
    appState.selectedPlanIndex = 0;
    appState.editingQueueId = null;

    const defaults = Engine.cloneState(scenario.defaultConfigs || []);
    appState.draftCards = defaults.map(hydrateCardFromConfig).filter(Boolean);
    if (scenario.id === 'SCN-MULTI-DISRUPTION') {
      appState.queuedFailureConfigs = defaults.map((cfg) => ({
        ...cfg,
        _qid: `Q-${appState.queueSeq++}`
      }));
      appState.activeFailureConfigs = Engine.cloneState(appState.queuedFailureConfigs);
    } else {
      // Do not merge predefined failures with unrelated previous queue entries
      appState.queuedFailureConfigs = [];
      appState.activeFailureConfigs = defaults;
    }

    recomputeSimulation();
    appState.selectedNodeId = appState.cascadeResult.failedIds[0] || appState.cascadeResult.impactedActivities[0]?.id || null;
    renderAll();

    const m = appState.cascadeResult.metrics;
    showBanner(
      `Simulated "${scenario.name}": ${m.impactedSessionsCount} scheduled session(s) & ${m.affectedStudents} students impacted. Customize parameters in the Dynamic Failure Builder if needed.`,
      'danger'
    );
  }

  function configSignature(cfg) {
    const clean = cardToEngineConfig(cfg);
    delete clean._qid;
    return JSON.stringify(clean);
  }

  function addBuilderToQueue(singleCardId = null) {
    const targetCards = singleCardId
      ? appState.draftCards.filter((c) => c._cid === singleCardId)
      : appState.draftCards;
    const validCards = targetCards.filter((c) => validateCard(c).valid);
    if (validCards.length === 0) {
      showBanner('Please complete all required fields and resolve any time validation errors before adding to the queue.', 'info');
      return;
    }

    let added = 0;
    let skippedDup = 0;

    if (appState.editingQueueId && validCards.length === 1) {
      const cfg = cardToEngineConfig(validCards[0]);
      const idx = appState.queuedFailureConfigs.findIndex((x) => x._qid === appState.editingQueueId);
      if (idx >= 0) {
        cfg._qid = appState.editingQueueId;
        appState.queuedFailureConfigs[idx] = cfg;
      }
      appState.editingQueueId = null;
      showBanner(`Updated queued disruption (${getScenarioLabel(cfg.scenarioType)}). Click "Run Combined Simulation" to execute.`, 'info');
      renderSimulatorView();
      return;
    }

    validCards.forEach((card) => {
      const cfg = cardToEngineConfig(card);
      const sig = configSignature(cfg);
      const isDup = appState.queuedFailureConfigs.some((q) => configSignature(q) === sig);
      if (isDup) {
        skippedDup++;
      } else {
        cfg._qid = `Q-${appState.queueSeq++}`;
        appState.queuedFailureConfigs.push(cfg);
        added++;
      }
    });

    if (added > 0) {
      showBanner(`Added ${added} disruption(s) to Failure Queue${skippedDup ? ` (${skippedDup} duplicate skipped)` : ''}.`, 'info');
    } else {
      showBanner('Selected disruption configuration is already in the Failure Queue (duplicate prevented).', 'info');
    }
    renderSimulatorView();
  }

  function triggerCustomFailures(forceQueueOnly = false) {
    let configs = [];
    if (forceQueueOnly) {
      configs = Engine.cloneState(appState.queuedFailureConfigs);
    } else if (appState.queuedFailureConfigs.length > 0 && getValidDraftConfigs().length === 0) {
      configs = Engine.cloneState(appState.queuedFailureConfigs);
    } else {
      const validDrafts = getValidDraftConfigs();
      if (validDrafts.length > 0 && (!forceQueueOnly)) {
        configs = validDrafts;
      } else if (appState.queuedFailureConfigs.length > 0) {
        configs = Engine.cloneState(appState.queuedFailureConfigs);
      }
    }

    if (configs.length === 0) {
      showBanner('Select and complete at least one valid disruption configuration before running simulation.', 'info');
      return;
    }

    appState.activeScenarioId = configs.length > 1 ? 'SCN-MULTI-DISRUPTION' : configs[0].scenarioType;
    appState.activeFailureConfigs = configs;
    appState.recoveryApplied = false;
    appState.selectedPlanIndex = 0;

    recomputeSimulation();
    appState.selectedNodeId = appState.cascadeResult.failedIds[0] || appState.cascadeResult.impactedActivities[0]?.id || null;
    renderAll();

    const m = appState.cascadeResult.metrics;
    const msg = appState.cascadeResult.noScheduledActivitiesOnly
      ? 'No scheduled activities on the selected date(s). Campus remains 100% operational.'
      : `Simulation executed (${configs.length} disruption config${configs.length > 1 ? 's' : ''}): Campus Health ${m.campusHealthPct}%, ${m.impactedSessionsCount} impacted session(s), ${m.affectedStudents} affected students.`;
    showBanner(msg, appState.cascadeResult.noScheduledActivitiesOnly ? 'info' : 'danger');
  }

  function applySelectedRecovery() {
    const plan = getSelectedPlan();
    if (!plan || !hasActiveDisruption()) return;
    appState.recoveryApplied = true;
    appState.appliedPlanIndex = appState.selectedPlanIndex;
    renderAll();
    showBanner(
      `Applied Rank #${plan.rank} "${plan.name}": ${plan.stats.resolvedCount}/${plan.stats.totalImpacted} impacted occurrences recovered (${plan.stats.recoveryPct}%), affected students reduced from ${plan.stats.affectedStudentsBefore} to ${plan.stats.affectedStudentsAfter}.`,
      'success'
    );
  }

  function undoRecovery() {
    if (!appState.recoveryApplied) return;
    appState.recoveryApplied = false;
    appState.appliedPlanIndex = -1;
    renderAll();
    showBanner('Recovery undone. Campus reverted to disrupted pre-recovery state for further comparison.', 'info');
  }

  function resetSimulation() {
    appState.activeScenarioId = null;
    appState.activeFailureConfigs = [];
    appState.draftCards = [];
    appState.queuedFailureConfigs = [];
    appState.editingQueueId = null;
    appState.recoveryApplied = false;
    appState.appliedPlanIndex = -1;
    appState.selectedPlanIndex = 0;
    appState.selectedNodeId = null;
    recomputeSimulation();
    hideBanner();
    renderAll();
  }

  function switchView(viewName) {
    appState.activeView = viewName;
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    document.querySelectorAll('.view').forEach((sec) => {
      sec.classList.toggle('active', sec.id === `view-${viewName}`);
    });
    const meta = VIEW_META[viewName] || VIEW_META.overview;
    document.getElementById('pageTitle').textContent = meta.title;
    document.getElementById('pageSubtitle').textContent = meta.subtitle;
    document.getElementById('sidebar').classList.remove('open');
    renderActiveViewDetails();
  }

  // ==================== HEADER & CHROME ====================

  function renderChrome() {
    const dm = getDisplayMetrics();
    const hasDisruption = hasActiveDisruption();
    const pill = document.getElementById('sidebarSystemStatus');
    const pillText = document.getElementById('sidebarStatusText');

    pill.classList.remove('status-operational', 'status-disrupted', 'status-recovered');
    if (!hasDisruption) {
      pill.classList.add('status-operational');
      pillText.textContent = 'SYSTEM OPERATIONAL';
    } else if (appState.recoveryApplied) {
      pill.classList.add('status-recovered');
      pillText.textContent = 'RECOVERY APPLIED';
    } else {
      pill.classList.add('status-disrupted');
      pillText.textContent = 'DISRUPTION ACTIVE';
    }

    const healthVal = document.getElementById('topbarHealthValue');
    healthVal.textContent = `${dm.campusHealthPct}%`;
    healthVal.className = dm.campusHealthPct >= 90 ? 'text-green' : dm.campusHealthPct >= 70 ? 'text-orange' : 'text-red';

    const badge = document.getElementById('navRecoveryBadge');
    const appliedPlan = getAppliedPlan();
    const selectedPlan = getSelectedPlan();
    const unresolvedNow = appliedPlan
      ? (appliedPlan.stats.unresolvedConflicts || 0)
      : appState.cascadeResult.metrics.impactedSessionsCount;
    if (unresolvedNow > 0) {
      badge.textContent = unresolvedNow;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }

    const switchingAppliedPlan = Boolean(appState.recoveryApplied && appState.appliedPlanIndex !== appState.selectedPlanIndex);
    const canApply = hasDisruption && appState.recoveryPlans.length > 0 && (!appState.recoveryApplied || switchingAppliedPlan);
    const canUndo = appState.recoveryApplied;

    const topApply = document.getElementById('btnApplyRecovery');
    const centerApply = document.getElementById('btnCenterApply');
    topApply.disabled = !canApply;
    topApply.textContent = switchingAppliedPlan && selectedPlan ? `Apply Rank #${selectedPlan.rank} Plan` : 'Apply Recovery Plan';
    document.getElementById('btnUndoRecovery').disabled = !canUndo;
    const centerUndo = document.getElementById('btnCenterUndo');
    if (centerApply) {
      centerApply.disabled = !canApply;
      centerApply.textContent = switchingAppliedPlan && selectedPlan ? `Apply Rank #${selectedPlan.rank} Plan` : 'Apply Selected Recovery Plan';
    }
    if (centerUndo) centerUndo.disabled = !canUndo;

    const valEl = document.getElementById('sidebarValidationStatus');
    valEl.textContent = `${initialValidation.conflicts.length} (Verified)`;
  }

  // ==================== VIEW 1: OVERVIEW ====================

  function renderOverview() {
    const dm = getDisplayMetrics();
    const hasDisruption = hasActiveDisruption();
    const plan = getSelectedPlan();

    const kpis = [
      {
        label: 'Campus Health',
        value: `${dm.campusHealthPct}%`,
        foot: !hasDisruption ? 'All systems nominal' : appState.recoveryApplied ? 'Post-recovery index' : 'Cascading impact index',
        tone: dm.campusHealthPct >= 90 ? 'kpi-green' : dm.campusHealthPct >= 70 ? 'kpi-orange' : 'kpi-red'
      },
      {
        label: 'Available Faculty',
        value: `${dm.availableFaculty} / ${dm.totalFaculty}`,
        foot: `${dm.totalFaculty - dm.availableFaculty} unavailable / delayed`,
        tone: dm.availableFaculty === dm.totalFaculty ? 'kpi-green' : 'kpi-orange'
      },
      {
        label: 'Available Classrooms',
        value: `${dm.availableClassrooms} / ${dm.totalClassrooms}`,
        foot: `Labs: ${dm.availableLabs}/${dm.totalLabs} operational`,
        tone: dm.availableClassrooms === dm.totalClassrooms ? 'kpi-green' : 'kpi-orange'
      },
      {
        label: 'Affected Students',
        value: dm.affectedStudents.toLocaleString(),
        foot: `Out of ${dm.totalStudents.toLocaleString()} total`,
        tone: dm.affectedStudents === 0 ? 'kpi-green' : 'kpi-red'
      },
      {
        label: 'Active Disruptions',
        value: dm.activeDisruptions,
        foot: `${appState.cascadeResult.metrics.impactedSessionsCount} sessions impacted`,
        tone: dm.activeDisruptions === 0 ? 'kpi-green' : 'kpi-red'
      },
      {
        label: 'Recovery Rate',
        value: hasDisruption ? `${dm.recoveryPct}%` : 'Ready',
        foot: hasDisruption && plan ? `${plan.stats.resolvedCount}/${plan.stats.totalImpacted} activities solvable` : '0 initial conflicts',
        tone: 'kpi-blue'
      }
    ];

    document.getElementById('overviewKpiGrid').innerHTML = kpis.map((k) => `
      <div class="kpi-card ${k.tone}">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value">${k.value}</div>
        <div class="kpi-foot">${k.foot}</div>
      </div>
    `).join('');

    // Compact SVG Graph
    renderPropagationSVG(document.getElementById('overviewSvgWrap'), { compact: true });

    // Quick Scenario Buttons
    document.getElementById('overviewQuickScenarios').innerHTML = baseState.scenarios.map((sc) => `
      <button class="scenario-btn ${appState.activeScenarioId === sc.id ? 'active' : ''}" data-scenario="${sc.id}">
        <div class="scenario-title">
          <span>${escapeHtml(sc.name)}</span>
          <span class="badge ${appState.activeScenarioId === sc.id ? 'badge-red' : 'badge-gray'}">${escapeHtml(sc.badge)}</span>
        </div>
        <div class="scenario-desc">${escapeHtml(sc.description)}</div>
      </button>
    `).join('');

    // Active Impacts List
    const impactsWrap = document.getElementById('overviewImpactsList');
    const impacted = appState.cascadeResult.impactedActivities;
    if (impacted.length === 0) {
      impactsWrap.innerHTML = `<p class="muted">No active disruptions. All 120 weekly lectures/labs, 5 examinations, 3 placement drives, and 3 events are running with zero conflicts.</p>`;
    } else {
      impactsWrap.innerHTML = impacted.map((act) => {
        const effStatus = getEffectiveNodeStatus(act.id);
        const badgeCls = effStatus === 'recovered' ? 'badge-blue' : 'badge-orange';
        const reason = appState.cascadeResult.nodeImpactReason.get(act.id) || 'Impacted';
        return `
          <div class="impact-row">
            <div>
              <strong>${escapeHtml(act.id)} • ${escapeHtml(act.title)}</strong>
              <div class="muted">${escapeHtml(act.sectionId)} (${act.studentCount} students) • ${act.day} ${act.slotId} • ${escapeHtml(reason)}</div>
            </div>
            <span class="badge ${badgeCls}">${effStatus === 'recovered' ? 'Recovered' : act.activityType}</span>
          </div>
        `;
      }).join('');
    }

    // Recovery Snapshot
    const snapWrap = document.getElementById('overviewRecoverySnapshot');
    if (!plan) {
      snapWrap.innerHTML = `
        <p class="muted">Trigger any disruption scenario to compute live Before-vs-After constraint recovery statistics.</p>
        <div class="before-after-grid" style="grid-template-columns: repeat(2, 1fr); margin-top: 12px;">
          <div class="ba-card"><div class="ba-label">Schedule Integrity</div><div class="ba-after text-green" style="color:var(--green)">100% Valid</div></div>
          <div class="ba-card"><div class="ba-label">Total Monitored Nodes</div><div class="ba-after">${appState.cascadeResult.graph.nodes.size}</div></div>
        </div>
      `;
    } else {
      const s = plan.stats;
      const applied = getAppliedPlan();
      const isAppliedSel = Boolean(applied && appState.appliedPlanIndex === appState.selectedPlanIndex);
      snapWrap.innerHTML = `
        <div style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
          <strong>Selected: Rank #${plan.rank} — ${escapeHtml(plan.name)}</strong>
          <span class="badge ${isAppliedSel ? 'badge-blue' : 'badge-gray'}">${isAppliedSel ? 'Applied' : 'Preview'}</span>
        </div>
        <div class="before-after-grid" style="grid-template-columns: repeat(2, 1fr);">
          <div class="ba-card">
            <div class="ba-label">Affected Students</div>
            <div class="ba-numbers"><span class="ba-before">${s.affectedStudentsBefore}</span><span class="ba-arrow">→</span><span class="ba-after">${s.affectedStudentsAfter}</span></div>
          </div>
          <div class="ba-card">
            <div class="ba-label">Unresolved Conflicts</div>
            <div class="ba-numbers"><span class="ba-before">${s.totalImpacted}</span><span class="ba-arrow">→</span><span class="ba-after">${s.unresolvedConflicts}</span></div>
          </div>
          <div class="ba-card">
            <div class="ba-label">Recovery Percentage</div>
            <div class="ba-numbers"><span class="ba-after">${s.recoveryPct}%</span></div>
          </div>
          <div class="ba-card">
            <div class="ba-label">Schedule Changes / Cost</div>
            <div class="ba-numbers"><span class="ba-after">${s.scheduleChanges} / ${s.recoveryCost} pts</span></div>
          </div>
        </div>
      `;
    }
  }

  // ==================== VIEW 2: DIGITAL TWIN SVG GRAPH ====================

  function renderPropagationSVG(container, opts = {}) {
    const compact = Boolean(opts.compact);
    const { graph, failedIds, impactedActivities } = appState.cascadeResult;
    const deptFilter = compact ? 'ALL' : appState.twinDeptFilter;
    const focusMode = compact ? 'IMPACTED_OR_SAMPLE' : appState.twinFocusFilter;

    // Group nodes into 5 visual tiers for a clean layered architecture diagram
    const tiers = [
      { key: 'infra', title: '1. Infrastructure & Transit', items: [] },
      { key: 'rooms', title: '2. Classrooms, Labs & Hostels', items: [] },
      { key: 'faculty', title: '3. Faculty Members', items: [] },
      { key: 'activities', title: '4. Scheduled Activities', items: [] },
      { key: 'sections', title: '5. Student Sections', items: [] }
    ];

    const impactedSet = new Set([
      ...failedIds,
      ...impactedActivities.map((a) => a.id)
    ]);
    appState.cascadeResult.bfsTrace.forEach((t) => impactedSet.add(t.nodeId));
    const plan = getAppliedPlan() || getSelectedPlan();
    if (plan) {
      plan.recoveredNodes.forEach((id) => impactedSet.add(id));
      plan.actions.forEach((a) => {
        if (a.resolved) {
          impactedSet.add(a.newFacultyId);
          impactedSet.add(a.newRoomId);
        }
      });
    }

    function matchesDept(node) {
      if (deptFilter === 'ALL') return true;
      const m = node.meta || {};
      if (m.department === deptFilter || m.department === 'CENTRAL') return true;
      if (node.category === 'admin' || node.category === 'infrastructure' || node.category === 'bus' || node.category === 'hostel') return true;
      return false;
    }

    const hasAnyDisruption = hasActiveDisruption();

    graph.nodes.forEach((node) => {
      if (!matchesDept(node)) return;
      if (node.category === 'department') return;

      const isImportant = impactedSet.has(node.id);
      if (focusMode === 'IMPACTED_OR_SAMPLE') {
        if (hasAnyDisruption && !isImportant) {
          // Keep core infrastructure anchors + up to 2 operational samples per tier so graph stays readable
          const isAnchor = ['ADM-02', 'ADM-05', 'PZ-1', 'BUS-01', 'CR-21', 'LAB-01', 'FAC-01', 'SEC-CSE-1'].includes(node.id);
          if (!isAnchor) return;
        } else if (!hasAnyDisruption) {
          const sampleIds = new Set([
            'ADM-02', 'ADM-05', 'PZ-1', 'BUS-01', 'BUS-02',
            'CR-01', 'CR-21', 'CR-24', 'LAB-01', 'HST-01',
            'FAC-01', 'FAC-02', 'FAC-11', 'FAC-21',
            'EXM-01', 'PLC-01', 'TT-001', 'TT-005',
            'SEC-CSE-1', 'SEC-CSE-4', 'SEC-ECE-1', 'SEC-ME-4'
          ]);
          if (!sampleIds.has(node.id)) return;
        }
      }

      if (node.category === 'admin' || node.category === 'infrastructure' || node.category === 'bus') {
        tiers[0].items.push(node);
      } else if (node.category === 'classroom' || node.category === 'lab' || node.category === 'hostel') {
        tiers[1].items.push(node);
      } else if (node.category === 'faculty') {
        tiers[2].items.push(node);
      } else if (node.category === 'activity') {
        tiers[3].items.push(node);
      } else if (node.category === 'section') {
        tiers[4].items.push(node);
      }
    });

    // Cap per-tier display in compact overview mode so layout never overflows
    const maxPerTier = compact ? 5 : 14;
    tiers.forEach((t) => {
      // Prioritize failed/affected/recovered nodes first
      t.items.sort((a, b) => {
        const rank = (id) => {
          const st = getEffectiveNodeStatus(id);
          if (st === 'failed') return 0;
          if (st === 'affected') return 1;
          if (st === 'recovered') return 2;
          return 3;
        };
        return rank(a.id) - rank(b.id);
      });
      if (t.items.length > maxPerTier) {
        t.items = t.items.slice(0, maxPerTier);
      }
    });

    const nodeWidth = compact ? 116 : 142;
    const nodeHeight = compact ? 36 : 42;
    const colGap = compact ? 42 : 68;
    const rowGap = compact ? 12 : 14;
    const padX = 24;
    const padY = 38;

    const maxRows = Math.max(1, ...tiers.map((t) => t.items.length));
    const svgWidth = padX * 2 + tiers.length * nodeWidth + (tiers.length - 1) * colGap;
    const svgHeight = Math.max(compact ? 290 : 460, padY + maxRows * (nodeHeight + rowGap) + 26);

    const posMap = new Map();
    tiers.forEach((tier, colIdx) => {
      const x = padX + colIdx * (nodeWidth + colGap);
      tier.items.forEach((node, rowIdx) => {
        const y = padY + rowIdx * (nodeHeight + rowGap);
        posMap.set(node.id, { x, y, cx: x + nodeWidth / 2, cy: y + nodeHeight / 2, node });
      });
    });

    // Build visible edges
    let edgesSvg = '';
    posMap.forEach((srcPos, srcId) => {
      const edges = graph.adj.get(srcId) || [];
      edges.forEach((e) => {
        const dstPos = posMap.get(e.to);
        if (!dstPos) return;
        const srcStatus = getEffectiveNodeStatus(srcId);
        const dstStatus = getEffectiveNodeStatus(e.to);
        let stroke = '#cbd5e1';
        let strokeW = 1.4;
        let cls = '';
        if (srcStatus === 'failed' && (dstStatus === 'affected' || dstStatus === 'failed')) {
          stroke = '#dc2626';
          strokeW = 2.4;
          cls = 'edge-animated';
        } else if (srcStatus === 'affected' && dstStatus === 'affected') {
          stroke = '#ea580c';
          strokeW = 2.0;
          cls = 'edge-animated';
        } else if (dstStatus === 'recovered' || srcStatus === 'recovered') {
          stroke = '#2563eb';
          strokeW = 2.2;
          cls = 'edge-animated';
        }
        const x1 = srcPos.x + nodeWidth;
        const y1 = srcPos.cy;
        const x2 = dstPos.x;
        const y2 = dstPos.cy;
        const mx = (x1 + x2) / 2;
        edgesSvg += `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${strokeW}" class="${cls}" opacity="0.88" />`;
      });
    });

    // Draw recovery substitution links in blue when recovery is applied
    if (appState.recoveryApplied && plan) {
      plan.actions.forEach((act) => {
        if (!act.resolved) return;
        const actPos = posMap.get(act.activityId);
        const facPos = posMap.get(act.newFacultyId);
        const roomPos = posMap.get(act.newRoomId);
        [facPos, roomPos].forEach((src) => {
          if (src && actPos) {
            const x1 = src.x + nodeWidth;
            const y1 = src.cy;
            const x2 = actPos.x;
            const y2 = actPos.cy;
            const mx = (x1 + x2) / 2;
            edgesSvg += `<path d="M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}" fill="none" stroke="#2563eb" stroke-width="2.4" class="edge-animated" />`;
          }
        });
      });
    }

    // Tier headers
    let headersSvg = '';
    tiers.forEach((tier, colIdx) => {
      const x = padX + colIdx * (nodeWidth + colGap);
      headersSvg += `<text x="${x}" y="22" font-size="11" font-weight="700" fill="#475569">${escapeHtml(tier.title)}</text>`;
    });

    // Nodes SVG
    let nodesSvg = '';
    posMap.forEach(({ x, y, node }) => {
      const st = getEffectiveNodeStatus(node.id);
      const colors = STATUS_COLORS[st] || STATUS_COLORS.operational;
      const isSelected = appState.selectedNodeId === node.id;
      const shortLabel = node.label.replace(`${node.id} `, '').replace(/[()]/g, '');
      const trunc = shortLabel.length > 17 ? shortLabel.slice(0, 16) + '…' : shortLabel;

      nodesSvg += `
        <g class="graph-node" data-node-id="${escapeHtml(node.id)}" transform="translate(${x}, ${y})">
          <rect width="${nodeWidth}" height="${nodeHeight}" rx="8"
            fill="${colors.fill}"
            stroke="${isSelected ? '#0f172a' : colors.stroke}"
            stroke-width="${isSelected ? 3 : 1.7}" />
          <text x="8" y="16" font-size="11" font-weight="700" fill="${colors.text}">${escapeHtml(node.id)}</text>
          <text x="8" y="${nodeHeight - 9}" font-size="10" fill="${colors.text}">${escapeHtml(trunc)}</text>
        </g>
      `;
    });

    container.innerHTML = `
      <svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="http://www.w3.org/2000/svg">
        ${headersSvg}
        <g>${edgesSvg}</g>
        <g>${nodesSvg}</g>
      </svg>
    `;
  }

  function renderDigitalTwinView() {
    renderPropagationSVG(document.getElementById('twinSvgWrap'), { compact: false });
    renderNodeInspector();

    // BFS Trace Table
    const trace = appState.cascadeResult.bfsTrace;
    document.getElementById('bfsCountBadge').textContent = `${trace.length} propagated node(s)`;
    const tbody = document.querySelector('#bfsTraceTable tbody');
    if (trace.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="muted">No failure active. Trigger a scenario in the Disruption Simulator to observe BFS cascading hops.</td></tr>`;
    } else {
      tbody.innerHTML = trace.map((row) => {
        const effStatus = getEffectiveNodeStatus(row.nodeId);
        const badgeCls =
          effStatus === 'failed' ? 'badge-red' :
          effStatus === 'recovered' ? 'badge-blue' :
          effStatus === 'affected' ? 'badge-orange' : 'badge-green';
        return `
          <tr>
            <td><strong>Hop ${row.hop}</strong></td>
            <td><code>${escapeHtml(row.nodeId)}</code></td>
            <td>${escapeHtml(row.label)}</td>
            <td>${escapeHtml(row.category)}</td>
            <td><code>${escapeHtml(row.causedBy)}</code></td>
            <td>${escapeHtml(row.relation.replace(/_/g, ' '))}</td>
            <td><span class="badge ${badgeCls}">${effStatus}</span></td>
          </tr>
        `;
      }).join('');
    }
  }

  function renderNodeInspector() {
    const panel = document.getElementById('nodeInspector');
    const id = appState.selectedNodeId;
    if (!id || !appState.cascadeResult.graph.nodes.has(id)) {
      panel.innerHTML = `
        <h3>Node Inspector</h3>
        <p class="muted">Click any node in the SVG dependency graph to inspect its status, hop level, upstream causes, and downstream dependents.</p>
      `;
      return;
    }

    const { graph, nodeImpactReason, nodeHop } = appState.cascadeResult;
    const node = graph.nodes.get(id);
    const effStatus = getEffectiveNodeStatus(id);
    const badgeCls =
      effStatus === 'failed' ? 'badge-red' :
      effStatus === 'recovered' ? 'badge-blue' :
      effStatus === 'affected' ? 'badge-orange' : 'badge-green';

    const downstream = (graph.adj.get(id) || []).map((e) => `${e.to} (${e.relation.replace(/_/g, ' ')})`);
    const upstream = [];
    graph.adj.forEach((edges, fromId) => {
      edges.forEach((e) => {
        if (e.to === id) upstream.push(`${fromId} (${e.relation.replace(/_/g, ' ')})`);
      });
    });

    const reason = nodeImpactReason.get(id) || 'Operating within normal parameters.';
    const hop = nodeHop.has(id) ? `Hop ${nodeHop.get(id)}` : 'N/A';

    panel.innerHTML = `
      <h3>${escapeHtml(node.id)}</h3>
      <div style="margin-bottom:8px;">
        <span class="badge ${badgeCls}">${effStatus}</span>
        <span class="badge badge-gray">${escapeHtml(node.category)}</span>
      </div>
      <p style="margin:0 0 8px; font-weight:600;">${escapeHtml(node.label)}</p>
      <p class="muted" style="margin:0 0 10px;"><strong>BFS Hop:</strong> ${hop}<br><strong>Status Detail:</strong> ${escapeHtml(reason)}</p>
      <div style="margin-bottom:10px;">
        <strong style="font-size:12px;">Depends On (${upstream.length}):</strong>
        <ul style="margin:4px 0 0; padding-left:16px; font-size:12px; color:var(--text-secondary);">
          ${upstream.slice(0, 8).map((u) => `<li>${escapeHtml(u)}</li>`).join('') || '<li>Root infrastructure / independent</li>'}
        </ul>
      </div>
      <div>
        <strong style="font-size:12px;">Impacts Downstream (${downstream.length}):</strong>
        <ul style="margin:4px 0 0; padding-left:16px; font-size:12px; color:var(--text-secondary);">
          ${downstream.slice(0, 10).map((d) => `<li>${escapeHtml(d)}</li>`).join('') || '<li>Leaf consumer node</li>'}
        </ul>
      </div>
    `;
  }

  // ==================== VIEW 3: DISRUPTION SIMULATOR ====================

  function updateBuilderButtonStates() {
    const validConfigs = getValidDraftConfigs();
    const hasQueue = appState.queuedFailureConfigs.length > 0;
    const addBtn = document.getElementById('btnAddFailureQueue');
    const simBtn = document.getElementById('btnSimulateCustom');
    const runCombinedBtn = document.getElementById('btnRunCombinedQueue');
    const clearQueueBtn = document.getElementById('btnClearQueue');
    if (addBtn) addBtn.disabled = validConfigs.length === 0;
    if (simBtn) simBtn.disabled = !(validConfigs.length > 0 || hasQueue);
    if (runCombinedBtn) runCombinedBtn.disabled = !hasQueue;
    if (clearQueueBtn) clearQueueBtn.disabled = !hasQueue;
  }

  function renderSimulatorView() {
    document.getElementById('scenarioCardsGrid').innerHTML = baseState.scenarios.map((sc) => {
      const isActive = appState.activeScenarioId === sc.id;
      return `
        <div class="scenario-card ${isActive ? 'active-scenario' : ''}">
          <div>
            <div class="scenario-title">
              <span>${escapeHtml(sc.name)}</span>
              <span class="badge ${isActive ? 'badge-red' : 'badge-gray'}">${escapeHtml(sc.badge)}</span>
            </div>
            <p class="scenario-desc" style="margin-top:8px;">${escapeHtml(sc.description)}</p>
          </div>
          <button class="btn ${isActive ? 'btn-danger' : 'btn-primary'} btn-sm" data-scenario="${sc.id}">
            ${isActive ? 'Re-Run Scenario' : 'Simulate Scenario'}
          </button>
        </div>
      `;
    }).join('');

    renderScenarioTypeSelector();
    renderDisruptionCards();
    renderCombinedImpactPreview();
    renderQueuedFailures();
    updateBuilderButtonStates();
  }

  function renderScenarioTypeSelector() {
    const container = document.getElementById('scenarioTypeSelector');
    const activeTypes = new Set(appState.draftCards.map((c) => c.scenarioType));

    container.innerHTML = SCENARIO_TYPES.map((t) => {
      const checked = activeTypes.has(t);
      const count = appState.draftCards.filter((c) => c.scenarioType === t).length;
      return `
        <div class="scenario-check-pill ${checked ? 'checked' : ''}">
          <label style="display:inline-flex; align-items:center; gap:6px; cursor:pointer; margin:0;">
            <input type="checkbox" class="scenario-type-cb" value="${t}" ${checked ? 'checked' : ''}>
            <span>${escapeHtml(getScenarioLabel(t))}${count > 1 ? ` (${count})` : ''}</span>
          </label>
          ${checked ? `<button type="button" class="add-instance-mini" data-add-instance="${t}" title="Add another ${escapeHtml(getScenarioLabel(t))} card">+ Add</button>` : ''}
        </div>
      `;
    }).join('');

    const badgeEl = document.getElementById('builderActiveScenarioBadge');
    if (appState.draftCards.length === 0) {
      badgeEl.textContent = 'No Scenario Selected';
      badgeEl.className = 'badge badge-gray';
    } else if (appState.draftCards.length === 1) {
      badgeEl.textContent = getScenarioLabel(appState.draftCards[0].scenarioType);
      badgeEl.className = 'badge badge-blue';
    } else {
      badgeEl.textContent = `${appState.draftCards.length} Simultaneous Disruptions Selected`;
      badgeEl.className = 'badge badge-blue';
    }

    const addBtn = document.getElementById('btnAddFailureQueue');
    addBtn.textContent = appState.editingQueueId ? 'Update Queued Failure' : 'Add to Failure Queue';
    document.getElementById('builderEditingNote').textContent = appState.editingQueueId
      ? `Editing queued disruption ${appState.editingQueueId}. Update fields below and click "Update Queued Failure".`
      : appState.draftCards.length === 0
        ? 'Select one or more disruption types to configure and preview impact.'
        : 'Configure dates, time periods, and resources in each card below.';
  }

  function optionsHtml(items, selectedVal, placeholderLabel = '') {
    let opts = '';
    if (placeholderLabel) {
      opts += `<option value="" ${!isNonEmpty(selectedVal) ? 'selected' : ''}>${escapeHtml(placeholderLabel)}</option>`;
    }
    opts += items.map((item) => {
      const val = typeof item === 'object' ? item.value : item;
      const lbl = typeof item === 'object' ? item.label : item;
      return `<option value="${escapeHtml(val)}" ${isNonEmpty(selectedVal) && String(val) === String(selectedVal) ? 'selected' : ''}>${escapeHtml(lbl)}</option>`;
    }).join('');
    return opts;
  }

  function renderCalendarWidget(cardId, targetObj, entryIdx = null, singleOnly = false) {
    const year = targetObj._calYear ?? todayDate.getFullYear();
    const month = targetObj._calMonth ?? todayDate.getMonth();
    const mode = singleOnly ? 'single' : (targetObj._calMode || 'multi');
    const selectedDates = singleOnly
      ? (targetObj.date || targetObj.proposedDate ? [targetObj.date || targetObj.proposedDate] : [])
      : (Array.isArray(targetObj.dates) ? targetObj.dates : []);
    const selectedSet = new Set(selectedDates);

    const monthName = new Date(year, month, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayISO = toISODate(todayDate);

    const entryAttr = entryIdx !== null ? `data-entry-idx="${entryIdx}"` : '';
    const dows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    let gridHtml = dows.map((d) => `<div class="cal-dow">${d}</div>`).join('');
    for (let i = 0; i < firstDow; i++) {
      gridHtml += `<div></div>`;
    }
    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const iso = toISODate(new Date(year, month, dayNum));
      const dow = new Date(year, month, dayNum).getDay();
      const isWeekend = dow === 0 || dow === 6;
      const isSel = selectedSet.has(iso);
      const isRangeEdge = targetObj._rangeStart === iso;
      const isToday = iso === todayISO;
      gridHtml += `
        <button type="button"
          class="cal-day-btn ${isWeekend ? 'weekend' : ''} ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''} ${isRangeEdge ? 'range-edge' : ''}"
          data-cal-date="${iso}" data-card-id="${cardId}" ${entryAttr}
          title="${escapeHtml(formatDateDMY(iso))} (${getWeekdayName(iso)})">
          ${dayNum}
        </button>
      `;
    }

    const chipsHtml = selectedDates.map((iso) => `
      <span class="chip-tag">
        ${escapeHtml(formatDateDMY(iso))} (${escapeHtml(getWeekdayName(iso))})
        <button type="button" class="cal-remove-date" data-card-id="${cardId}" ${entryAttr} data-remove-date="${iso}" aria-label="Remove date">&times;</button>
      </span>
    `).join('');

    const hasNoActivitiesOnDates = selectedDates.length > 0 && selectedDates.every((d) => Engine.getActivitiesOnDate(baseState, d).length === 0);

    return `
      <div class="calendar-box">
        <div class="calendar-toolbar">
          <div class="calendar-nav-group">
            <button type="button" class="btn btn-sm btn-ghost cal-nav-btn" data-card-id="${cardId}" ${entryAttr} data-cal-delta="-12" title="Previous Year">&laquo;</button>
            <button type="button" class="btn btn-sm btn-ghost cal-nav-btn" data-card-id="${cardId}" ${entryAttr} data-cal-delta="-1" title="Previous Month">&lsaquo;</button>
            <span class="calendar-month-label">${escapeHtml(monthName)}</span>
            <button type="button" class="btn btn-sm btn-ghost cal-nav-btn" data-card-id="${cardId}" ${entryAttr} data-cal-delta="1" title="Next Month">&rsaquo;</button>
            <button type="button" class="btn btn-sm btn-ghost cal-nav-btn" data-card-id="${cardId}" ${entryAttr} data-cal-delta="12" title="Next Year">&raquo;</button>
          </div>
          <div class="calendar-mode-group">
            ${singleOnly ? `<span class="badge badge-gray">Single Date</span>` : `
              <button type="button" class="cal-mode-btn ${mode === 'single' ? 'active' : ''}" data-card-id="${cardId}" ${entryAttr} data-cal-mode="single">Single</button>
              <button type="button" class="cal-mode-btn ${mode === 'multi' ? 'active' : ''}" data-card-id="${cardId}" ${entryAttr} data-cal-mode="multi">Multi</button>
              <button type="button" class="cal-mode-btn ${mode === 'range' ? 'active' : ''}" data-card-id="${cardId}" ${entryAttr} data-cal-mode="range">Range</button>
            `}
            ${selectedDates.length > 0 ? `<button type="button" class="btn btn-sm btn-ghost cal-clear-btn" data-card-id="${cardId}" ${entryAttr}>Clear</button>` : ''}
          </div>
        </div>
        ${mode === 'range' && targetObj._rangeStart ? `<div class="muted" style="font-size:11px; margin-bottom:4px;">Range start: <strong>${formatDateDMY(targetObj._rangeStart)}</strong> — click an end date.</div>` : ''}
        <div class="calendar-grid">${gridHtml}</div>
        <div class="selected-chips-row">
          ${chipsHtml || `<span class="muted" style="font-size:11.5px;">No date selected. Click calendar dates above.</span>`}
        </div>
        ${hasNoActivitiesOnDates ? `<div class="validation-warn">No scheduled activities on this date (weekend or non-instructional date).</div>` : ''}
      </div>
    `;
  }

  function renderTimePeriodsWidget(cardId, targetObj, entryIdx = null, allowOvernight = false) {
    const entryAttr = entryIdx !== null ? `data-entry-idx="${entryIdx}"` : '';
    const dates = Array.isArray(targetObj.dates) ? targetObj.dates : [];
    const perDate = Boolean(targetObj.perDateTimes) && dates.length > 1;
    const fullDay = Boolean(targetObj.fullDay) && !perDate;

    function renderPeriodList(periods, dateKey = '') {
      const dateAttr = dateKey ? `data-date-key="${dateKey}"` : '';
      const valRes = Engine.validateTimePeriods(periods, { allowOvernight });
      const rows = periods.map((p, idx) => `
        <div class="time-period-row">
          <label class="muted" style="font-size:11.5px;">Start:</label>
          <input type="time" class="time-input tp-input" data-card-id="${cardId}" ${entryAttr} ${dateAttr} data-tp-idx="${idx}" data-tp-field="startTime" value="${escapeHtml(p.startTime || '')}" ${fullDay ? 'disabled' : ''}>
          <label class="muted" style="font-size:11.5px;">End:</label>
          <input type="time" class="time-input tp-input" data-card-id="${cardId}" ${entryAttr} ${dateAttr} data-tp-idx="${idx}" data-tp-field="endTime" value="${escapeHtml(p.endTime || '')}" ${fullDay ? 'disabled' : ''}>
          ${!fullDay && periods.length > 1 ? `<button type="button" class="btn btn-sm btn-ghost tp-remove-btn" data-card-id="${cardId}" ${entryAttr} ${dateAttr} data-tp-idx="${idx}">Remove</button>` : ''}
        </div>
      `).join('');

      const errHtml = !valRes.valid && periods.some((p) => p.startTime || p.endTime)
        ? `<div class="validation-msg">${escapeHtml(valRes.errors.join(' '))}</div>`
        : valRes.hasOverlaps
          ? `<div class="validation-warn">Overlapping periods detected — engine merges them automatically during simulation.</div>`
          : '';

      return `
        ${rows}
        ${!fullDay ? `<button type="button" class="btn btn-sm btn-outline tp-add-btn" data-card-id="${cardId}" ${entryAttr} ${dateAttr}>+ Add Another Time Period</button>` : ''}
        ${errHtml}
      `;
    }

    let bodyHtml = '';
    if (perDate) {
      bodyHtml = dates.map((dStr) => {
        const list = targetObj.dateTimePeriods?.[dStr] || [{ startTime: '', endTime: '' }];
        return `
          <div class="faculty-slot-subcard">
            <div style="font-size:12px; font-weight:700; margin-bottom:6px;">${escapeHtml(formatDateDMY(dStr))} (${escapeHtml(getWeekdayName(dStr))})</div>
            ${renderPeriodList(list, dStr)}
          </div>
        `;
      }).join('');
    } else {
      bodyHtml = renderPeriodList(targetObj.timePeriods || [{ startTime: '', endTime: '' }]);
    }

    return `
      <div class="time-periods-box">
        <div class="time-periods-header">
          <span style="font-size:12px; font-weight:700; color:var(--text-secondary);">Unavailable Time Periods ${allowOvernight ? '(Overnight Supported)' : ''}</span>
          <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
            <label style="display:inline-flex; align-items:center; gap:5px; font-size:12px; margin:0; cursor:pointer;">
              <input type="checkbox" class="tp-fullday-cb" data-card-id="${cardId}" ${entryAttr} ${fullDay ? 'checked' : ''} ${perDate ? 'disabled' : ''}>
              <span>Full Day (${Engine.formatTime12h(OPERATING_HOURS.startTime)} – ${Engine.formatTime12h(OPERATING_HOURS.endTime)})</span>
            </label>
            ${dates.length > 1 ? `
              <label style="display:inline-flex; align-items:center; gap:5px; font-size:12px; margin:0; cursor:pointer;">
                <input type="checkbox" class="tp-perdate-cb" data-card-id="${cardId}" ${entryAttr} ${perDate ? 'checked' : ''}>
                <span>Separate Times per Date</span>
              </label>
            ` : ''}
          </div>
        </div>
        ${bodyHtml}
      </div>
    `;
  }

  function renderSearchableMultiPicker(card, fieldName, items, placeholder) {
    const selectedIds = Array.isArray(card[fieldName]) ? card[fieldName] : [];
    const q = (card._searchQuery || '').trim().toLowerCase();
    const filtered = items.filter((it) => `${it.id} ${it.label}`.toLowerCase().includes(q));

    const chips = selectedIds.map((id) => {
      const found = items.find((x) => x.id === id);
      return `
        <span class="chip-tag">
          ${escapeHtml(id)}${found ? ` — ${escapeHtml(found.short || '')}` : ''}
          <button type="button" class="picker-remove-chip" data-card-id="${card._cid}" data-picker-field="${fieldName}" data-item-id="${escapeHtml(id)}">&times;</button>
        </span>
      `;
    }).join('');

    return `
      <div class="searchable-picker">
        <input type="text" class="text-input full-width picker-search-input" data-card-id="${card._cid}" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(card._searchQuery || '')}">
        <div class="searchable-picker-list">
          ${filtered.map((it) => `
            <div class="picker-option">
              <label>
                <input type="checkbox" class="picker-item-cb" data-card-id="${card._cid}" data-picker-field="${fieldName}" value="${escapeHtml(it.id)}" ${selectedIds.includes(it.id) ? 'checked' : ''}>
                <span><strong>${escapeHtml(it.id)}</strong> — ${escapeHtml(it.label)}</span>
              </label>
              <span class="badge badge-gray">${escapeHtml(it.meta || '')}</span>
            </div>
          `).join('') || `<div class="picker-option muted">No matching records.</div>`}
        </div>
        <div class="selected-chips-row">
          ${chips || `<span class="muted" style="font-size:11.5px;">None selected.</span>`}
        </div>
      </div>
    `;
  }

  function renderDisruptionCardBody(card) {
    const t = card.scenarioType;
    const cid = card._cid;

    if (t === 'SCN-FACULTY-ABSENCE') {
      const availFac = card.department === 'ALL'
        ? baseState.faculty
        : card.department
          ? baseState.faculty.filter((f) => f.department === card.department)
          : [];
      const maxCount = Math.max(1, availFac.length);
      const count = Math.min(maxCount, Math.max(1, Number(card.facultyCount) || 1));
      card.facultyCount = count;

      const searchQ = (card._searchQuery || '').trim().toLowerCase();
      const filteredFac = availFac.filter((f) => `${f.id} ${f.name} ${f.department}`.toLowerCase().includes(searchQ));

      while (card.facultyIds.length < count) card.facultyIds.push('');
      if (card.facultyIds.length > count) card.facultyIds = card.facultyIds.slice(0, count);
      while (card.facultyEntries.length < count) {
        card.facultyEntries.push({
          facultyId: '',
          reason: '',
          dates: [],
          fullDay: false,
          perDateTimes: false,
          timePeriods: [{ startTime: '', endTime: '' }],
          dateTimePeriods: {},
          _calYear: todayDate.getFullYear(),
          _calMonth: todayDate.getMonth(),
          _calMode: 'multi',
          _rangeStart: null
        });
      }
      if (card.facultyEntries.length > count) card.facultyEntries = card.facultyEntries.slice(0, count);

      const chosenSet = new Set(
        (card.scheduleMode === 'individual' ? card.facultyEntries.map((e) => e.facultyId) : card.facultyIds).filter(Boolean)
      );

      let facultyRowsHtml = '';
      if (card.scheduleMode === 'individual') {
        facultyRowsHtml = card.facultyEntries.map((entry, idx) => {
          const pool = filteredFac.filter((f) => f.id === entry.facultyId || !chosenSet.has(f.id));
          return `
            <div class="faculty-slot-subcard">
              <div class="dynamic-form-grid" style="padding:0; border:none; background:transparent; margin-bottom:10px;">
                <div class="form-field">
                  <label>Faculty Member ${idx + 1} *</label>
                  <select class="select-input fac-member-select" data-card-id="${cid}" data-fac-idx="${idx}" ${card.department ? '' : 'disabled'}>
                    ${optionsHtml(pool.map((f) => ({ value: f.id, label: `${f.id} — ${f.name} (${f.department})` })), entry.facultyId, card.department ? `Select Faculty Member ${idx + 1}...` : 'Select department first...')}
                  </select>
                </div>
                <div class="form-field">
                  <label>Absence Reason *</label>
                  <select class="select-input fac-entry-reason" data-card-id="${cid}" data-fac-idx="${idx}">
                    ${optionsHtml(['Medical Leave', 'Emergency Travel', 'Academic Conference', 'Personal Emergency'], entry.reason, 'Select reason...')}
                  </select>
                </div>
              </div>
              ${renderCalendarWidget(cid, entry, idx, false)}
              <div style="margin-top:8px;">${renderTimePeriodsWidget(cid, entry, idx, false)}</div>
            </div>
          `;
        }).join('');
      } else {
        const selectsHtml = card.facultyIds.map((fId, idx) => {
          const pool = filteredFac.filter((f) => f.id === fId || !chosenSet.has(f.id));
          return `
            <div class="form-field">
              <label>Faculty Member ${idx + 1} *</label>
              <select class="select-input fac-member-select" data-card-id="${cid}" data-fac-idx="${idx}" ${card.department ? '' : 'disabled'}>
                ${optionsHtml(pool.map((f) => ({ value: f.id, label: `${f.id} — ${f.name} (${f.department})` })), fId, card.department ? `Select Faculty Member ${idx + 1}...` : 'Select department first...')}
              </select>
            </div>
          `;
        }).join('');

        facultyRowsHtml = `
          <div class="dynamic-form-grid">${selectsHtml}</div>
          <div class="form-field">
            <label>Absence Reason *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="reason">
              ${optionsHtml(['Medical Leave', 'Emergency Travel', 'Academic Conference', 'Personal Emergency'], card.reason, 'Select reason...')}
            </select>
          </div>
          <div>
            <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:5px;">Absence Dates (Calendar) *</label>
            ${renderCalendarWidget(cid, card, null, false)}
          </div>
          ${renderTimePeriodsWidget(cid, card, null, false)}
        `;
      }

      const countOpts = Array.from({ length: Math.min(10, maxCount) }, (_, i) => ({ value: i + 1, label: `${i + 1} Faculty Member${i > 0 ? 's' : ''}` }));
      return `
        <div class="dynamic-form-grid">
          <div class="form-field">
            <label>Department *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="department">
              ${optionsHtml([
                { value: 'ALL', label: `All Departments (${baseState.faculty.length} Faculty)` },
                ...baseState.departments.map((d) => ({ value: d.code, label: `${d.code} — ${d.name}` }))
              ], card.department, 'Select department...')}
            </select>
          </div>
          <div class="form-field">
            <label>Number of Absent Faculty (Max ${availFac.length || 0}) *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="facultyCount" data-num="true" ${card.department ? '' : 'disabled'}>
              ${optionsHtml(countOpts, count)}
            </select>
          </div>
          <div class="form-field">
            <label>Search Faculty List</label>
            <input type="text" class="text-input picker-search-input" data-card-id="${cid}" placeholder="Search faculty by ID or name..." value="${escapeHtml(card._searchQuery || '')}" ${card.department ? '' : 'disabled'}>
          </div>
          <div class="form-field">
            <label>Schedule Mode</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="scheduleMode">
              ${optionsHtml([
                { value: 'shared', label: 'Shared Schedule (Same Dates & Times)' },
                { value: 'individual', label: 'Individual Schedule (Per Faculty)' }
              ], card.scheduleMode)}
            </select>
          </div>
        </div>
        ${facultyRowsHtml}
      `;
    }

    if (t === 'SCN-LAB-FAILURE') {
      const labsPool = card.department === 'ALL'
        ? baseState.labs
        : card.department
          ? baseState.labs.filter((l) => l.department === card.department)
          : [];
      return `
        <div class="dynamic-form-grid">
          <div class="form-field">
            <label>Department *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="department">
              ${optionsHtml([
                { value: 'ALL', label: `All Departments (${baseState.labs.length} Labs)` },
                ...baseState.departments.map((d) => ({ value: d.code, label: `${d.code} — ${d.name}` }))
              ], card.department, 'Select department...')}
            </select>
          </div>
          <div class="form-field">
            <label>Failure Type *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="failureType">
              ${optionsHtml([
                { value: 'equipment', label: 'Equipment Failure' },
                { value: 'server', label: 'Server Cluster Failure' },
                { value: 'network', label: 'Network Switch Failure' },
                { value: 'cooling', label: 'HVAC / Cooling Failure' }
              ], card.failureType, 'Select failure type...')}
            </select>
          </div>
          <div class="form-field span-2">
            <label>Equipment Unavailable (%) *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="equipmentUnavailablePct" data-num="true">
              ${optionsHtml([
                { value: 10, label: '10% Unavailable (90% Equipment Operational)' },
                { value: 20, label: '20% Unavailable (80% Equipment Operational)' },
                { value: 35, label: '35% Unavailable (65% Equipment Operational)' },
                { value: 50, label: '50% Unavailable (50% Equipment Operational)' },
                { value: 75, label: '75% Unavailable (Critical)' },
                { value: 100, label: '100% Unavailable (Full Outage)' }
              ], card.equipmentUnavailablePct, 'Select availability impact...')}
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:5px;">Select Laboratories (${card.labIds.length} selected) *</label>
          ${card.department ? renderSearchableMultiPicker(card, 'labIds', labsPool.map((l) => ({ id: l.id, label: `${l.name} (Cap: ${l.capacity})`, short: l.name, meta: l.department })), 'Search laboratories...') : `<div class="muted">Select a department first to list laboratories.</div>`}
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:5px;">Failure Dates *</label>
          ${renderCalendarWidget(cid, card, null, false)}
        </div>
        ${renderTimePeriodsWidget(cid, card, null, false)}
      `;
    }

    if (t === 'SCN-CLASSROOM-UNAVAILABLE') {
      const buildings = [...new Set(baseState.classrooms.map((c) => c.block))];
      const roomsPool = card.building === 'ALL'
        ? baseState.classrooms
        : card.building
          ? baseState.classrooms.filter((c) => c.block === card.building)
          : [];
      return `
        <div class="dynamic-form-grid">
          <div class="form-field">
            <label>Building *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="building">
              ${optionsHtml([{ value: 'ALL', label: 'All Campus Buildings (25 Rooms)' }, ...buildings.map((b) => ({ value: b, label: b }))], card.building, 'Select building...')}
            </select>
          </div>
          <div class="form-field">
            <label>Failure Reason *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="reason">
              ${optionsHtml(['HVAC Failure', 'Structural Maintenance', 'Projector / Smartboard Fault', 'Safety Inspection'], card.reason, 'Select reason...')}
            </select>
          </div>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:5px;">Select Classrooms (${card.classroomIds.length} selected) *</label>
          ${card.building ? renderSearchableMultiPicker(card, 'classroomIds', roomsPool.map((r) => ({ id: r.id, label: `${r.name} (Cap: ${r.capacity})`, short: r.name, meta: r.block })), 'Search classrooms...') : `<div class="muted">Select a building first to list classrooms.</div>`}
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:5px;">Unavailable Dates *</label>
          ${renderCalendarWidget(cid, card, null, false)}
        </div>
        ${renderTimePeriodsWidget(cid, card, null, false)}
      `;
    }

    if (t === 'SCN-BUS-BREAKDOWN') {
      const selectedBuses = baseState.buses.filter((b) => card.busIds.includes(b.id));
      const delayMins = (card.startTime && card.restorationTime) ? Engine.computeDurationMinutes(card.startTime, card.restorationTime, false) : 0;
      return `
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:5px;">Select Buses (${card.busIds.length} selected) *</label>
          ${renderSearchableMultiPicker(card, 'busIds', baseState.buses.map((b) => ({ id: b.id, label: `${b.route} (${b.studentLoad}/${b.capacity} riders)`, short: b.route, meta: `${b.linkedFaculty.length} Fac` })), 'Search bus number or route...')}
        </div>
        <div class="readonly-field" style="font-size:12px;">
          <strong>Fetched Route &amp; Capacity Details:</strong>
          ${selectedBuses.length
            ? selectedBuses.map((b) => `${b.id}: ${b.route} (${b.studentLoad}/${b.capacity} riders, ${b.linkedFaculty.length} faculty)`).join(' | ')
            : 'Select one or more buses above to auto-load routes, linked faculty, and passenger capacity.'}
        </div>
        <div class="dynamic-form-grid">
          <div class="form-field">
            <label>Breakdown Type *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="breakdownType">
              ${optionsHtml(['Engine Fault', 'Tire / Axle Failure', 'Traffic / Route Blockage', 'Fuel / Electrical Fault'], card.breakdownType, 'Select breakdown type...')}
            </select>
          </div>
          <div class="form-field">
            <label>Spare Bus Availability *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="spareBusAvailable" data-bool="true">
              ${optionsHtml([
                { value: 'false', label: 'No Spare Bus (Fleet Capacity Only)' },
                { value: 'true', label: 'Standby Spare Bus Available (75 Seats)' }
              ], isNonEmpty(card.spareBusAvailable) ? String(Boolean(card.spareBusAvailable)) : '', 'Select spare bus option...')}
            </select>
          </div>
          <div class="form-field">
            <label>Breakdown Start Time *</label>
            <input type="time" class="time-input card-field" data-card-id="${cid}" data-cfg="startTime" value="${escapeHtml(card.startTime || '')}">
          </div>
          <div class="form-field">
            <label>Expected Restoration Time * ${delayMins > 0 ? `(${delayMins} min delay)` : ''}</label>
            <input type="time" class="time-input card-field" data-card-id="${cid}" data-cfg="restorationTime" value="${escapeHtml(card.restorationTime || '')}">
          </div>
        </div>
        ${(card.startTime && card.restorationTime && delayMins <= 0) ? `<div class="validation-msg">Expected restoration time must be later than breakdown start time.</div>` : ''}
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:5px;">Breakdown Date *</label>
          ${renderCalendarWidget(cid, card, null, true)}
        </div>
      `;
    }

    if (t === 'SCN-EXAM-HALL-FAILURE') {
      const examHalls = baseState.classrooms.filter((c) => c.type === 'exam-hall' || c.type === 'auditorium');
      const selectedHall = examHalls.find((r) => r.id === card.roomId);
      const matchingExams = card.roomId ? baseState.examinations.filter((e) => e.roomId === card.roomId) : [];
      const examOpts = card.roomId
        ? [
            { value: 'ALL', label: `All Exams in ${card.roomId} (${matchingExams.length})` },
            ...baseState.examinations.map((e) => ({
              value: e.id,
              label: `${e.id} — ${e.title} (${formatDateDMY(e.scheduledDate)}, ${e.day} ${e.slotId})`
            }))
          ]
        : [];
      return `
        <div class="dynamic-form-grid">
          <div class="form-field">
            <label>Examination Hall *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="roomId">
              ${optionsHtml(examHalls.map((r) => ({ value: r.id, label: `${r.id} — ${r.name} (Cap: ${r.capacity})` })), card.roomId, 'Select examination hall...')}
            </select>
          </div>
          <div class="form-field">
            <label>Relevant Scheduled Examination *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="examId" ${card.roomId ? '' : 'disabled'}>
              ${optionsHtml(examOpts, card.examId, card.roomId ? 'Select examination...' : 'Select exam hall first...')}
            </select>
          </div>
          <div class="form-field">
            <label>Failure Reason *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="reason">
              ${optionsHtml(['Power & Lighting Outage', 'Furniture / Seating Damage', 'Water Leakage', 'Security / Seal Issue'], card.reason, 'Select reason...')}
            </select>
          </div>
          <div class="form-field">
            <label>Available Seating Capacity ${selectedHall ? `(0 – ${selectedHall.capacity})` : ''} *</label>
            <input type="number" min="0" max="${selectedHall ? selectedHall.capacity : 140}" class="text-input card-field" data-card-id="${cid}" data-cfg="availableSeating" data-num="true" placeholder="Enter usable seats..." value="${card.availableSeating !== '' && card.availableSeating !== undefined ? card.availableSeating : ''}" ${selectedHall ? '' : 'disabled'}>
          </div>
        </div>
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:5px;">Failure Dates *</label>
          ${renderCalendarWidget(cid, card, null, false)}
        </div>
        ${renderTimePeriodsWidget(cid, card, null, false)}
      `;
    }

    if (t === 'SCN-POWER-FAILURE') {
      const zones = card.powerZone === 'ALL_ZONES' ? ['PZ-1', 'PZ-2', 'PZ-3'] : (card.powerZone ? [card.powerZone] : []);
      const depRooms = baseState.classrooms.filter((c) => zones.includes(c.powerZone));
      const depLabs = baseState.labs.filter((l) => zones.includes(l.powerZone));
      const depHostels = baseState.hostels.filter((h) => zones.includes(h.powerZone));
      const depBlocks = [...new Set([...depRooms, ...depLabs, ...depHostels].map((x) => x.block || x.name))];

      return `
        <div class="dynamic-form-grid">
          <div class="form-field">
            <label>Power Zone *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="powerZone">
              ${optionsHtml([
                { value: 'PZ-1', label: 'PZ-1 (Blocks A & B, Exam Hall Alpha, Auditorium, Core IT)' },
                { value: 'PZ-2', label: 'PZ-2 (Blocks C & D, Exam Halls Beta & Gamma, Girls Hostels)' },
                { value: 'PZ-3', label: 'PZ-3 (Block E, Seminar Hall, Civil/EEE Labs, Boys Hostels)' },
                { value: 'ALL_ZONES', label: 'ALL ZONES (Campus-Wide Blackout)' }
              ], card.powerZone, 'Select power zone...')}
            </select>
          </div>
          <div class="form-field">
            <label>Failure Source *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="failureSource">
              ${optionsHtml(['Main Substation (ADM-02)', 'Zone Feeder Breaker', 'Transformer Trip', 'Grid Utility Blackout'], card.failureSource, 'Select failure source...')}
            </select>
          </div>
          <div class="form-field">
            <label>Backup Power Availability *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="backupAvailable" data-bool="true">
              ${optionsHtml([
                { value: 'false', label: 'No Backup Generator Active' },
                { value: 'true', label: 'Diesel / Solar Backup Active' }
              ], isNonEmpty(card.backupAvailable) ? String(Boolean(card.backupAvailable)) : '', 'Select backup availability...')}
            </select>
          </div>
          <div class="form-field">
            <label>Backup Power Capacity (%)</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="backupCapacityPct" data-num="true" ${card.backupAvailable === true ? '' : 'disabled'}>
              ${optionsHtml([
                { value: 0, label: '0% (No Load Shielded)' },
                { value: 30, label: '30% (Exam Halls & Core IT Only)' },
                { value: 50, label: '50% (Exams, Auditoriums, Hostels & IT)' },
                { value: 75, label: '75% (All Except Heavy Labs)' },
                { value: 100, label: '100% (Full Campus Backup)' }
              ], card.backupAvailable === true ? card.backupCapacityPct : (card.backupAvailable === false ? 0 : ''), 'Select capacity...')}
            </select>
          </div>
        </div>
        ${zones.length ? `
          <div class="readonly-field" style="font-size:12px;">
            <strong>Dependent Assets in ${escapeHtml(card.powerZone)}:</strong>
            ${depBlocks.length ? `Buildings/Hostels: ${escapeHtml(depBlocks.join(', '))} • ` : ''}
            ${depRooms.length} Classrooms • ${depLabs.length} Labs • ${depHostels.length} Hostels
            ${zones.includes('PZ-1') ? ' • Core IT (ADM-05)' : ''}
          </div>
        ` : ''}
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:5px;">Outage Dates *</label>
          ${renderCalendarWidget(cid, card, null, false)}
        </div>
        ${renderTimePeriodsWidget(cid, card, null, true)}
      `;
    }

    if (t === 'SCN-PLACEMENT-EXAM-CONFLICT') {
      const exm = card.examId ? baseState.examinations.find((e) => e.id === card.examId) : null;
      const exmSlot = exm ? SLOTS.find((s) => s.id === exm.slotId) : null;
      const timeValid = (card.proposedStartTime && card.proposedEndTime)
        ? Engine.validateTimePeriods([{ startTime: card.proposedStartTime, endTime: card.proposedEndTime }], { allowOvernight: false })
        : { valid: true };
      return `
        <div class="dynamic-form-grid">
          <div class="form-field">
            <label>Placement Drive *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="placementId">
              ${optionsHtml(baseState.placements.map((p) => ({ value: p.id, label: `${p.id} — ${p.company} (${p.sectionId})` })), card.placementId, 'Select placement drive...')}
            </select>
          </div>
          <div class="form-field">
            <label>Examination *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="examId">
              ${optionsHtml(baseState.examinations.map((e) => ({ value: e.id, label: `${e.id} — ${e.title} (${e.sectionId})` })), card.examId, 'Select examination...')}
            </select>
          </div>
          <div class="form-field span-2">
            <label>Existing Examination Schedule</label>
            <div class="readonly-field" style="font-size:12px;">
              ${exm && exmSlot
                ? `${exm.id}: ${formatDateDMY(exm.scheduledDate)} (${exm.day}) • ${Engine.formatTime12h(exmSlot.startTime)}–${Engine.formatTime12h(exmSlot.endTime)} • Room ${exm.roomId} • ${exm.sectionId} (${exm.studentCount} candidates)`
                : 'Select an examination above to display its scheduled date, time, and hall.'}
            </div>
          </div>
          <div class="form-field">
            <label>Proposed Placement Start Time *</label>
            <input type="time" class="time-input card-field" data-card-id="${cid}" data-cfg="proposedStartTime" value="${escapeHtml(card.proposedStartTime || '')}">
          </div>
          <div class="form-field">
            <label>Proposed Placement End Time *</label>
            <input type="time" class="time-input card-field" data-card-id="${cid}" data-cfg="proposedEndTime" value="${escapeHtml(card.proposedEndTime || '')}">
          </div>
          <div class="form-field span-2">
            <label>Rescheduling Priority Policy *</label>
            <select class="select-input card-field" data-card-id="${cid}" data-cfg="reschedulingPriority">
              ${optionsHtml([
                { value: 'EXAM_FIRST', label: 'Examination Priority (Keep Exam Fixed, Reschedule Placement)' },
                { value: 'PLACEMENT_FIRST', label: 'Placement Priority (Keep Company Drive Fixed, Reschedule Exam)' },
                { value: 'BALANCED', label: 'Balanced Institutional Priority (Minimize Student/Room Impact)' }
              ], card.reschedulingPriority, 'Select priority policy...')}
            </select>
          </div>
        </div>
        ${(!timeValid.valid && (card.proposedStartTime || card.proposedEndTime)) ? `<div class="validation-msg">${escapeHtml(timeValid.errors.join(' '))}</div>` : ''}
        <div>
          <label style="font-size:12px; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:5px;">Proposed Placement Date *</label>
          ${renderCalendarWidget(cid, card, null, true)}
        </div>
      `;
    }

    return '';
  }

  function renderDisruptionCards() {
    const container = document.getElementById('disruptionCardsContainer');
    if (appState.draftCards.length === 0) {
      container.innerHTML = `<div class="builder-empty-state">Select a disruption scenario to configure and preview its impact.</div>`;
      return;
    }

    container.innerHTML = appState.draftCards.map((card, idx) => {
      const val = validateCard(card);
      let previewHtml = '';
      if (!val.valid) {
        previewHtml = `<div class="muted">${escapeHtml(val.errors[0])}</div>`;
      } else {
        const res = Engine.simulateFromConfigs(baseState, [cardToEngineConfig(card)]);
        const m = res.metrics;
        if (res.noScheduledActivitiesOnly) {
          previewHtml = `<span class="badge badge-gray">No scheduled activities on this date</span>`;
        } else {
          previewHtml = `
            <div class="preview-stat-row" style="margin-bottom:0;">
              <span class="badge badge-blue">Estimated Impact — Not Yet Applied</span>
              <span class="badge badge-red">Impacted Sessions: ${m.impactedSessionsCount}</span>
              <span class="badge badge-orange">Affected Students: ${m.affectedStudents}</span>
              <span class="badge badge-gray">Est. Health: ${m.campusHealthPct}%</span>
            </div>
          `;
        }
      }

      return `
        <div class="disruption-config-card ${card._collapsed ? 'collapsed' : ''}" data-card-wrap="${card._cid}">
          <div class="disruption-card-header" data-toggle-card="${card._cid}">
            <div class="disruption-card-title">
              <span>${card._collapsed ? '&#9654;' : '&#9660;'}</span>
              <span>#${idx + 1} ${escapeHtml(getScenarioLabel(card.scenarioType))}</span>
              <span class="badge ${val.valid ? 'badge-green' : 'badge-orange'}">${val.valid ? 'Valid' : 'Incomplete'}</span>
            </div>
            <div class="action-group">
              <button type="button" class="btn btn-sm btn-outline card-queue-one-btn" data-card-id="${card._cid}" ${val.valid ? '' : 'disabled'}>Add to Queue</button>
              <button type="button" class="btn btn-sm btn-ghost card-remove-btn" data-card-id="${card._cid}">Remove Disruption</button>
            </div>
          </div>
          <div class="disruption-card-body">
            ${renderDisruptionCardBody(card)}
            ${val.warnings.length ? `<div class="validation-warn">${escapeHtml(val.warnings[0])}</div>` : ''}
            <div class="card-preview-strip">${previewHtml}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderCombinedImpactPreview() {
    const previewWrap = document.getElementById('dynamicImpactPreview');
    const validConfigs = getValidDraftConfigs();

    if (appState.draftCards.length === 0 || validConfigs.length === 0) {
      const msg = appState.draftCards.length === 0
        ? 'Select a disruption scenario to configure and preview its impact.'
        : 'Complete all required configuration fields above to calculate the combined estimated impact.';
      previewWrap.innerHTML = `
        <div class="preview-header-row">
          <h3>Combined Live Affected-Resource Preview</h3>
          <span class="badge badge-gray">Estimated Impact — Not Yet Applied</span>
        </div>
        <div class="preview-stat-row">
          <span class="badge badge-gray">Impacted Sessions: 0</span>
          <span class="badge badge-gray">Affected Students: 0</span>
          <span class="badge badge-green">Campus Health: 100%</span>
        </div>
        <div class="preview-list">
          <div class="muted">${escapeHtml(msg)}</div>
        </div>
      `;
      return;
    }

    const previewCascade = Engine.simulateFromConfigs(baseState, validConfigs);
    const occs = previewCascade.impactedOccurrences;
    const m = previewCascade.metrics;

    const listHtml = previewCascade.noScheduledActivitiesOnly
      ? `<div class="validation-warn">No scheduled activities on this date.</div>`
      : occs.slice(0, 8).map((occ) => `
          <div class="preview-item">
            <span><strong>${escapeHtml(occ.activity.id)}</strong> (${escapeHtml(occ.occurrenceDateDMY)}) • ${escapeHtml(occ.activity.title)} (${escapeHtml(occ.activity.sectionId)})</span>
            <span class="badge badge-orange">${occ.weekday} ${occ.activity.slotId} • ${escapeHtml(occ.activity.roomId)}</span>
          </div>
        `).join('') + (occs.length > 8 ? `<div class="muted" style="font-size:11.5px;">+ ${occs.length - 8} more impacted session occurrence(s)</div>` : '');

    previewWrap.innerHTML = `
      <div class="preview-header-row">
        <h3>Combined Live Affected-Resource Preview</h3>
        <span class="badge badge-blue">Estimated Impact — Not Yet Applied</span>
      </div>
      <div class="preview-stat-row">
        <span class="badge badge-red">Impacted Sessions: ${m.impactedSessionsCount}</span>
        <span class="badge badge-orange">Affected Students: ${m.affectedStudents}</span>
        <span class="badge badge-gray">Est. Campus Health: ${m.campusHealthPct}%</span>
        <span class="badge badge-gray">Valid Configs: ${validConfigs.length}</span>
      </div>
      <div class="preview-list">
        ${listHtml || `<div class="muted">No scheduled academic sessions fail under the selected date(s) and time period(s).</div>`}
      </div>
    `;
  }

  function formatPeriodsSummary(obj) {
    if (obj.fullDay && !obj.perDateTimes) return 'Full Day (09:00 AM–03:30 PM)';
    if (obj.perDateTimes) return 'Custom Times per Date';
    return (obj.timePeriods || [])
      .filter((p) => p.startTime && p.endTime)
      .map((p) => `${Engine.formatTime12h(p.startTime)}–${Engine.formatTime12h(p.endTime)}`)
      .join(', ') || 'No time';
  }

  function summarizeConfig(cfg) {
    if (cfg.scenarioType === 'SCN-FACULTY-ABSENCE') {
      if (cfg.scheduleMode === 'individual' && Array.isArray(cfg.facultyEntries)) {
        return cfg.facultyEntries.map((e) => `${e.facultyId} (${(e.dates || []).map(formatDateDMY).join(',')}: ${formatPeriodsSummary(e)})`).join(' | ');
      }
      const fIds = (cfg.facultyIds || [cfg.facultyId]).filter(Boolean).join(', ');
      const dTxt = (cfg.dates || []).map(formatDateDMY).join(', ') || 'Ref Week';
      return `${fIds} (${cfg.department}) • ${cfg.reason} • ${dTxt} • ${formatPeriodsSummary(cfg)}`;
    }
    if (cfg.scenarioType === 'SCN-LAB-FAILURE') {
      const lIds = (cfg.labIds || [cfg.labId]).filter(Boolean).join(', ');
      const dTxt = (cfg.dates || []).map(formatDateDMY).join(', ');
      return `${lIds} • ${cfg.failureType} (${cfg.equipmentUnavailablePct}% unavail.) • ${dTxt} • ${formatPeriodsSummary(cfg)}`;
    }
    if (cfg.scenarioType === 'SCN-CLASSROOM-UNAVAILABLE') {
      const rIds = (cfg.classroomIds || [cfg.classroomId]).filter(Boolean).join(', ');
      const dTxt = (cfg.dates || []).map(formatDateDMY).join(', ');
      return `${rIds} (${cfg.building}) • ${cfg.reason} • ${dTxt} • ${formatPeriodsSummary(cfg)}`;
    }
    if (cfg.scenarioType === 'SCN-BUS-BREAKDOWN') {
      const bIds = (cfg.busIds || [cfg.busId]).filter(Boolean).join(', ');
      const dTxt = cfg.date ? formatDateDMY(cfg.date) : (cfg.dates || []).map(formatDateDMY).join(', ');
      return `${bIds} • ${cfg.breakdownType} • ${dTxt} (${Engine.formatTime12h(cfg.startTime)}–${Engine.formatTime12h(cfg.restorationTime)}) • Spare: ${cfg.spareBusAvailable ? 'Yes' : 'No'}`;
    }
    if (cfg.scenarioType === 'SCN-EXAM-HALL-FAILURE') {
      const dTxt = (cfg.dates || []).map(formatDateDMY).join(', ');
      return `${cfg.roomId} (Exam: ${cfg.examId}) • Usable Seats: ${cfg.availableSeating} • ${dTxt} • ${formatPeriodsSummary(cfg)}`;
    }
    if (cfg.scenarioType === 'SCN-POWER-FAILURE') {
      const dTxt = (cfg.dates || []).map(formatDateDMY).join(', ');
      return `${cfg.powerZone} (${cfg.failureSource}) • ${dTxt} • ${formatPeriodsSummary(cfg)} • Backup: ${cfg.backupAvailable ? `${cfg.backupCapacityPct}%` : 'None'}`;
    }
    if (cfg.scenarioType === 'SCN-PLACEMENT-EXAM-CONFLICT') {
      const dTxt = cfg.proposedDate ? formatDateDMY(cfg.proposedDate) : cfg.conflictDay;
      const tTxt = (cfg.proposedStartTime && cfg.proposedEndTime) ? `${Engine.formatTime12h(cfg.proposedStartTime)}–${Engine.formatTime12h(cfg.proposedEndTime)}` : cfg.conflictSlotId;
      return `${cfg.placementId} vs ${cfg.examId} • ${dTxt} (${tTxt}) • Priority: ${cfg.reschedulingPriority}`;
    }
    return cfg.scenarioType;
  }

  function renderQueuedFailures() {
    const queue = appState.queuedFailureConfigs;
    document.getElementById('queuedFailureCount').textContent = queue.length;
    document.getElementById('queueModeBadge').textContent = queue.length > 1 ? 'Combined Multi-Disruption' : queue.length === 1 ? 'Single Queued' : 'Queue Empty';
    const listEl = document.getElementById('queuedFailuresList');

    if (queue.length === 0) {
      listEl.innerHTML = `<div class="muted" style="padding:8px 0;">Failure queue is empty. Configure disruption cards on the left and click "Add to Failure Queue" or "Run Custom Simulation".</div>`;
    } else {
      listEl.innerHTML = queue.map((cfg) => `
        <div class="queue-item-card ${appState.editingQueueId === cfg._qid ? 'editing' : ''}">
          <div class="queue-item-head">
            <span class="badge badge-red">${escapeHtml(getScenarioLabel(cfg.scenarioType))}</span>
            <div class="queue-item-actions">
              <button type="button" class="btn btn-sm btn-outline edit-queue-btn" data-edit-qid="${escapeHtml(cfg._qid)}">Edit Failure</button>
              <button type="button" class="btn btn-sm btn-ghost remove-queue-btn" data-remove-qid="${escapeHtml(cfg._qid)}">Remove</button>
            </div>
          </div>
          <div style="font-size:12px; color:var(--text-primary); font-weight:500;">${escapeHtml(summarizeConfig(cfg))}</div>
        </div>
      `).join('');
    }

    const combinedPreview = queue.length > 0
      ? Engine.simulateFromConfigs(baseState, queue)
      : appState.cascadeResult;
    const cm = combinedPreview.metrics;
    document.getElementById('customImpactSummary').innerHTML = `
      <div style="border-top:1px solid var(--border-color); padding-top:10px; margin-top:8px; font-size:12.5px;">
        <strong>${queue.length > 0 ? 'Combined Queue Impact (Deduplicated):' : 'Active Campus Simulation:'}</strong><br>
        Campus Health: <strong>${cm.campusHealthPct}%</strong> • Affected Students: <strong>${cm.affectedStudents}</strong> • Impacted Sessions: <strong>${cm.impactedSessionsCount}</strong>
      </div>
    `;
  }

  // ==================== VIEW 4: RECOVERY CENTER ====================

  function formatCostBreakdownTags(cb) {
    if (!cb) return '';
    const rows = [
      { key: 'facultySubstitution', label: 'Faculty Sub' },
      { key: 'classroomRelocation', label: 'Room Reloc' },
      { key: 'labRelocation', label: 'Lab Reloc' },
      { key: 'timeSlotChanges', label: 'Time Shifts' },
      { key: 'workloadSurcharge', label: 'Load Surcharge' },
      { key: 'transportReallocation', label: 'Transit' },
      { key: 'examReschedule', label: 'Exam Shift' },
      { key: 'backupAndSplit', label: 'Reserve/Split' },
      { key: 'preemption', label: 'Preemption' },
      { key: 'unresolvedPenalty', label: 'Unresolved Penalty' }
    ].filter((r) => cb[r.key] && cb[r.key].points > 0);

    if (rows.length === 0) return '<span class="muted">0 pts (no resource penalty)</span>';
    return rows.map((r) => `<span class="cost-chip">${r.label} (${cb[r.key].count}): +${cb[r.key].points}</span>`).join('');
  }

  function buildBaImpactSvg(s, t, focusedMetric) {
    const W = 540;
    const H = 228;
    const padL = 42;
    const padR = 14;
    const padT = 22;
    const padB = 42;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const lerp = (a, b) => a + (b - a) * t;
    const curHealth = Math.round(lerp(s.healthBefore, s.healthAfter) * 10) / 10;
    const curStudents = Math.round(lerp(s.affectedStudentsBefore, s.affectedStudentsAfter));
    const curConflicts = Math.round(lerp(s.totalImpacted, s.unresolvedConflicts));
    const curResolved = Math.round(lerp(0, s.resolvedCount));
    const curChanges = Math.round(lerp(0, s.timetableChanges));

    const maxStud = Math.max(1, s.affectedStudentsBefore);
    const maxAct = Math.max(1, s.totalImpacted, s.timetableChanges);

    const groups = [
      {
        key: 'health',
        label: 'Campus Health',
        beforeVal: `${s.healthBefore}%`,
        afterVal: `${curHealth}%`,
        delta: `${(curHealth - s.healthBefore) >= 0 ? '+' : ''}${(curHealth - s.healthBefore).toFixed(1)}%`,
        deltaGood: curHealth >= s.healthBefore,
        beforeNorm: s.healthBefore / 100,
        afterNorm: curHealth / 100,
        note: `System health index rises from ${s.healthBefore}% to ${curHealth}% (${s.healthAfter}% full plan).`
      },
      {
        key: 'students',
        label: 'Affected Students',
        beforeVal: `${s.affectedStudentsBefore}`,
        afterVal: `${curStudents}`,
        delta: `${curStudents - s.affectedStudentsBefore}`,
        deltaGood: curStudents <= s.affectedStudentsBefore,
        beforeNorm: s.affectedStudentsBefore / maxStud,
        afterNorm: curStudents / maxStud,
        note: `${Math.max(0, s.affectedStudentsBefore - curStudents)} students restored (${curStudents} remaining impacted).`
      },
      {
        key: 'conflicts',
        label: 'Unresolved',
        beforeVal: `${s.totalImpacted}`,
        afterVal: `${curConflicts}`,
        delta: `${curConflicts - s.totalImpacted}`,
        deltaGood: curConflicts <= s.totalImpacted,
        beforeNorm: s.totalImpacted / maxAct,
        afterNorm: curConflicts / maxAct,
        note: `Active conflicts drop from ${s.totalImpacted} to ${curConflicts} (Critical unresolved: ${s.unresolvedCriticalCount}).`
      },
      {
        key: 'activities',
        label: 'Recovered Acts',
        beforeVal: '0',
        afterVal: `${curResolved}`,
        delta: `+${curResolved}`,
        deltaGood: true,
        beforeNorm: 0,
        afterNorm: curResolved / maxAct,
        note: `${curResolved}/${s.totalImpacted} impacted occurrences recovered (${s.criticalRecovered}/${s.criticalTotal} critical protected).`
      },
      {
        key: 'changes',
        label: 'Schedule Edits',
        beforeVal: '0',
        afterVal: `${curChanges}`,
        delta: `${curChanges} edits`,
        deltaGood: true,
        beforeNorm: 0,
        afterNorm: curChanges / Math.max(1, maxAct),
        note: `Breakdown: ${s.facultySubstitutions} Faculty Sub · ${s.classroomChanges} Room · ${s.labReallocations} Lab · ${s.rescheduledActivities} Time Shifts.`
      }
    ];

    const colW = plotW / groups.length;
    const barW = Math.min(24, colW * 0.27);
    const gap = 5;

    let gridSvg = '';
    [0, 25, 50, 75, 100].forEach((pct) => {
      const y = padT + plotH * (1 - pct / 100);
      gridSvg += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e2e8f0" stroke-dasharray="${pct === 0 ? '' : '3 3'}" />`;
      gridSvg += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="#64748b">${pct}%</text>`;
    });

    let barsSvg = '';
    groups.forEach((g, idx) => {
      const cx = padL + colW * (idx + 0.5);
      const isFocused = focusedMetric === g.key;
      const bH = Math.max(2, g.beforeNorm * plotH);
      const aH = Math.max(2, g.afterNorm * plotH);
      const bY = padT + plotH - bH;
      const aY = padT + plotH - aH;
      const xBefore = cx - barW - gap / 2;
      const xAfter = cx + gap / 2;

      const afterColor = (g.key === 'students' || g.key === 'conflicts')
        ? (g.afterNorm === 0 ? '#16a34a' : '#2563eb')
        : (g.key === 'changes' ? '#f59e0b' : '#2563eb');

      barsSvg += `
        <g class="ba-svg-group ${isFocused ? 'focused' : ''}" data-ba-metric="${g.key}" style="cursor:pointer;">
          <rect x="${cx - colW * 0.46}" y="${padT - 6}" width="${colW * 0.92}" height="${plotH + 38}" rx="8"
            fill="${isFocused ? '#eff6ff' : 'transparent'}" stroke="${isFocused ? '#93c5fd' : 'transparent'}" stroke-width="1.2" />
          <rect x="${xBefore}" y="${bY}" width="${barW}" height="${bH}" rx="4" fill="#dc2626" opacity="0.86" />
          <text x="${xBefore + barW / 2}" y="${bY - 4}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#991b1b">${escapeHtml(g.beforeVal)}</text>
          <rect x="${xAfter}" y="${aY}" width="${barW}" height="${aH}" rx="4" fill="${afterColor}" />
          <text x="${xAfter + barW / 2}" y="${aY - 4}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#1e3a8a">${escapeHtml(g.afterVal)}</text>
          <text x="${cx}" y="${H - 22}" text-anchor="middle" font-size="10.5" font-weight="700" fill="#334155">${escapeHtml(g.label)}</text>
          <text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${g.deltaGood ? '#15803d' : '#b45309'}">${escapeHtml(g.delta)}</text>
        </g>
      `;
    });

    const activeInfo = groups.find((g) => g.key === focusedMetric) || groups[0];
    return {
      svg: `
        <svg viewBox="0 0 ${W} ${H}" class="ba-chart-svg" role="img" aria-label="Before vs After Metrics Comparison Chart">
          ${gridSvg}
          ${barsSvg}
        </svg>
      `,
      inspectorHtml: `<strong>${escapeHtml(activeInfo.label)}:</strong> ${escapeHtml(activeInfo.beforeVal)} → ${escapeHtml(activeInfo.afterVal)} (${escapeHtml(activeInfo.delta)}) — ${escapeHtml(activeInfo.note)}`
    };
  }

  function buildBaDepartmentSvg(plan, t) {
    const depts = baseState.departments.map((d) => d.code);
    const deptImpacted = new Map();
    const deptUnresolved = new Map();
    const deptStudentsBefore = new Map();
    const deptStudentsAfter = new Map();
    depts.forEach((d) => {
      deptImpacted.set(d, 0);
      deptUnresolved.set(d, 0);
      deptStudentsBefore.set(d, new Set());
      deptStudentsAfter.set(d, new Set());
    });

    (appState.cascadeResult.impactedOccurrences || []).forEach((occ) => {
      const d = occ.activity.department;
      if (!deptImpacted.has(d)) return;
      deptImpacted.set(d, deptImpacted.get(d) + 1);
      deptStudentsBefore.get(d).add(occ.activity.sectionId);
    });

    plan.actions.forEach((a) => {
      const occ = (appState.cascadeResult.impactedOccurrences || []).find((o) => o.occKey === a.occKey);
      const d = occ ? occ.activity.department : null;
      if (!d || !deptUnresolved.has(d)) return;
      if (!a.resolved) {
        deptUnresolved.set(d, deptUnresolved.get(d) + 1);
        deptStudentsAfter.get(d).add(a.sectionId);
      }
    });

    const W = 540;
    const H = 228;
    const padL = 36;
    const padR = 14;
    const padT = 22;
    const padB = 40;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const maxCnt = Math.max(1, ...Array.from(deptImpacted.values()));
    const colW = plotW / depts.length;
    const barW = Math.min(24, colW * 0.28);

    let grid = '';
    [0, 0.5, 1].forEach((f) => {
      const y = padT + plotH * (1 - f);
      const val = Math.round(maxCnt * f);
      grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e2e8f0" stroke-dasharray="${f === 0 ? '' : '3 3'}" />`;
      grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="#64748b">${val}</text>`;
    });

    let bars = '';
    depts.forEach((d, idx) => {
      const imp = deptImpacted.get(d) || 0;
      const rem = deptUnresolved.get(d) || 0;
      const curRem = Math.round(imp + (rem - imp) * t);
      const curRec = Math.max(0, imp - curRem);
      const cx = padL + colW * (idx + 0.5);
      const impH = imp === 0 ? 2 : Math.max(4, (imp / maxCnt) * plotH);
      const recH = curRec === 0 ? 2 : Math.max(4, (curRec / maxCnt) * plotH);

      bars += `
        <g>
          <rect x="${cx - barW - 3}" y="${padT + plotH - impH}" width="${barW}" height="${impH}" rx="4" fill="#dc2626" opacity="0.86" />
          <text x="${cx - barW / 2 - 3}" y="${padT + plotH - impH - 4}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#991b1b">${imp}</text>
          <rect x="${cx + 3}" y="${padT + plotH - recH}" width="${barW}" height="${recH}" rx="4" fill="#2563eb" />
          <text x="${cx + barW / 2 + 3}" y="${padT + plotH - recH - 4}" text-anchor="middle" font-size="9.5" font-weight="700" fill="#1e3a8a">${curRec}</text>
          <text x="${cx}" y="${H - 20}" text-anchor="middle" font-size="11" font-weight="700" fill="#334155">${d}</text>
          <text x="${cx}" y="${H - 7}" text-anchor="middle" font-size="9" fill="#64748b">${curRem} left</text>
        </g>
      `;
    });

    const summary = depts
      .filter((d) => (deptImpacted.get(d) || 0) > 0)
      .map((d) => `${d}: ${deptImpacted.get(d)} impacted → ${(deptImpacted.get(d) || 0) - (deptUnresolved.get(d) || 0)} recovered`)
      .join(' | ') || 'No department sessions impacted (transit-only event).';

    return {
      svg: `<svg viewBox="0 0 ${W} ${H}" class="ba-chart-svg" role="img" aria-label="Department Impact vs Recovery Chart">${grid}${bars}</svg>`,
      inspectorHtml: `<strong>Department Breakdown:</strong> ${escapeHtml(summary)}`
    };
  }

  function buildBaMultiPlanSvg(plans, selectedIndex) {
    const W = 540;
    const H = 228;
    const padL = 42;
    const padR = 16;
    const padT = 24;
    const padB = 38;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    const maxCost = Math.max(1, ...plans.map((p) => p.stats.recoveryCost));
    const maxChg = Math.max(1, ...plans.map((p) => p.stats.scheduleChanges));
    const axes = [
      { label: 'Recovery %', get: (p) => p.stats.recoveryPct },
      { label: 'Students Saved %', get: (p) => p.stats.affectedStudentsBefore ? Math.round((p.stats.studentsRestored / p.stats.affectedStudentsBefore) * 100) : 100 },
      { label: 'Health Gain %', get: (p) => Math.round((p.stats.healthAfter / 100) * 100) },
      { label: 'Schedule Stability', get: (p) => Math.max(15, Math.round(100 - (p.stats.scheduleChanges / maxChg) * 65)) },
      { label: 'Cost Efficiency', get: (p) => Math.max(15, Math.round(100 - (p.stats.recoveryCost / maxCost) * 65)) }
    ];

    const colors = ['#2563eb', '#0d9488', '#7c3aed'];
    let grid = '';
    [25, 50, 75, 100].forEach((val) => {
      const y = padT + plotH * (1 - val / 100);
      grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e2e8f0" stroke-dasharray="3 3" />`;
      grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="#64748b">${val}</text>`;
    });

    let axisLabels = '';
    axes.forEach((ax, i) => {
      const x = padL + (plotW / (axes.length - 1)) * i;
      grid += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + plotH}" stroke="#f1f5f9" />`;
      axisLabels += `<text x="${x}" y="${H - 12}" text-anchor="middle" font-size="9.8" font-weight="700" fill="#334155">${ax.label}</text>`;
    });

    let lines = '';
    plans.forEach((p, idx) => {
      const col = colors[idx % colors.length];
      const isSel = idx === selectedIndex;
      const pts = axes.map((ax, i) => {
        const x = padL + (plotW / (axes.length - 1)) * i;
        const y = padT + plotH * (1 - Math.max(0, Math.min(100, ax.get(p))) / 100);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const dots = axes.map((ax, i) => {
        const x = padL + (plotW / (axes.length - 1)) * i;
        const y = padT + plotH * (1 - Math.max(0, Math.min(100, ax.get(p))) / 100);
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${isSel ? 5 : 3.5}" fill="${col}" stroke="#ffffff" stroke-width="1.5" />`;
      }).join('');

      lines += `
        <g data-plan-select-svg="${idx}" style="cursor:pointer;">
          <polyline points="${pts}" fill="none" stroke="${col}" stroke-width="${isSel ? 3.2 : 1.8}" opacity="${isSel ? 1 : 0.55}" />
          ${dots}
        </g>
      `;
    });

    const legend = plans.map((p, idx) =>
      `<span class="ba-plan-dot" style="color:${colors[idx % colors.length]}; font-weight:${idx === selectedIndex ? '800' : '600'}; cursor:pointer;" data-plan-select-svg="${idx}">&#9679; Rank #${p.rank}: ${escapeHtml(p.name.split(' ')[0])} (${p.stats.recoveryCost} pts)</span>`
    ).join(' ');

    return {
      svg: `<svg viewBox="0 0 ${W} ${H}" class="ba-chart-svg" role="img" aria-label="Multi-Plan Trade-off Curve">${grid}${axisLabels}${lines}</svg>`,
      inspectorHtml: `<strong>Click any curve to select plan:</strong> ${legend}`
    };
  }

  function buildRadialGaugeSvg(title, beforePct, afterPct, t, subLabel) {
    const curPct = Math.round((beforePct + (afterPct - beforePct) * t) * 10) / 10;
    const rOuter = 44;
    const rInner = 34;
    const cOuter = 2 * Math.PI * rOuter;
    const cInner = 2 * Math.PI * rInner;
    const dashOuter = (Math.max(0, Math.min(100, curPct)) / 100) * cOuter;
    const dashInner = (Math.max(0, Math.min(100, beforePct)) / 100) * cInner;
    const delta = Math.round((curPct - beforePct) * 10) / 10;

    return `
      <div class="ba-gauge-card">
        <svg viewBox="0 0 116 116" class="ba-gauge-svg" role="img" aria-label="${escapeHtml(title)}">
          <circle cx="58" cy="58" r="${rOuter}" fill="none" stroke="#e2e8f0" stroke-width="8" />
          <circle cx="58" cy="58" r="${rInner}" fill="none" stroke="#fee2e2" stroke-width="4" />
          <circle cx="58" cy="58" r="${rInner}" fill="none" stroke="#dc2626" stroke-width="4" stroke-dasharray="${dashInner.toFixed(1)} ${cInner.toFixed(1)}" transform="rotate(-90 58 58)" opacity="0.85" />
          <circle cx="58" cy="58" r="${rOuter}" fill="none" stroke="${curPct >= 90 ? '#2563eb' : '#ea580c'}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${dashOuter.toFixed(1)} ${cOuter.toFixed(1)}" transform="rotate(-90 58 58)" />
          <text x="58" y="55" text-anchor="middle" font-size="16" font-weight="800" fill="#0f172a">${curPct}%</text>
          <text x="58" y="70" text-anchor="middle" font-size="9.5" font-weight="700" fill="#16a34a">${delta >= 0 ? '+' : ''}${delta}%</text>
        </svg>
        <div class="ba-gauge-title">${escapeHtml(title)}</div>
        <div class="muted" style="font-size:11px;">${escapeHtml(subLabel)}</div>
      </div>
    `;
  }

  function renderBeforeAfterVisual(baGrid, plan, plans, isApplied) {
    const s = plan.stats;
    const t = Math.max(0, Math.min(100, Number(appState.baMorphPct))) / 100;
    const afterStateWord = isApplied ? 'Actual' : 'Projected';

    const liveResolved = Math.round(s.resolvedCount * t);

    let mainChart;
    if (appState.baChartTab === 'dept') {
      mainChart = buildBaDepartmentSvg(plan, t);
    } else if (appState.baChartTab === 'plans') {
      mainChart = buildBaMultiPlanSvg(plans, appState.selectedPlanIndex);
    } else {
      mainChart = buildBaImpactSvg(s, t, appState.baFocusedMetric);
    }

    const healthGauge = buildRadialGaugeSvg(
      'Campus Health',
      s.healthBefore,
      s.healthAfter,
      t,
      `Before: ${s.healthBefore}% → ${afterStateWord}: ${s.healthAfter}%`
    );
    const recGauge = buildRadialGaugeSvg(
      'Recovery Completion',
      0,
      s.recoveryPct,
      t,
      `${liveResolved}/${s.totalImpacted} restored • Crit ${s.criticalRecovered}/${s.criticalTotal}`
    );

    if (!baGrid.querySelector('#baDynamicHost')) {
      baGrid.innerHTML = `
        <div class="ba-viz-toolbar">
          <div class="ba-tab-group">
            <button type="button" class="ba-tab-btn ${appState.baChartTab === 'impact' ? 'active' : ''}" data-ba-tab="impact">Impact &amp; Health Graph</button>
            <button type="button" class="ba-tab-btn ${appState.baChartTab === 'dept' ? 'active' : ''}" data-ba-tab="dept">Department Impact Bars</button>
            <button type="button" class="ba-tab-btn ${appState.baChartTab === 'plans' ? 'active' : ''}" data-ba-tab="plans">Multi-Plan Trade-off Curve</button>
          </div>
          <div class="ba-slider-group">
            <span class="ba-slider-label">Before</span>
            <input type="range" min="0" max="100" value="${appState.baMorphPct}" class="ba-morph-slider" id="baMorphSlider" aria-label="Before to After transition slider">
            <span class="ba-slider-label" id="baMorphAfterLbl">After (${appState.baMorphPct}%)</span>
            <button type="button" class="btn btn-sm btn-outline" id="btnAnimateBaChart">&#9654; Animate Diff</button>
          </div>
        </div>
        <div id="baDynamicHost"></div>
      `;
    } else {
      baGrid.querySelectorAll('.ba-tab-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.baTab === appState.baChartTab);
      });
      const sl = baGrid.querySelector('#baMorphSlider');
      if (sl && sl.value !== String(appState.baMorphPct)) sl.value = String(appState.baMorphPct);
      const lbl = baGrid.querySelector('#baMorphAfterLbl');
      if (lbl) lbl.textContent = `After (${appState.baMorphPct}%)`;
    }

    const dynHost = baGrid.querySelector('#baDynamicHost');
    dynHost.innerHTML = `
      <div class="ba-visual-layout">
        <div class="ba-gauges-col">
          ${healthGauge}
          ${recGauge}
        </div>
        <div class="ba-main-chart-col">
          <div class="ba-legend-row">
            <span><i class="dot dot-red"></i>Disrupted Baseline (Before)</span>
            <span><i class="dot dot-blue"></i>${afterStateWord} State (@ ${appState.baMorphPct}% transition)</span>
            <span class="muted" style="margin-left:auto;">Click chart bars or scrub slider to inspect difference</span>
          </div>
          ${mainChart.svg}
          <div class="ba-inspector-strip">${mainChart.inspectorHtml}</div>
        </div>
      </div>

      ${s.healthExplanation && s.healthAfter < 100 ? `
        <div class="health-note-banner">
          <strong>Why Campus Health is ${s.healthAfter}% (&lt; 100%):</strong> ${escapeHtml(s.healthExplanation)}
        </div>
      ` : ''}
    `;
  }

  function renderRecoveryView() {
    const baGrid = document.getElementById('recoveryBeforeAfterGrid');
    const plansNotice = document.getElementById('recoveryPlansNotice');
    const plansGrid = document.getElementById('rankedPlansGrid');
    const expList = document.getElementById('recoveryExplanationsList');
    const statusBadge = document.getElementById('recoveryAnalysisStatusBadge');
    const statusSub = document.getElementById('recoveryAnalysisSubtitle');
    const countPill = document.getElementById('recoveryPlansCountPill');
    const actionsPlanBadge = document.getElementById('recoveryActionsPlanBadge');

    const plans = appState.recoveryPlans;
    const plan = getSelectedPlan();

    if (!plan) {
      if (statusBadge) {
        statusBadge.className = 'badge badge-gray';
        statusBadge.textContent = 'Waiting for Simulation';
      }
      if (statusSub) {
        statusSub.textContent = 'Baseline disrupted metrics vs. projected or applied recovery results';
      }
      if (countPill) countPill.textContent = '0 plans';
      if (plansNotice) plansNotice.innerHTML = '';
      if (actionsPlanBadge) actionsPlanBadge.classList.add('hidden');
      baGrid.innerHTML = `<p class="muted">No active disruption. Launch a disruption scenario in the Overview or Disruption Simulator to generate recovery plans.</p>`;
      plansGrid.innerHTML = `<p class="muted">Waiting for an active failure event.</p>`;
      expList.innerHTML = `<p class="muted">Explainable recovery decisions will appear here once a disruption is simulated.</p>`;
      return;
    }

    const appliedPlan = getAppliedPlan();
    const isApplied = Boolean(appliedPlan && appState.appliedPlanIndex === appState.selectedPlanIndex);

    if (statusBadge) {
      if (isApplied) {
        statusBadge.className = 'badge badge-blue';
        statusBadge.textContent = `Actual Applied Recovery (Rank #${plan.rank})`;
      } else if (appliedPlan) {
        statusBadge.className = 'badge badge-orange';
        statusBadge.textContent = `Projected Preview (Rank #${plan.rank}) • Applied: Rank #${appliedPlan.rank}`;
      } else {
        statusBadge.className = 'badge badge-orange';
        statusBadge.textContent = `Projected Recovery — Preview Only (Rank #${plan.rank})`;
      }
    }
    if (statusSub) {
      statusSub.textContent = isApplied
        ? `Showing actual post-recovery institutional metrics after applying "${plan.name}".`
        : appliedPlan
          ? `Previewing Rank #${plan.rank} "${plan.name}". Currently active campus state uses Rank #${appliedPlan.rank} "${appliedPlan.name}". Click "Apply Rank #${plan.rank} Plan" to switch.`
          : `Comparing original disrupted baseline against projected recovery for selected plan "${plan.name}" (not yet applied).`;
    }
    if (countPill) {
      countPill.textContent = `${plans.length} unique valid plan${plans.length === 1 ? '' : 's'}`;
    }

    renderBeforeAfterVisual(baGrid, plan, plans, isApplied);

    // Convergence & Rank #1 Explanation banners
    let noticeHtml = '';
    if (plans.length === 1 && plans[0].allConverged) {
      noticeHtml += `
        <div class="convergence-banner">
          <strong>Strategy Convergence:</strong> All evaluated strategies converge on the same optimal recovery plan.
        </div>
      `;
    } else if (plans[0]?.rankReason) {
      noticeHtml += `
        <div class="rank-why-box">
          <strong>Why Rank #1 is Recommended:</strong> ${escapeHtml(plans[0].rankReason)}
        </div>
      `;
    }
    if (plansNotice) plansNotice.innerHTML = noticeHtml;

    plansGrid.innerHTML = plans.map((p, idx) => {
      const selected = idx === appState.selectedPlanIndex ? 'selected' : '';
      const st = p.stats;
      const wm = st.workloadMetrics || {};
      const costSummary = formatCostBreakdownTags(st.costBreakdown);
      return `
        <div class="plan-card ${selected}" data-plan-index="${idx}">
          <div class="plan-header">
            <div>
              <div class="plan-rank">Rank #${p.rank} Recommendation ${selected ? '• SELECTED' : ''}</div>
              <strong style="font-size:14.5px;">${escapeHtml(p.name)}</strong>
              ${p.convergedStrategies && p.convergedStrategies.length > 1 && !p.allConverged ? `
                <div class="muted" style="font-size:11px; margin-top:2px;">Also matched by: ${escapeHtml(p.convergedStrategies.slice(1).join(', '))}</div>
              ` : ''}
            </div>
            <span class="badge ${p.rank === 1 ? 'badge-blue' : 'badge-gray'}">${escapeHtml(p.badge)}</span>
          </div>
          <p class="muted" style="margin:0; font-size:12px;">${escapeHtml(p.description)}</p>
          ${p.operationalDifferenceNote ? `
            <div class="op-diff-note">${escapeHtml(p.operationalDifferenceNote)}</div>
          ` : ''}
          <div class="plan-metrics">
            <div><span class="muted">Recovery Rate</span><strong>${st.recoveryPct}%</strong></div>
            <div><span class="muted">Recovered Activities</span><strong>${st.resolvedCount} / ${st.totalImpacted}</strong></div>
            <div><span class="muted">Unresolved Conflicts</span><strong>${st.unresolvedConflicts} <small class="muted">(Crit: ${st.unresolvedCriticalCount})</small></strong></div>
            <div><span class="muted">Affected After</span><strong>${st.affectedStudentsAfter}</strong></div>
            <div><span class="muted">Schedule Changes</span><strong>${st.scheduleChanges} <small class="muted">(TT: ${st.timetableChanges})</small></strong></div>
            <div><span class="muted">Relative Cost Score</span><strong>${st.recoveryCost} pts</strong></div>
            <div><span class="muted">Faculty Workload Impact</span><strong>${escapeHtml(wm.summaryLabel || 'Nominal')}</strong></div>
            <div><span class="muted">Critical Protected</span><strong>${st.criticalRecovered} / ${st.criticalTotal}</strong></div>
          </div>
          <div class="cost-breakdown-box">
            <div class="cost-breakdown-title">Cost Breakdown (Relative Score: ${st.recoveryCost} pts)</div>
            <div class="cost-chips-row">${costSummary}</div>
          </div>
          <div class="plan-pros-cons">
            <div><strong>Advantages:</strong> ${escapeHtml((p.advantages || []).join('; '))}</div>
            <div><strong>Trade-offs:</strong> ${escapeHtml((p.tradeOffs || []).join('; '))}</div>
          </div>
          <div class="plan-actions-row">
            <button type="button" class="btn btn-sm btn-outline view-actions-btn" data-plan-btn-index="${idx}">View Recovery Actions</button>
            <button type="button" class="btn btn-sm ${selected ? 'btn-secondary' : 'btn-primary'} select-plan-btn" data-plan-btn-index="${idx}">${selected ? 'Selected' : 'Select Recovery Plan'}</button>
          </div>
        </div>
      `;
    }).join('');

    if (actionsPlanBadge) {
      actionsPlanBadge.classList.remove('hidden');
      actionsPlanBadge.textContent = `Rank #${plan.rank}: ${plan.name}`;
    }

    const itemsHtml = [];
    plan.actions.forEach((a) => {
      const relevantFields = [
        { label: 'Original Date & Time', value: `${a.occurrenceDateDMY} (${a.origDay} · ${a.origTimeText || a.origSlotId})` },
        ...(a.resolved ? [{ label: 'Recovered Date & Time', value: `${a.newDateDMY} (${a.newDay} · ${a.newTimeText || a.newSlotId})${a.timeChanged ? ' ★ Shifted' : ' (Preserved)'}`, highlight: a.timeChanged }] : []),
        { label: 'Original Faculty', value: `${a.origFacultyId} — ${a.origFacultyName || a.origFacultyId}` },
        ...(a.resolved && a.facChanged ? [{ label: 'Replacement Faculty', value: `${a.newFacultyId} — ${a.newFacultyName}`, highlight: true }] : []),
        { label: 'Original Resource', value: `${a.origRoomId} — ${a.origRoomName || a.origRoomId}` },
        ...(a.resolved && a.roomChanged ? [{ label: 'Replacement Resource', value: `${a.newRoomId} — ${a.newRoomName}`, highlight: true }] : [])
      ];

      itemsHtml.push(`
        <div class="decision-item ${a.resolved ? '' : 'unresolved'}">
          <div class="decision-head">
            <div>
              <strong>${escapeHtml(a.activityId)} • ${escapeHtml(a.title)}</strong>
              <span class="badge ${a.activityType === 'EXAM' ? 'badge-red' : 'badge-gray'}">${escapeHtml(a.activityType)} (P${a.priority})</span>
              <span class="badge badge-gray">${escapeHtml(a.sectionId)} (${a.studentCount} students)</span>
              ${a.isSplit ? '<span class="badge badge-orange">Capacity Split</span>' : ''}
              ${a.preemptedFrom ? `<span class="badge badge-orange">Swap/Preempt: ${escapeHtml(a.preemptedFrom)}</span>` : ''}
            </div>
            <span class="badge ${a.resolved ? 'badge-blue' : 'badge-red'}">${a.resolved ? `Resolved (${a.cost} pts)` : `Unresolved (+${a.cost} penalty)`}</span>
          </div>
          <div class="action-meta-grid">
            ${relevantFields.map((f) => `
              <div class="action-meta-cell ${f.highlight ? 'meta-highlight' : ''}">
                <span class="meta-label">${escapeHtml(f.label)}</span>
                <span class="meta-val">${escapeHtml(f.value)}</span>
              </div>
            `).join('')}
          </div>
          <div class="decision-reason"><strong>Decision Reason:</strong> ${escapeHtml(a.explanation)}</div>
          ${a.constraintsSatisfied && a.constraintsSatisfied.length ? `
            <div class="constraints-row">
              ${a.constraintsSatisfied.map((c) => `<span class="constraint-pill">&#10003; ${escapeHtml(c)}</span>`).join('')}
            </div>
          ` : ''}
        </div>
      `);
    });

    (plan.preemptions || []).forEach((pr) => {
      itemsHtml.push(`
        <div class="decision-item">
          <div class="decision-head">
            <div>
              <strong>${escapeHtml(pr.activityId)} • ${escapeHtml(pr.title)} (${pr.isSameSlotSwap ? 'In-Slot Swap' : 'Priority Preemption Shift'})</strong>
              <span class="badge badge-gray">${escapeHtml(pr.sectionId)}</span>
            </div>
            <span class="badge badge-blue">Freed ${escapeHtml(pr.origRoomId)} for ${escapeHtml(pr.forActivityId)}</span>
          </div>
          <div class="decision-reason">Moved cleanly from ${escapeHtml(pr.origDay)} ${escapeHtml(pr.origSlotId)} (${escapeHtml(pr.origRoomId)}) to ${escapeHtml(pr.newDay)} ${escapeHtml(pr.newSlotId)} (${escapeHtml(pr.newRoomId)}) with zero hard constraint violations.</div>
        </div>
      `);
    });

    plan.transitActions.forEach((t) => {
      itemsHtml.push(`
        <div class="decision-item">
          <div class="decision-head">
            <div><strong>${escapeHtml(t.busId)} • Transit Fleet Rerouting</strong></div>
            <span class="badge badge-blue">Rerouted ${t.reroutedStudents} commuters${t.remainingUnassigned > 0 ? ` (${t.remainingUnassigned} unallocated)` : ''}</span>
          </div>
          <div class="decision-reason">${escapeHtml(t.explanation)}</div>
        </div>
      `);
    });

    expList.innerHTML = itemsHtml.join('') || `<p class="muted">No schedule modifications required.</p>`;
  }

  // ==================== VIEW 5: TIMETABLE SIDE-BY-SIDE ====================

  function renderTimetableView() {
    // Populate section dropdown based on dept filter
    const secSelect = document.getElementById('ttSectionFilter');
    const eligibleSections = baseState.sections.filter(
      (s) => appState.ttDeptFilter === 'ALL' || s.department === appState.ttDeptFilter
    );
    if (!eligibleSections.some((s) => s.id === appState.ttSectionFilter)) {
      appState.ttSectionFilter = eligibleSections[0]?.id || 'SEC-CSE-1';
    }
    secSelect.innerHTML = eligibleSections
      .map((s) => `<option value="${s.id}" ${s.id === appState.ttSectionFilter ? 'selected' : ''}>${s.id} (${s.studentCount} students)</option>`)
      .join('');

    const plan = getAppliedPlan() || getSelectedPlan();
    const origActivities = Engine.getAllActivities(baseState);
    const activeState = plan ? plan.recoveredState : appState.cascadeResult.state;
    const recActivities = Engine.getAllActivities(activeState);

    const validation = Engine.validateSchedule(activeState);
    const valBadge = document.getElementById('ttValidationBadge');
    valBadge.textContent = `Active Schedule Integrity: ${validation.conflicts.length} Conflict(s)`;

    const container = document.getElementById('timetableComparisonContainer');

    if (appState.ttModeFilter === 'CHANGED_ONLY') {
      const preList = (plan && plan.preemptions) ? plan.preemptions : [];
      if (!plan || (plan.actions.length === 0 && preList.length === 0)) {
        container.innerHTML = `<p class="muted">No modified or impacted timetable entries. Trigger a disruption scenario to compare changes.</p>`;
        return;
      }
      container.innerHTML = `
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Activity</th>
                <th>Section</th>
                <th>Original Slot &amp; Resources</th>
                <th>Recovered Slot &amp; Resources</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${plan.actions.map((a) => `
                <tr>
                  <td><strong>${escapeHtml(a.activityId)}</strong><br>${escapeHtml(a.title)}</td>
                  <td>${escapeHtml(a.sectionId)}</td>
                  <td>${a.occurrenceDateDMY || ''} (${a.origDay} ${a.origSlotId})<br>Fac: ${escapeHtml(a.origFacultyId)} | Room: ${escapeHtml(a.origRoomId)}</td>
                  <td>${a.newDateDMY || ''} (${a.newDay} ${a.newSlotId})<br>Fac: <strong>${escapeHtml(a.newFacultyId)}</strong> | Room: <strong>${escapeHtml(a.newRoomId)}</strong>${a.splitSummary ? `<br><span class="muted" style="font-size:11px;">${escapeHtml(a.splitSummary)}</span>` : ''}</td>
                  <td><span class="badge ${a.resolved ? 'badge-blue' : 'badge-red'}">${a.resolved ? 'Modified & Recovered' : 'Unresolved'}</span></td>
                </tr>
              `).join('')}
              ${preList.map((pr) => `
                <tr>
                  <td><strong>${escapeHtml(pr.activityId)}</strong><br>${escapeHtml(pr.title)}</td>
                  <td>${escapeHtml(pr.sectionId)}</td>
                  <td>${pr.origDay} ${pr.origSlotId}<br>Room: ${escapeHtml(pr.origRoomId)}</td>
                  <td>${pr.newDay} ${pr.newSlotId}<br>Room: <strong>${escapeHtml(pr.newRoomId)}</strong></td>
                  <td><span class="badge badge-orange">${pr.isSameSlotSwap ? 'In-Slot Swap' : 'Priority Preempt Shift'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      return;
    }

    // Side-by-Side Weekly Grid for the selected section
    const secId = appState.ttSectionFilter;
    const origSecActs = origActivities.filter((a) => a.sectionId === secId);
    const recSecActs = recActivities.filter((a) => a.sectionId === secId);
    const origById = new Map(origSecActs.map((a) => [a.id, a]));
    const actionById = new Map((plan ? plan.actions : []).map((a) => [a.activityId, a]));
    const preemptById = new Map((plan && plan.preemptions ? plan.preemptions : []).map((p) => [p.activityId, p]));

    function buildSectionGrid(acts, isRecoveredSide) {
      let html = `<table class="tt-grid-table"><thead><tr><th>Time Slot</th>`;
      DAYS.forEach((d) => { html += `<th>${d}</th>`; });
      html += `</tr></thead><tbody>`;

      SLOTS.forEach((slot) => {
        html += `<tr><td><strong>${slot.id}</strong><br><span class="muted" style="font-size:10px;">${slot.label}</span></td>`;
        DAYS.forEach((day) => {
          const cellActs = acts.filter((a) => a.day === day && a.slotId === slot.id);
          html += `<td class="tt-slot-cell">`;
          if (cellActs.length === 0) {
            html += `<span class="muted" style="font-size:10.5px;">—</span>`;
          } else {
            cellActs.forEach((act) => {
              const actAction = actionById.get(act.id);
              const actPreempt = preemptById.get(act.id);
              const orig = origById.get(act.id);
              const effStatus = getEffectiveNodeStatus(act.id);
              let cls = '';
              if (act.activityType === 'EXAM') cls += ' entry-exam';
              if (act.activityType === 'PLACEMENT') cls += ' entry-placement';

              if (!isRecoveredSide && (effStatus === 'failed' || effStatus === 'affected' || actAction)) {
                cls += ' entry-failed';
              } else if (isRecoveredSide && (actAction || actPreempt)) {
                cls += (actPreempt || actAction.resolved) ? ' entry-recovered' : ' entry-failed';
              }

              let changeNote = '';
              if (isRecoveredSide && (actAction?.resolved || actPreempt) && orig) {
                const diffs = [];
                if (act.facultyId !== orig.facultyId) diffs.push('New Fac');
                if (act.roomId !== orig.roomId) diffs.push('New Room');
                if (act.day !== orig.day || act.slotId !== orig.slotId) diffs.push('Shifted');
                if (actPreempt) diffs.push(actPreempt.isSameSlotSwap ? 'Swapped' : 'Preempted');
                if (diffs.length) changeNote = `<span class="text-blue"><strong>★ ${diffs.join(' • ')}</strong></span>`;
              }

              html += `
                <div class="tt-entry ${cls}">
                  <strong>${escapeHtml(act.activityType === 'LECTURE' || act.activityType === 'LAB' ? act.original.subjectCode : act.activityType)}</strong>
                  <span>${escapeHtml(act.facultyId)} • ${escapeHtml(act.roomId)}</span>
                  ${changeNote}
                </div>
              `;
            });
          }
          html += `</td>`;
        });
        html += `</tr>`;
      });

      html += `</tbody></table>`;
      return html;
    }

    container.innerHTML = `
      <div class="tt-split-grid">
        <div class="tt-panel">
          <h3>Original Baseline Timetable — ${escapeHtml(secId)}</h3>
          ${buildSectionGrid(origSecActs, false)}
        </div>
        <div class="tt-panel">
          <h3>${plan ? `Recovered Timetable (${escapeHtml(plan.badge)})` : 'Current Active Timetable'} — ${escapeHtml(secId)}</h3>
          ${buildSectionGrid(recSecActs, true)}
        </div>
      </div>
    `;
  }

  // ==================== VIEW 6: INSTITUTIONAL DATA ====================

  function renderDataView() {
    const activeState = getActiveWorkingState();
    const q = appState.dataSearch.trim().toLowerCase();
    const wrap = document.getElementById('institutionalDataTableWrap');

    function statusBadge(id) {
      const st = getEffectiveNodeStatus(id);
      const cls =
        st === 'failed' ? 'badge-red' :
        st === 'affected' ? 'badge-orange' :
        st === 'recovered' ? 'badge-blue' : 'badge-green';
      return `<span class="badge ${cls}">${st}</span>`;
    }

    const tab = appState.dataTab;
    let headers = [];
    let rows = [];

    if (tab === 'departments') {
      headers = ['ID', 'Code', 'Department Name', 'Block', 'HOD', 'Sections', 'Students'];
      rows = activeState.departments.map((d) => {
        const secs = activeState.sections.filter((s) => s.department === d.code);
        const studs = secs.reduce((a, s) => a + s.studentCount, 0);
        return [d.id, d.code, d.name, d.block, d.headId, secs.length, studs];
      });
    } else if (tab === 'faculty') {
      const facLoad = new Map();
      Engine.getAllActivities(activeState).forEach((a) => facLoad.set(a.facultyId, (facLoad.get(a.facultyId) || 0) + 1));
      headers = ['ID', 'Name', 'Dept', 'Designation', 'Weekly Load', 'Bus', 'Qualified Subjects', 'Status'];
      rows = activeState.faculty.map((f) => [
        f.id, f.name, f.department, f.designation,
        `${facLoad.get(f.id) || 0} / ${f.maxWeeklyLoad} hrs`,
        f.busId || 'Own / Campus',
        f.qualifications.join(', '),
        statusBadge(f.id)
      ]);
    } else if (tab === 'sections') {
      headers = ['Section ID', 'Name', 'Dept', 'Semester', 'Students', 'Buses', 'Hostel'];
      rows = activeState.sections.map((s) => [
        s.id, s.name, s.department, `Sem ${s.semester}`, s.studentCount, s.busIds.join(', '), s.hostelId
      ]);
    } else if (tab === 'classrooms') {
      headers = ['ID', 'Name', 'Block', 'Dept', 'Capacity', 'Type', 'Power Zone', 'Status'];
      rows = activeState.classrooms.map((c) => [
        c.id, c.name, c.block, c.department, c.capacity, c.type, c.powerZone, statusBadge(c.id)
      ]);
    } else if (tab === 'labs') {
      headers = ['ID', 'Name', 'Dept', 'Lab Type', 'Capacity', 'Power Zone', 'Network Req.', 'Status'];
      rows = activeState.labs.map((l) => [
        l.id, l.name, l.department, l.labType, l.capacity, l.powerZone, l.requiresNetwork ? 'Yes (ADM-05)' : 'No', statusBadge(l.id)
      ]);
    } else if (tab === 'buses') {
      headers = ['ID', 'Route', 'Capacity', 'Commuter Load', 'Linked Faculty', 'Linked Sections', 'Status'];
      rows = activeState.buses.map((b) => [
        b.id, b.name, b.capacity, b.studentLoad, b.linkedFaculty.join(', '), b.linkedSections.join(', '), statusBadge(b.id)
      ]);
    } else if (tab === 'hostels') {
      headers = ['ID', 'Name', 'Capacity', 'Occupancy', 'Power Zone', 'Warden', 'Status'];
      rows = activeState.hostels.map((h) => [
        h.id, h.name, h.capacity, h.occupancy, h.powerZone, h.wardenName, statusBadge(h.id)
      ]);
    } else if (tab === 'activities') {
      headers = ['ID', 'Type', 'Title', 'Section', 'Date & Slot', 'Room', 'Lead / Invigilator', 'Status'];
      const specials = [...activeState.examinations, ...activeState.placements, ...activeState.events];
      rows = specials.map((sp) => [
        sp.id, sp.activityType, sp.title, sp.sectionId, `${formatDateDMY(sp.scheduledDate)} (${sp.day} ${sp.slotId})`, sp.roomId, sp.invigilatorId || sp.coordinatorId, statusBadge(sp.id)
      ]);
    } else if (tab === 'admin') {
      headers = ['ID', 'Administrative Resource', 'Category', 'Location', 'Criticality', 'Status'];
      rows = activeState.admin.map((a) => [
        a.id, a.name, a.category, a.block, a.critical ? 'Critical' : 'Standard', statusBadge(a.id)
      ]);
    }

    const filteredRows = q
      ? rows.filter((r) => r.join(' ').toLowerCase().includes(q))
      : rows;

    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>
          ${filteredRows.map((r) => `
            <tr>${r.map((cell) => `<td>${typeof cell === 'string' && cell.includes('<span class="badge') ? cell : escapeHtml(cell)}</td>`).join('')}</tr>
          `).join('') || `<tr><td colspan="${headers.length}" class="muted">No matching records.</td></tr>`}
        </tbody>
      </table>
    `;
  }

  function renderActiveViewDetails() {
    renderChrome();
    if (appState.activeView === 'overview') renderOverview();
    if (appState.activeView === 'twin') renderDigitalTwinView();
    if (appState.activeView === 'simulator') renderSimulatorView();
    if (appState.activeView === 'recovery') renderRecoveryView();
    if (appState.activeView === 'timetable') renderTimetableView();
    if (appState.activeView === 'data') renderDataView();
    if (appState.activeView === 'readiness') renderReadinessView();
  }

  function renderAll() {
    renderChrome();
    renderOverview();
    renderDigitalTwinView();
    renderSimulatorView();
    renderRecoveryView();
    renderTimetableView();
    renderDataView();
    renderReadinessView();
  }

  // ==================== EVENT WIRING ====================

  // ==================== VIEW 7: READINESS AUDIT (FEATURE 1) ====================

  /**
   * Convert a single institutional resource ID from the Readiness Audit into a simulator
   * config & navigate cleanly into the Disruption Simulator.
   */
  function loadResourceFailureIntoSimulator(resId) {
    if (!resId) return;
    const allWeekDates = DAYS.map((d) => baseState.meta.referenceWeek[d]);
    let cfg = null;

    if (resId.startsWith('FAC-')) {
      const fac = baseState.faculty.find((f) => f.id === resId);
      if (fac) {
        cfg = {
          scenarioType: 'SCN-FACULTY-ABSENCE',
          department: fac.department,
          scheduleMode: 'shared',
          facultyCount: 1,
          facultyIds: [fac.id],
          facultyId: fac.id,
          reason: 'Readiness Audit Stress Test',
          dates: [...allWeekDates],
          fullDay: true,
          perDateTimes: false,
          timePeriods: [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }],
          dateTimePeriods: {}
        };
      }
    } else if (resId.startsWith('LAB-')) {
      const lab = baseState.labs.find((l) => l.id === resId);
      if (lab) {
        cfg = {
          scenarioType: 'SCN-LAB-FAILURE',
          department: lab.department,
          labIds: [lab.id],
          labId: lab.id,
          failureType: 'equipment',
          equipmentUnavailablePct: 100,
          dates: [...allWeekDates],
          fullDay: true,
          perDateTimes: false,
          timePeriods: [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }],
          dateTimePeriods: {}
        };
      }
    } else if (resId.startsWith('CR-')) {
      const cr = baseState.classrooms.find((c) => c.id === resId);
      if (cr && cr.type === 'exam-hall') {
        const linkedExam = baseState.examinations.find((e) => e.roomId === cr.id) || baseState.examinations[0];
        cfg = {
          scenarioType: 'SCN-EXAM-HALL-FAILURE',
          roomId: cr.id,
          examId: linkedExam ? linkedExam.id : 'ALL',
          reason: 'Readiness Audit Stress Test',
          availableSeating: 0,
          capacityUnavailablePct: 100,
          dates: linkedExam ? [linkedExam.scheduledDate] : [...allWeekDates],
          fullDay: true,
          perDateTimes: false,
          timePeriods: [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }],
          dateTimePeriods: {}
        };
      } else if (cr) {
        cfg = {
          scenarioType: 'SCN-CLASSROOM-UNAVAILABLE',
          building: cr.block,
          classroomIds: [cr.id],
          classroomId: cr.id,
          reason: 'Readiness Audit Stress Test',
          dates: [...allWeekDates],
          fullDay: true,
          perDateTimes: false,
          timePeriods: [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }],
          dateTimePeriods: {}
        };
      }
    } else if (resId.startsWith('BUS-')) {
      cfg = {
        scenarioType: 'SCN-BUS-BREAKDOWN',
        busIds: [resId],
        busId: resId,
        breakdownType: 'Readiness Audit Simulation',
        dates: [...allWeekDates],
        date: baseState.meta.referenceWeek.Mon,
        startTime: '09:00',
        restorationTime: '11:00',
        spareBusAvailable: false
      };
    } else if (resId === 'ADM-02' || resId.startsWith('PZ-')) {
      cfg = {
        scenarioType: 'SCN-POWER-FAILURE',
        powerZone: resId.startsWith('PZ-') ? resId : 'PZ-1',
        failureSource: resId === 'ADM-02' ? 'Main Substation (ADM-02)' : `Zone Feeder (${resId})`,
        dates: [...allWeekDates],
        fullDay: true,
        startTime: OPERATING_HOURS.startTime,
        endTime: OPERATING_HOURS.endTime,
        backupAvailable: false,
        backupCapacityPct: 0
      };
    } else {
      cfg = { scenarioType: 'GENERIC_NODE', nodeId: resId };
    }

    if (!cfg) return;

    appState.recoveryApplied = false;
    appState.appliedPlanIndex = -1;
    appState.selectedPlanIndex = 0;
    appState.queuedFailureConfigs = [];
    appState.editingQueueId = null;

    if (cfg.scenarioType === 'GENERIC_NODE') {
      appState.activeScenarioId = 'GENERIC_NODE';
      appState.draftCards = [];
      appState.activeFailureConfigs = [cfg];
    } else {
      appState.activeScenarioId = cfg.scenarioType;
      const card = hydrateCardFromConfig(cfg);
      appState.draftCards = card ? [card] : [];
      appState.activeFailureConfigs = [cfg];
    }

    recomputeSimulation();
    appState.selectedNodeId = resId;
    switchView('simulator');
    renderAll();

    const m = appState.cascadeResult.metrics;
    showBanner(
      `Loaded SPOF "${resId}" into Disruption Simulator: ${m.impactedSessionsCount} impacted session(s), ${m.affectedStudents} affected students.`,
      m.impactedSessionsCount > 0 ? 'danger' : 'info'
    );
  }

  function startReadinessAudit() {
    if (appState.readinessRunning || !window.OMNIS_READINESS) return;
    appState.readinessRunning = true;
    appState.readinessProgress = { completed: 0, total: 101, pct: 0, phase: 'Preparing...', currentLabel: '' };
    renderReadinessView();

    const includeN2 = Boolean(appState.readinessIncludeN2);
    window.OMNIS_READINESS.runReadinessAudit(baseState, {
      includeN2,
      chunkSize: 5,
      onProgress: (prog) => {
        appState.readinessProgress = prog;
        const wrap = document.getElementById('auditProgressWrap');
        const fill = document.getElementById('auditProgressFill');
        const txt = document.getElementById('auditProgressText');
        const pctEl = document.getElementById('auditProgressPct');
        if (wrap) wrap.classList.remove('hidden');
        if (fill) fill.style.width = `${prog.pct}%`;
        if (pctEl) pctEl.textContent = `${prog.pct}%`;
        if (txt) txt.textContent = `${prog.phase}: testing ${prog.currentLabel || '...'} (${prog.completed}/${prog.total})`;
      }
    }).then((summary) => {
      appState.readinessAudit = summary;
      appState.readinessRunning = false;
      appState.readinessProgress = null;
      renderReadinessView();
      showBanner(
        `Readiness Audit completed: Score ${summary.readinessScore}/100 • Certified for ${summary.certifiedCount} of ${summary.totalCount} single failures (${summary.certifiedPct}%).`,
        summary.failingItems.length > 0 ? 'info' : 'success'
      );
    });
  }

  function renderReadinessView() {
    const sumWrap = document.getElementById('readinessSummaryContainer');
    const lbWrap = document.getElementById('readinessLeaderboardWrap');
    const hmWrap = document.getElementById('readinessHeatmapWrap');
    const progWrap = document.getElementById('auditProgressWrap');
    const btnRun = document.getElementById('btnRunReadinessAudit');
    const cbN2 = document.getElementById('cbAuditIncludeN2');
    const catSel = document.getElementById('readinessCategoryFilter');

    if (!sumWrap || !lbWrap || !hmWrap) return;

    if (btnRun) {
      btnRun.disabled = appState.readinessRunning;
      btnRun.textContent = appState.readinessRunning ? 'Running Audit...' : 'Run Readiness Audit';
    }
    if (cbN2) cbN2.checked = Boolean(appState.readinessIncludeN2);
    if (catSel) catSel.value = appState.readinessCategoryFilter || 'ALL';

    if (progWrap) {
      if (appState.readinessRunning && appState.readinessProgress) {
        progWrap.classList.remove('hidden');
      } else {
        progWrap.classList.add('hidden');
      }
    }

    const audit = appState.readinessAudit;
    if (!audit) {
      sumWrap.innerHTML = `
        <div class="builder-empty-state" style="margin-top:8px;">
          No audit run yet. Click <strong>Run Readiness Audit</strong> to stress-test all faculty, classrooms, laboratories, buses, power zones &amp; admin systems (N-1${appState.readinessIncludeN2 ? ' + N-2 pairs' : ''}).
        </div>
      `;
      lbWrap.innerHTML = `<p class="muted">Run the Readiness Audit above to populate the Single Points of Failure (SPOF) leaderboard.</p>`;
      hmWrap.innerHTML = `<p class="muted">Run the Readiness Audit above to generate the Weekly Vulnerability Heatmap.</p>`;
      return;
    }

    // a) Readiness Certificate + b) Score Gauge (reusing buildRadialGaugeSvg)
    const gaugeHtml = buildRadialGaugeSvg(
      'Zero-Failure Score',
      audit.certifiedPct,
      audit.readinessScore,
      1,
      `Certified: ${audit.certifiedCount}/${audit.totalCount} (${audit.certifiedPct}%)`
    );

    const failingBadges = audit.failingItems.length
      ? audit.failingItems.slice(0, 12).map((f) => `
          <button type="button" class="spof-fail-chip" data-audit-load-id="${escapeHtml(f.id)}" title="Click to load ${escapeHtml(f.id)} in Disruption Simulator">
            ${escapeHtml(f.id)} (${f.studentsRemaining > 0 ? `${f.studentsRemaining} unrerouted` : `${f.recoveryPct}%`})
          </button>
        `).join('') + (audit.failingItems.length > 12 ? ` <span class="muted">+${audit.failingItems.length - 12} more</span>` : '')
      : `<span class="badge badge-green">All ${audit.totalCount} single-failure scenarios 100% recoverable</span>`;

    const n2SummaryHtml = audit.n2Items && audit.n2Items.length
      ? `<div class="audit-n2-note"><strong>N-2 Pair Stress Test:</strong> ${audit.n2CertifiedCount}/${audit.n2Items.length} top risk pairs fully recoverable.</div>`
      : '';

    sumWrap.innerHTML = `
      <div class="readiness-summary-grid">
        <div class="readiness-cert-card">
          <div class="cert-header-row">
            <div>
              <div class="cert-kicker">INSTITUTIONAL RESILIENCE CERTIFICATE</div>
              <h3 class="cert-headline">Certified for ${audit.certifiedCount} of ${audit.totalCount} single failures (${audit.certifiedPct}%)</h3>
            </div>
            <span class="badge ${audit.failingItems.length === 0 ? 'badge-green' : 'badge-red'}">${audit.failingItems.length} Non-Zero Residual Risk</span>
          </div>
          <div class="cert-stats-row">
            <div><span class="muted">Readiness Score</span><strong>${audit.readinessScore} / 100</strong></div>
            <div><span class="muted">Avg Students Hit (Before)</span><strong>${audit.avgStudentsAffected}</strong></div>
            <div><span class="muted">Critical Exams Unprotected</span><strong class="${audit.totalUnprotectedCritical > 0 ? 'text-red' : 'text-green'}">${audit.totalUnprotectedCritical}</strong></div>
            <div><span class="muted">Last Evaluated</span><strong>${escapeHtml(new Date(audit.timestamp).toLocaleTimeString())}</strong></div>
          </div>
          ${n2SummaryHtml}
          <div class="cert-failing-block">
            <div class="cert-fail-label">Failing / Residual-Impact Resources (click to simulate):</div>
            <div class="cert-fail-chips">${failingBadges}</div>
          </div>
        </div>
        <div class="readiness-gauge-wrap">
          ${gaugeHtml}
        </div>
      </div>
    `;

    // c) Sortable SPOF Leaderboard Table
    const filterCat = appState.readinessCategoryFilter || 'ALL';
    const baseList = filterCat === 'ALL' ? [...audit.items] : audit.items.filter((x) => x.category === filterCat);
    const sortKey = appState.readinessSortKey || 'riskScore';
    const dirMul = appState.readinessSortDir === 'asc' ? 1 : -1;

    baseList.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      if (typeof va === 'string' && typeof vb === 'string') return va.localeCompare(vb) * dirMul;
      if (typeof va === 'boolean' && typeof vb === 'boolean') return ((va === vb ? 0 : va ? 1 : -1)) * dirMul;
      return ((Number(va) || 0) - (Number(vb) || 0)) * dirMul;
    });

    const sortArrow = (k) => (sortKey === k ? (dirMul === 1 ? ' ▲' : ' ▼') : '');
    const cols = [
      { key: 'id', label: 'Resource ID' },
      { key: 'category', label: 'Category' },
      { key: 'impactedSessions', label: 'Impacted Sessions' },
      { key: 'studentsAffected', label: 'Students Affected' },
      { key: 'recoveryPct', label: 'Best Recovery %' },
      { key: 'criticalUnprotected', label: 'Critical Unprotected' },
      { key: 'recoveryCost', label: 'Recovery Cost' },
      { key: 'fullyRecoverable', label: 'Readiness Status' }
    ];

    lbWrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            ${cols.map((c) => `<th><button type="button" class="sort-th-btn" data-audit-sort="${c.key}">${c.label}${sortArrow(c.key)}</button></th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${baseList.map((item, idx) => `
            <tr class="audit-clickable-row ${item.fullyRecoverable ? '' : 'audit-row-fail'}" data-audit-load-id="${escapeHtml(item.id)}" title="Click to load ${escapeHtml(item.id)} in Disruption Simulator">
              <td>${idx + 1}</td>
              <td><strong>${escapeHtml(item.id)}</strong><br><span class="muted" style="font-size:11.5px;">${escapeHtml(item.name)}</span></td>
              <td><span class="badge badge-gray">${escapeHtml(item.category)}</span></td>
              <td>${item.impactedSessions}</td>
              <td><strong>${item.studentsAffected}</strong>${item.studentsRemaining > 0 ? `<br><span class="text-red" style="font-size:11px;">${item.studentsRemaining} unrerouted</span>` : ''}</td>
              <td><strong>${item.recoveryPct}%</strong></td>
              <td class="${item.criticalUnprotected > 0 ? 'text-red' : ''}"><strong>${item.criticalUnprotected}</strong></td>
              <td>${item.recoveryCost} pts</td>
              <td><span class="badge ${item.fullyRecoverable ? 'badge-green' : 'badge-red'}">${item.fullyRecoverable ? 'Fully Recoverable' : 'Failing / Residual'}</span></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      ${audit.n2Items && audit.n2Items.length ? `
        <div style="margin-top:16px;">
          <h3 style="margin:0 0 8px; font-size:14px;">Top ${audit.n2Items.length} N-2 Simultaneous Resource Failure Pairs</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Resource Pair</th>
                <th>Impacted Sessions</th>
                <th>Students Affected</th>
                <th>Best Recovery %</th>
                <th>Critical Unprotected</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${audit.n2Items.map((p, idx) => `
                <tr>
                  <td>${idx + 1}</td>
                  <td><strong>${escapeHtml(p.id)}</strong><br><span class="muted" style="font-size:11px;">${escapeHtml(p.name)}</span></td>
                  <td>${p.impactedSessions}</td>
                  <td>${p.studentsAffected} (${p.studentsRemaining} remaining)</td>
                  <td><strong>${p.recoveryPct}%</strong></td>
                  <td class="${p.criticalUnprotected > 0 ? 'text-red' : ''}">${p.criticalUnprotected}</td>
                  <td><span class="badge ${p.fullyRecoverable ? 'badge-green' : 'badge-red'}">${p.fullyRecoverable ? 'Recoverable' : 'Unresolved'}</span></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    `;

    // d) Vulnerability Heatmap (Top 16 highest-impact resources x 25 Day|Slot cells)
    const heatRows = [...audit.items]
      .filter((x) => x.impactedSessions > 0)
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 16);

    if (heatRows.length === 0) {
      hmWrap.innerHTML = `<p class="muted">No scheduled session impacts detected.</p>`;
    } else {
      hmWrap.innerHTML = `
        <table class="heatmap-table">
          <thead>
            <tr>
              <th>Resource</th>
              ${DAYS.map((d) => SLOTS.map((s) => `<th title="${d} ${s.label}">${d}<br><span>${s.id}</span></th>`).join('')).join('')}
            </tr>
          </thead>
          <tbody>
            ${heatRows.map((row) => `
              <tr>
                <td class="heatmap-res-cell" data-audit-load-id="${escapeHtml(row.id)}" title="${escapeHtml(row.name)}">
                  <strong>${escapeHtml(row.id)}</strong> <span class="muted" style="font-size:10.5px;">(${escapeHtml(row.category)})</span>
                </td>
                ${DAYS.map((d) => SLOTS.map((s) => {
                  const k = `${d}|${s.id}`;
                  const cnt = row.daySlotCounts[k] || 0;
                  const cls = cnt === 0 ? 'hm-0' : cnt === 1 ? 'hm-1' : cnt <= 3 ? 'hm-2' : 'hm-4';
                  return `<td class="hm-cell ${cls}" title="${escapeHtml(row.id)} on ${d} ${s.id}: ${cnt} impacted session(s)">${cnt || ''}</td>`;
                }).join('')).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  }

  function bindEvents() {
    // Sidebar navigation
    document.querySelectorAll('.nav-item').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Quick jump buttons
    document.addEventListener('click', (e) => {
      const gotoBtn = e.target.closest('[data-goto]');
      if (gotoBtn) {
        switchView(gotoBtn.dataset.goto);
        return;
      }

      const scBtn = e.target.closest('[data-scenario]');
      if (scBtn) {
        triggerScenario(scBtn.dataset.scenario);
        return;
      }

      const graphNode = e.target.closest('.graph-node');
      if (graphNode) {
        appState.selectedNodeId = graphNode.dataset.nodeId;
        if (appState.activeView === 'overview') {
          switchView('twin');
        } else {
          renderDigitalTwinView();
        }
        return;
      }

      const viewActBtn = e.target.closest('.view-actions-btn');
      if (viewActBtn) {
        e.stopPropagation();
        appState.selectedPlanIndex = Number(viewActBtn.dataset.planBtnIndex);
        renderAll();
        const actionsSec = document.getElementById('recoveryActionsSection');
        if (actionsSec) actionsSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }

      const selectPlanBtn = e.target.closest('.select-plan-btn');
      if (selectPlanBtn) {
        e.stopPropagation();
        appState.selectedPlanIndex = Number(selectPlanBtn.dataset.planBtnIndex);
        renderAll();
        return;
      }

      const baTabBtn = e.target.closest('[data-ba-tab]');
      if (baTabBtn) {
        appState.baChartTab = baTabBtn.dataset.baTab;
        const plan = getSelectedPlan();
        const applied = getAppliedPlan();
        if (plan) renderBeforeAfterVisual(document.getElementById('recoveryBeforeAfterGrid'), plan, appState.recoveryPlans, Boolean(applied && appState.appliedPlanIndex === appState.selectedPlanIndex));
        return;
      }

      const baMetricEl = e.target.closest('[data-ba-metric]');
      if (baMetricEl) {
        appState.baFocusedMetric = baMetricEl.dataset.baMetric;
        const plan = getSelectedPlan();
        const applied = getAppliedPlan();
        if (plan) renderBeforeAfterVisual(document.getElementById('recoveryBeforeAfterGrid'), plan, appState.recoveryPlans, Boolean(applied && appState.appliedPlanIndex === appState.selectedPlanIndex));
        return;
      }

      const baPlanSvg = e.target.closest('[data-plan-select-svg]');
      if (baPlanSvg) {
        appState.selectedPlanIndex = Number(baPlanSvg.dataset.planSelectSvg);
        renderAll();
        return;
      }

      const sortThBtn = e.target.closest('[data-audit-sort]');
      if (sortThBtn) {
        const key = sortThBtn.dataset.auditSort;
        if (appState.readinessSortKey === key) {
          appState.readinessSortDir = appState.readinessSortDir === 'desc' ? 'asc' : 'desc';
        } else {
          appState.readinessSortKey = key;
          appState.readinessSortDir = (key === 'id' || key === 'category') ? 'asc' : 'desc';
        }
        renderReadinessView();
        return;
      }

      const loadAuditTarget = e.target.closest('[data-audit-load-id]');
      if (loadAuditTarget) {
        loadResourceFailureIntoSimulator(loadAuditTarget.dataset.auditLoadId);
        return;
      }

      if (e.target.closest('#btnAnimateBaChart')) {
        if (appState.baAnimFrame) cancelAnimationFrame(appState.baAnimFrame);
        appState.baMorphPct = 0;
        const startTs = performance.now();
        const duration = 900;
        const tick = (now) => {
          const prog = Math.min(1, (now - startTs) / duration);
          const eased = 1 - Math.pow(1 - prog, 3);
          appState.baMorphPct = Math.round(eased * 100);
          const plan = getSelectedPlan();
          const applied = getAppliedPlan();
          const baGrid = document.getElementById('recoveryBeforeAfterGrid');
          if (plan && baGrid) {
            renderBeforeAfterVisual(baGrid, plan, appState.recoveryPlans, Boolean(applied && appState.appliedPlanIndex === appState.selectedPlanIndex));
          }
          if (prog < 1) {
            appState.baAnimFrame = requestAnimationFrame(tick);
          } else {
            appState.baAnimFrame = null;
          }
        };
        appState.baAnimFrame = requestAnimationFrame(tick);
        return;
      }

      const planCard = e.target.closest('[data-plan-index]');
      if (planCard) {
        appState.selectedPlanIndex = Number(planCard.dataset.planIndex);
        renderAll();
        return;
      }

      const editBtn = e.target.closest('.edit-queue-btn');
      if (editBtn) {
        const qid = editBtn.dataset.editQid;
        const found = appState.queuedFailureConfigs.find((x) => x._qid === qid);
        if (found) {
          appState.editingQueueId = qid;
          const hydrated = hydrateCardFromConfig(found);
          if (hydrated) appState.draftCards = [hydrated];
          renderSimulatorView();
        }
        return;
      }

      const remBtn = e.target.closest('.remove-queue-btn');
      if (remBtn) {
        const qid = remBtn.dataset.removeQid;
        appState.queuedFailureConfigs = appState.queuedFailureConfigs.filter((x) => x._qid !== qid);
        if (appState.editingQueueId === qid) appState.editingQueueId = null;
        renderSimulatorView();
        return;
      }

      const addInstBtn = e.target.closest('.add-instance-mini');
      if (addInstBtn) {
        const t = addInstBtn.dataset.addInstance;
        const card = createBlankCard(t);
        if (card) appState.draftCards.push(card);
        renderSimulatorView();
        return;
      }

      const cardQueueBtn = e.target.closest('.card-queue-one-btn');
      if (cardQueueBtn) {
        e.stopPropagation();
        addBuilderToQueue(cardQueueBtn.dataset.cardId);
        return;
      }

      const cardRemoveBtn = e.target.closest('.card-remove-btn');
      if (cardRemoveBtn) {
        e.stopPropagation();
        const cid = cardRemoveBtn.dataset.cardId;
        appState.draftCards = appState.draftCards.filter((c) => c._cid !== cid);
        renderSimulatorView();
        return;
      }

      const headerToggle = e.target.closest('[data-toggle-card]');
      if (headerToggle) {
        const cid = headerToggle.dataset.toggleCard;
        const card = appState.draftCards.find((c) => c._cid === cid);
        if (card) {
          card._collapsed = !card._collapsed;
          renderDisruptionCards();
        }
        return;
      }

      // Calendar controls
      function getCalendarTarget(el) {
        const card = appState.draftCards.find((c) => c._cid === el.dataset.cardId);
        if (!card) return null;
        if (el.dataset.entryIdx !== undefined && card.facultyEntries) {
          return { card, target: card.facultyEntries[Number(el.dataset.entryIdx)], isSingleBus: false, isSingleClash: false };
        }
        return {
          card,
          target: card,
          isSingleBus: card.scenarioType === 'SCN-BUS-BREAKDOWN',
          isSingleClash: card.scenarioType === 'SCN-PLACEMENT-EXAM-CONFLICT'
        };
      }

      const calNav = e.target.closest('.cal-nav-btn');
      if (calNav) {
        const ctx = getCalendarTarget(calNav);
        if (ctx && ctx.target) {
          const delta = Number(calNav.dataset.calDelta);
          const d = new Date(ctx.target._calYear ?? todayDate.getFullYear(), (ctx.target._calMonth ?? todayDate.getMonth()) + delta, 1);
          ctx.target._calYear = d.getFullYear();
          ctx.target._calMonth = d.getMonth();
          renderDisruptionCards();
        }
        return;
      }

      const calModeBtn = e.target.closest('.cal-mode-btn');
      if (calModeBtn) {
        const ctx = getCalendarTarget(calModeBtn);
        if (ctx && ctx.target) {
          ctx.target._calMode = calModeBtn.dataset.calMode;
          ctx.target._rangeStart = null;
          renderDisruptionCards();
        }
        return;
      }

      const calClearBtn = e.target.closest('.cal-clear-btn');
      if (calClearBtn) {
        const ctx = getCalendarTarget(calClearBtn);
        if (ctx && ctx.target) {
          if (ctx.isSingleBus) { ctx.target.date = ''; ctx.target.dates = []; }
          else if (ctx.isSingleClash) { ctx.target.proposedDate = ''; }
          else { ctx.target.dates = []; ctx.target.dateTimePeriods = {}; }
          ctx.target._rangeStart = null;
          renderSimulatorView();
        }
        return;
      }

      const calRemDate = e.target.closest('.cal-remove-date');
      if (calRemDate) {
        const ctx = getCalendarTarget(calRemDate);
        if (ctx && ctx.target) {
          const iso = calRemDate.dataset.removeDate;
          if (ctx.isSingleBus) { ctx.target.date = ''; ctx.target.dates = []; }
          else if (ctx.isSingleClash) { ctx.target.proposedDate = ''; }
          else {
            ctx.target.dates = (ctx.target.dates || []).filter((d) => d !== iso);
            if (ctx.target.dateTimePeriods) delete ctx.target.dateTimePeriods[iso];
          }
          renderSimulatorView();
        }
        return;
      }

      const calDayBtn = e.target.closest('.cal-day-btn');
      if (calDayBtn) {
        const ctx = getCalendarTarget(calDayBtn);
        if (ctx && ctx.target) {
          const iso = calDayBtn.dataset.calDate;
          if (ctx.isSingleBus) {
            ctx.target.date = iso;
            ctx.target.dates = [iso];
          } else if (ctx.isSingleClash) {
            ctx.target.proposedDate = iso;
          } else {
            const mode = ctx.target._calMode || 'multi';
            const list = new Set(ctx.target.dates || []);
            if (mode === 'single') {
              ctx.target.dates = [iso];
            } else if (mode === 'multi') {
              if (list.has(iso)) list.delete(iso);
              else list.add(iso);
              ctx.target.dates = Array.from(list).sort();
            } else if (mode === 'range') {
              if (!ctx.target._rangeStart) {
                ctx.target._rangeStart = iso;
              } else {
                const a = ctx.target._rangeStart < iso ? ctx.target._rangeStart : iso;
                const b = ctx.target._rangeStart < iso ? iso : ctx.target._rangeStart;
                let cur = a;
                let guard = 0;
                while (cur <= b && guard < 62) {
                  list.add(cur);
                  cur = Engine.addDaysISO(cur, 1);
                  guard++;
                }
                ctx.target._rangeStart = null;
                ctx.target.dates = Array.from(list).sort();
              }
            }
            // Seed default blank time row for new dates when perDateTimes active
            if (ctx.target.perDateTimes) {
              ctx.target.dateTimePeriods = ctx.target.dateTimePeriods || {};
              (ctx.target.dates || []).forEach((dStr) => {
                if (!ctx.target.dateTimePeriods[dStr]) {
                  ctx.target.dateTimePeriods[dStr] = [{ startTime: '', endTime: '' }];
                }
              });
            }
          }
          renderSimulatorView();
        }
        return;
      }

      // Time period add/remove buttons
      const tpAddBtn = e.target.closest('.tp-add-btn');
      if (tpAddBtn) {
        const ctx = getCalendarTarget(tpAddBtn);
        if (ctx && ctx.target) {
          const dateKey = tpAddBtn.dataset.dateKey;
          if (dateKey) {
            ctx.target.dateTimePeriods = ctx.target.dateTimePeriods || {};
            ctx.target.dateTimePeriods[dateKey] = ctx.target.dateTimePeriods[dateKey] || [];
            ctx.target.dateTimePeriods[dateKey].push({ startTime: '', endTime: '' });
          } else {
            ctx.target.timePeriods = ctx.target.timePeriods || [];
            ctx.target.timePeriods.push({ startTime: '', endTime: '' });
          }
          renderSimulatorView();
        }
        return;
      }

      const tpRemoveBtn = e.target.closest('.tp-remove-btn');
      if (tpRemoveBtn) {
        const ctx = getCalendarTarget(tpRemoveBtn);
        if (ctx && ctx.target) {
          const idx = Number(tpRemoveBtn.dataset.tpIdx);
          const dateKey = tpRemoveBtn.dataset.dateKey;
          if (dateKey && ctx.target.dateTimePeriods?.[dateKey]) {
            ctx.target.dateTimePeriods[dateKey].splice(idx, 1);
          } else if (ctx.target.timePeriods) {
            ctx.target.timePeriods.splice(idx, 1);
          }
          renderSimulatorView();
        }
        return;
      }

      const removeChipBtn = e.target.closest('.picker-remove-chip');
      if (removeChipBtn) {
        const card = appState.draftCards.find((c) => c._cid === removeChipBtn.dataset.cardId);
        const field = removeChipBtn.dataset.pickerField;
        const itemId = removeChipBtn.dataset.itemId;
        if (card && Array.isArray(card[field])) {
          card[field] = card[field].filter((x) => x !== itemId);
          renderSimulatorView();
        }
      }
    });

    // Topbar & Recovery Center action buttons
    document.getElementById('btnApplyRecovery').addEventListener('click', applySelectedRecovery);
    document.getElementById('btnUndoRecovery').addEventListener('click', undoRecovery);
    document.getElementById('btnResetSimulation').addEventListener('click', resetSimulation);
    document.getElementById('btnCenterApply').addEventListener('click', applySelectedRecovery);
    document.getElementById('btnCenterUndo').addEventListener('click', undoRecovery);

    document.getElementById('mobileMenuBtn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    // Recovery Center Before/After Morph Slider (live real-time drag)
    const baGridEl = document.getElementById('recoveryBeforeAfterGrid');
    if (baGridEl) {
      baGridEl.addEventListener('input', (e) => {
        if (e.target.id === 'baMorphSlider') {
          appState.baMorphPct = Number(e.target.value);
          const plan = getSelectedPlan();
          const applied = getAppliedPlan();
          if (plan) {
            renderBeforeAfterVisual(baGridEl, plan, appState.recoveryPlans, Boolean(applied && appState.appliedPlanIndex === appState.selectedPlanIndex));
          }
        }
      });
    }

    // Digital Twin filters
    document.getElementById('twinDeptFilter').addEventListener('change', (e) => {
      appState.twinDeptFilter = e.target.value;
      renderDigitalTwinView();
    });
    document.getElementById('twinFocusFilter').addEventListener('change', (e) => {
      appState.twinFocusFilter = e.target.value;
      renderDigitalTwinView();
    });

    // Multi-Select Scenario Checkboxes
    document.getElementById('scenarioTypeSelector').addEventListener('change', (e) => {
      if (!e.target.classList.contains('scenario-type-cb')) return;
      const type = e.target.value;
      if (e.target.checked) {
        if (!appState.draftCards.some((c) => c.scenarioType === type)) {
          const card = createBlankCard(type);
          if (card) appState.draftCards.push(card);
        }
      } else {
        appState.draftCards = appState.draftCards.filter((c) => c.scenarioType !== type);
      }
      renderSimulatorView();
    });

    // Disruption Cards Input / Change Delegation
    const cardsContainer = document.getElementById('disruptionCardsContainer');
    cardsContainer.addEventListener('input', (e) => {
      if (e.target.classList.contains('picker-search-input')) {
        const card = appState.draftCards.find((c) => c._cid === e.target.dataset.cardId);
        if (card) {
          card._searchQuery = e.target.value;
          const pos = e.target.selectionStart;
          renderDisruptionCards();
          const restored = cardsContainer.querySelector(`.picker-search-input[data-card-id="${card._cid}"]`);
          if (restored) {
            restored.focus();
            if (typeof pos === 'number') restored.setSelectionRange(pos, pos);
          }
        }
      }
    });

    cardsContainer.addEventListener('change', (e) => {
      const el = e.target;
      const card = appState.draftCards.find((c) => c._cid === el.dataset.cardId);
      if (!card) return;

      if (el.classList.contains('picker-item-cb')) {
        const field = el.dataset.pickerField;
        const val = el.value;
        card[field] = Array.isArray(card[field]) ? card[field] : [];
        if (el.checked) {
          if (!card[field].includes(val)) card[field].push(val);
        } else {
          card[field] = card[field].filter((x) => x !== val);
        }
        renderSimulatorView();
        return;
      }

      if (el.classList.contains('fac-member-select')) {
        const idx = Number(el.dataset.facIdx);
        if (card.scheduleMode === 'individual') {
          card.facultyEntries[idx].facultyId = el.value;
        } else {
          card.facultyIds[idx] = el.value;
        }
        renderSimulatorView();
        return;
      }

      if (el.classList.contains('fac-entry-reason')) {
        const idx = Number(el.dataset.facIdx);
        card.facultyEntries[idx].reason = el.value;
        renderSimulatorView();
        return;
      }

      if (el.classList.contains('tp-fullday-cb')) {
        const target = el.dataset.entryIdx !== undefined ? card.facultyEntries[Number(el.dataset.entryIdx)] : card;
        target.fullDay = el.checked;
        if (el.checked) {
          target.timePeriods = [{ startTime: OPERATING_HOURS.startTime, endTime: OPERATING_HOURS.endTime }];
        }
        renderSimulatorView();
        return;
      }

      if (el.classList.contains('tp-perdate-cb')) {
        const target = el.dataset.entryIdx !== undefined ? card.facultyEntries[Number(el.dataset.entryIdx)] : card;
        target.perDateTimes = el.checked;
        if (el.checked) {
          target.fullDay = false;
          target.dateTimePeriods = target.dateTimePeriods || {};
          (target.dates || []).forEach((dStr) => {
            if (!target.dateTimePeriods[dStr]) {
              target.dateTimePeriods[dStr] = Engine.cloneState(target.timePeriods || [{ startTime: '', endTime: '' }]);
            }
          });
        }
        renderSimulatorView();
        return;
      }

      if (el.classList.contains('tp-input')) {
        const target = el.dataset.entryIdx !== undefined ? card.facultyEntries[Number(el.dataset.entryIdx)] : card;
        const idx = Number(el.dataset.tpIdx);
        const fld = el.dataset.tpField;
        const dateKey = el.dataset.dateKey;
        if (dateKey) {
          target.dateTimePeriods[dateKey][idx][fld] = el.value;
        } else {
          target.timePeriods[idx][fld] = el.value;
        }
        renderSimulatorView();
        return;
      }

      if (el.classList.contains('card-field')) {
        const field = el.dataset.cfg;
        let val = el.value;
        if (val !== '') {
          if (el.dataset.num === 'true') val = Number(val);
          if (el.dataset.bool === 'true') val = val === 'true';
        }
        card[field] = val;

        if (card.scenarioType === 'SCN-FACULTY-ABSENCE' && field === 'department') {
          card.facultyIds = Array.from({ length: card.facultyCount || 1 }, () => '');
          card.facultyEntries.forEach((en) => { en.facultyId = ''; });
        } else if (card.scenarioType === 'SCN-LAB-FAILURE' && field === 'department') {
          card.labIds = [];
        } else if (card.scenarioType === 'SCN-CLASSROOM-UNAVAILABLE' && field === 'building') {
          card.classroomIds = [];
        } else if (card.scenarioType === 'SCN-EXAM-HALL-FAILURE' && field === 'roomId') {
          card.examId = '';
          card.availableSeating = '';
        } else if (card.scenarioType === 'SCN-POWER-FAILURE' && field === 'backupAvailable') {
          card.backupCapacityPct = val === false ? 0 : '';
        }
        renderSimulatorView();
      }
    });

    document.getElementById('btnAddFailureQueue').addEventListener('click', () => addBuilderToQueue(null));
    document.getElementById('btnSimulateCustom').addEventListener('click', () => triggerCustomFailures(false));
    document.getElementById('btnRunCombinedQueue').addEventListener('click', () => triggerCustomFailures(true));
    document.getElementById('btnClearQueue').addEventListener('click', () => {
      appState.queuedFailureConfigs = [];
      appState.editingQueueId = null;
      renderSimulatorView();
    });
    document.getElementById('btnClearCustom').addEventListener('click', () => {
      appState.draftCards = [];
      appState.editingQueueId = null;
      renderSimulatorView();
    });

    // Timetable filters
    document.getElementById('ttDeptFilter').addEventListener('change', (e) => {
      appState.ttDeptFilter = e.target.value;
      renderTimetableView();
    });
    document.getElementById('ttSectionFilter').addEventListener('change', (e) => {
      appState.ttSectionFilter = e.target.value;
      renderTimetableView();
    });
    document.getElementById('ttModeFilter').addEventListener('change', (e) => {
      appState.ttModeFilter = e.target.value;
      renderTimetableView();
    });

    // Institutional data tabs & search
    document.getElementById('dataTabsBar').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      appState.dataTab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
      renderDataView();
    });
    document.getElementById('dataSearchInput').addEventListener('input', (e) => {
      appState.dataSearch = e.target.value;
      renderDataView();
    });

    // Readiness Audit controls (Feature 1)
    const btnRunAudit = document.getElementById('btnRunReadinessAudit');
    if (btnRunAudit) btnRunAudit.addEventListener('click', startReadinessAudit);

    const btnClearAudit = document.getElementById('btnClearReadinessAudit');
    if (btnClearAudit) {
      btnClearAudit.addEventListener('click', () => {
        if (window.OMNIS_READINESS) window.OMNIS_READINESS.clearAuditResult();
        appState.readinessAudit = null;
        renderReadinessView();
      });
    }

    const cbN2 = document.getElementById('cbAuditIncludeN2');
    if (cbN2) {
      cbN2.addEventListener('change', (e) => {
        appState.readinessIncludeN2 = e.target.checked;
      });
    }

    const catAudit = document.getElementById('readinessCategoryFilter');
    if (catAudit) {
      catAudit.addEventListener('change', (e) => {
        appState.readinessCategoryFilter = e.target.value;
        renderReadinessView();
      });
    }
  }

  // Boot (hydrate cached Readiness Audit if available in localStorage)
  if (window.OMNIS_READINESS) {
    appState.readinessAudit = window.OMNIS_READINESS.loadAuditResult();
  }
  recomputeSimulation();
  bindEvents();
  renderAll();
})();
