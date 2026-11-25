/**
 * OMNIS-X — Intelligent Campus Recovery System
 * Feature 1: Zero-Failure Readiness Audit (N-1, Optional N-2)
 *
 * Loops cleanly over every institutional resource (faculty, classrooms, labs, buses,
 * power zones, and admin resources) using existing OMNIS_ENGINE simulation & recovery,
 * without duplicating simulation logic.
 */

(function (global) {
  'use strict';

  const READINESS_WEIGHTS = {
    recoverabilityWeight: 0.50,
    studentExposureWeight: 0.25,
    criticalExposureWeight: 0.25,
    studentPenaltyScale: 2.5,
    criticalPenaltyPerItem: 25
  };

  const STORAGE_KEY = 'omnisx_readiness_audit_v1';

  /**
   * Collect all individual institutional resources to stress-test in N-1 mode.
   */
  function collectAuditableResources(state) {
    const list = [];
    (state.faculty || []).forEach((f) => {
      list.push({ id: f.id, name: f.name, category: 'Faculty', group: f.department });
    });
    (state.classrooms || []).forEach((c) => {
      list.push({
        id: c.id,
        name: c.name,
        category: c.type === 'exam-hall' ? 'Exam Hall' : 'Classroom',
        group: `${c.block} (${c.powerZone})`
      });
    });
    (state.labs || []).forEach((l) => {
      list.push({ id: l.id, name: l.name, category: 'Laboratory', group: `${l.department} (${l.powerZone})` });
    });
    (state.buses || []).forEach((b) => {
      list.push({ id: b.id, name: b.name, category: 'Bus', group: b.route });
    });
    ['PZ-1', 'PZ-2', 'PZ-3'].forEach((pz) => {
      list.push({ id: pz, name: `Power Zone ${pz}`, category: 'Power Zone', group: pz });
    });
    (state.admin || []).forEach((a) => {
      list.push({ id: a.id, name: a.name, category: 'Admin', group: a.category });
    });
    return list;
  }

  /**
   * Evaluate a single resource ([id]) or pair ([id1, id2]) via existing OMNIS_ENGINE functions.
   */
  function evaluateTarget(state, targetIds, meta) {
    const Engine = global.OMNIS_ENGINE;
    const { DAYS, SLOTS } = global.OMNIS_DATA;

    const cascadeResult = Engine.simulateCascade(state, targetIds, []);
    const plans = Engine.generateRecoveryPlans(cascadeResult);
    const bestPlan = plans.length > 0 ? plans[0] : null;

    const impactedOccurrences = cascadeResult.impactedOccurrences || [];
    const studentsAffected = cascadeResult.metrics.affectedStudents || 0;
    const impactedSessions = cascadeResult.metrics.impactedSessionsCount || 0;

    let studentsRemaining = 0;
    let recoveryPct = 100;
    let criticalUnprotected = 0;
    let unresolvedConflicts = 0;
    let recoveryCost = 0;
    let bestPlanName = 'Zero Impact';

    if (bestPlan) {
      const st = bestPlan.stats;
      studentsRemaining = st.affectedStudentsAfter;
      recoveryPct = st.recoveryPct;
      criticalUnprotected = st.unresolvedCriticalCount;
      unresolvedConflicts = st.unresolvedConflicts;
      recoveryCost = st.recoveryCost;
      bestPlanName = bestPlan.name;
    } else if (impactedSessions > 0 || studentsAffected > 0) {
      studentsRemaining = studentsAffected;
      recoveryPct = 0;
      unresolvedConflicts = impactedSessions;
      criticalUnprotected = impactedOccurrences.filter(
        (o) => o.activity.activityType === 'EXAM' || o.activity.activityType === 'PLACEMENT'
      ).length;
    }

    const fullyRecoverable =
      unresolvedConflicts === 0 &&
      criticalUnprotected === 0 &&
      studentsRemaining === 0 &&
      recoveryPct >= 100;

    // Build Day|Slot blast-radius counts for Vulnerability Heatmap
    const daySlotCounts = {};
    DAYS.forEach((d) => {
      SLOTS.forEach((s) => {
        daySlotCounts[`${d}|${s.id}`] = 0;
      });
    });

    const nodeImpactCount = Math.max(0, (cascadeResult.bfsTrace || []).length - targetIds.length);
    impactedOccurrences.forEach((occ) => {
      const k = `${occ.weekday}|${occ.activity.slotId}`;
      if (Object.prototype.hasOwnProperty.call(daySlotCounts, k)) {
        // Weight session + student exposure per cell cleanly for blast-radius coloring
        daySlotCounts[k] += 1;
      }
    });

    // Deterministic composite risk score for SPOF ranking & N-2 candidate selection
    const riskScore =
      studentsAffected * 2 +
      impactedSessions * 20 +
      criticalUnprotected * 250 +
      unresolvedConflicts * 120 +
      (!fullyRecoverable ? 180 : 0) +
      Math.round(recoveryCost * 0.25) +
      nodeImpactCount;

    return {
      id: meta.id,
      ids: targetIds,
      name: meta.name,
      category: meta.category,
      group: meta.group,
      impactedSessions,
      studentsAffected,
      studentsRemaining,
      recoveryPct,
      criticalUnprotected,
      unresolvedConflicts,
      recoveryCost,
      fullyRecoverable,
      bestPlanName,
      healthBefore: cascadeResult.metrics.campusHealthPct,
      healthAfter: bestPlan ? bestPlan.stats.healthAfter : cascadeResult.metrics.campusHealthPct,
      daySlotCounts,
      riskScore
    };
  }

  /**
   * Compute weighted 0-100 Readiness Score from N-1 audit entries.
   */
  function computeReadinessSummary(state, items, n2Items) {
    const totalCount = items.length;
    const certifiedCount = items.filter((x) => x.fullyRecoverable).length;
    const certifiedPct = totalCount === 0 ? 100 : Math.round((certifiedCount / totalCount) * 1000) / 10;

    const avgStudentsAffected = totalCount === 0
      ? 0
      : items.reduce((sum, x) => sum + x.studentsAffected, 0) / totalCount;
    const avgStudentPct = (avgStudentsAffected / Math.max(1, state.meta.totalStudents)) * 100;

    const totalUnprotectedCritical = items.reduce((sum, x) => sum + x.criticalUnprotected, 0);

    const recoverabilitySub = certifiedPct;
    const studentResilienceSub = Math.max(0, 100 - avgStudentPct * READINESS_WEIGHTS.studentPenaltyScale);
    const criticalProtectionSub = Math.max(0, 100 - totalUnprotectedCritical * READINESS_WEIGHTS.criticalPenaltyPerItem);

    const rawScore =
      recoverabilitySub * READINESS_WEIGHTS.recoverabilityWeight +
      studentResilienceSub * READINESS_WEIGHTS.studentExposureWeight +
      criticalProtectionSub * READINESS_WEIGHTS.criticalExposureWeight;

    const readinessScore = Math.max(0, Math.min(100, Math.round(rawScore * 10) / 10));

    return {
      timestamp: new Date().toISOString(),
      certifiedCount,
      totalCount,
      certifiedPct,
      readinessScore,
      avgStudentsAffected: Math.round(avgStudentsAffected * 10) / 10,
      totalUnprotectedCritical,
      failingItems: items.filter((x) => !x.fullyRecoverable),
      items,
      n2Items: n2Items || [],
      n2CertifiedCount: (n2Items || []).filter((x) => x.fullyRecoverable).length
    };
  }

  /**
   * Run full N-1 (and optional top-15 N-2) readiness audit asynchronously in small chunks
   * so the browser UI remains responsive and displays live progress.
   */
  function runReadinessAudit(state, options = {}) {
    const includeN2 = Boolean(options.includeN2);
    const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
    const chunkSize = Math.max(1, Number(options.chunkSize) || 5);

    const scheduleNext = (fn) => {
      if (typeof global.requestAnimationFrame === 'function') {
        global.requestAnimationFrame(fn);
      } else {
        setTimeout(fn, 0);
      }
    };

    return new Promise((resolve) => {
      const resources = collectAuditableResources(state);
      const n1Total = resources.length;
      const estimatedTotal = includeN2 ? n1Total + 15 : n1Total;
      const n1Results = [];
      let idx = 0;

      function stepN1() {
        const end = Math.min(n1Total, idx + chunkSize);
        for (; idx < end; idx++) {
          const resMeta = resources[idx];
          n1Results.push(evaluateTarget(state, [resMeta.id], resMeta));
        }

        if (onProgress) {
          onProgress({
            phase: 'N-1 Single Failures',
            completed: idx,
            total: estimatedTotal,
            pct: Math.round((idx / Math.max(1, estimatedTotal)) * 100),
            currentLabel: idx > 0 ? n1Results[idx - 1].id : ''
          });
        }

        if (idx < n1Total) {
          scheduleNext(stepN1);
          return;
        }

        if (!includeN2) {
          n1Results.sort((a, b) => b.riskScore - a.riskScore || a.id.localeCompare(b.id));
          const summary = computeReadinessSummary(state, n1Results, []);
          saveAuditResult(summary);
          resolve(summary);
          return;
        }

        // Build top 15 riskiest N-2 pairs from top highest-risk individual nodes
        const rankedN1 = [...n1Results].sort((a, b) => b.riskScore - a.riskScore);
        const topPool = rankedN1.filter((x) => x.studentsAffected > 0 || x.impactedSessions > 0).slice(0, 7);
        const pairSpecs = [];
        for (let i = 0; i < topPool.length; i++) {
          for (let j = i + 1; j < topPool.length; j++) {
            const a = topPool[i];
            const b = topPool[j];
            pairSpecs.push({
              ids: [a.id, b.id],
              combinedPriorRisk: a.riskScore + b.riskScore,
              meta: {
                id: `${a.id} + ${b.id}`,
                name: `${a.name} + ${b.name}`,
                category: `${a.category} + ${b.category}`,
                group: 'N-2 Pair'
              }
            });
          }
        }
        pairSpecs.sort((x, y) => y.combinedPriorRisk - x.combinedPriorRisk);
        const top15Pairs = pairSpecs.slice(0, 15);
        const n2Results = [];
        let pIdx = 0;

        function stepN2() {
          const pEnd = Math.min(top15Pairs.length, pIdx + Math.max(1, Math.min(3, chunkSize)));
          for (; pIdx < pEnd; pIdx++) {
            const pair = top15Pairs[pIdx];
            n2Results.push(evaluateTarget(state, pair.ids, pair.meta));
          }

          if (onProgress) {
            const done = n1Total + pIdx;
            const totalAll = n1Total + top15Pairs.length;
            onProgress({
              phase: 'N-2 Riskiest Pairs',
              completed: done,
              total: totalAll,
              pct: Math.round((done / Math.max(1, totalAll)) * 100),
              currentLabel: pIdx > 0 ? n2Results[pIdx - 1].id : ''
            });
          }

          if (pIdx < top15Pairs.length) {
            scheduleNext(stepN2);
          } else {
            rankedN1.sort((a, b) => b.riskScore - a.riskScore || a.id.localeCompare(b.id));
            n2Results.sort((a, b) => b.riskScore - a.riskScore);
            const summary = computeReadinessSummary(state, rankedN1, n2Results);
            saveAuditResult(summary);
            resolve(summary);
          }
        }

        if (top15Pairs.length === 0) {
          const summary = computeReadinessSummary(state, rankedN1, []);
          saveAuditResult(summary);
          resolve(summary);
        } else {
          scheduleNext(stepN2);
        }
      }

      scheduleNext(stepN1);
    });
  }

  function saveAuditResult(summary) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(summary));
    } catch (_) {
      // Ignore storage quota or private browsing errors cleanly
    }
  }

  function loadAuditResult() {
    try {
      const raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && Array.isArray(parsed.items) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function clearAuditResult() {
    try {
      global.localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      // Ignore storage errors cleanly
    }
  }

  function analyzeVulnerability(state, item) {
    const Engine = global.OMNIS_ENGINE;
    if (!item || !state) return null;
    const targetIds = Array.isArray(item.ids) && item.ids.length ? item.ids : [item.id];
    const sim = Engine.simulateCascade(state, targetIds, []);
    const plans = Engine.generateRecoveryPlans(sim);
    const best = plans[0] || null;
    const actions = best ? best.actions : [];
    const unresolved = actions.filter((a) => !a.resolved);
    const unreroutedTransit = (best && best.transitActions)
      ? best.transitActions.reduce((sum, t) => sum + (t.remainingUnassigned || 0), 0)
      : 0;

    const depNodes = [];
    const seenDep = new Set();
    (sim.bfsTrace || []).forEach((tr) => {
      if (tr.hop > 0 && !seenDep.has(tr.nodeId)) {
        seenDep.add(tr.nodeId);
        depNodes.push(`${tr.nodeId} (${tr.relation.replace(/_/g, ' ')})`);
      }
    });

    const criticalImpacted = (sim.impactedActivities || []).filter(
      (a) => a.activityType === 'EXAM' || a.activityType === 'PLACEMENT'
    );

    const whyVulnerable = item.impactedSessions === 0 && item.studentsAffected === 0
      ? `${item.id} has 0 overlapping scheduled classes or linked commuters in the reference week.`
      : `${item.id} directly disrupts ${item.impactedSessions} scheduled occurrence(s) (${criticalImpacted.length} critical exam/placement) and exposes ${item.studentsAffected} student(s) across ${depNodes.length} dependent institutional path(s).`;

    let whyInsufficient = 'All impacted academic activities and student commuters recovered cleanly (zero residual vulnerability).';
    let recommendation = null;

    if (!item.fullyRecoverable) {
      if (unreroutedTransit > 0 || item.category === 'Bus') {
        const bus = (state.buses || []).find((b) => b.id === item.id);
        const spareFleet = (state.buses || [])
          .filter((b) => b.id !== item.id)
          .reduce((sum, b) => sum + Math.max(0, b.capacity - b.studentLoad), 0);
        whyInsufficient = `Remaining operational buses provide only ${spareFleet} spare seats combined against ${bus ? bus.studentLoad : item.studentsAffected} commuter load on ${item.id}, leaving ${item.studentsRemaining} student(s) unrerouted.`;
        recommendation = {
          kind: 'RESERVE_BUS',
          title: 'Deploy 1 Reserve Feeder Bus (65-seat standby pool)',
          rationale: `Absorbs the ${item.studentsRemaining}-commuter fleet deficit when ${item.id} goes offline.`
        };
      } else if (item.category === 'Laboratory' || unresolved.some((u) => u.activityType === 'LAB')) {
        whyInsufficient = `${unresolved.length} specialized lab session(s) could not relocate due to depleted compatible equipment labs or slot contention.`;
        recommendation = {
          kind: 'BACKUP_LAB',
          title: `Provision Cross-Department Compatible Backup Lab Slot`,
          rationale: `Eliminates single-lab saturation during ${item.id} outages.`
        };
      } else if (item.category === 'Power Zone' || item.id === 'ADM-02') {
        whyInsufficient = `Zone-wide power loss hits multiple classrooms, labs, and network nodes concurrently (${item.studentsAffected} exposed, ${item.recoveryCost} pts recovery overhead).`;
        recommendation = {
          kind: 'ZONE_UPS_BACKUP',
          title: `Add Microgrid / 50% UPS Generator Backup for ${item.id}`,
          rationale: `Keeps core academic blocks powered during grid substation faults.`
        };
      } else if (unresolved.length > 0) {
        const firstBlocker = unresolved[0].rejectedAlternatives && unresolved[0].rejectedAlternatives.length
          ? unresolved[0].rejectedAlternatives.slice(0, 2).join('; ')
          : unresolved[0].explanation;
        whyInsufficient = `${unresolved.length} session(s) stayed unresolved under mandatory rules (${firstBlocker}).`;
        recommendation = {
          kind: 'RESERVE_FACULTY',
          title: `Cross-Train 1 Reserve Faculty in ${(state.faculty.find((f) => f.id === item.id)?.department) || 'Target'} Dept`,
          rationale: `Expands qualified instructor pool to remove unresolved substitutions.`
        };
      } else {
        whyInsufficient = `${item.studentsRemaining} hostel/commuter student(s) remain exposed during hardware restoration (${item.recoveryCost} pts recovery cost).`;
        recommendation = {
          kind: 'BACKUP_INFRA',
          title: `Enable Secondary Utility / Contingency Coverage for ${item.id}`,
          rationale: `Reduces student residential or transit exposure during outages.`
        };
      }
    } else if (item.studentsAffected >= 200 || item.recoveryCost >= 250) {
      if (item.category === 'Power Zone' || item.id === 'ADM-02') {
        recommendation = {
          kind: 'ZONE_UPS_BACKUP',
          title: `Add UPS / Microgrid Feeder Backup for ${item.id}`,
          rationale: `Cuts blast radius (${item.studentsAffected} students, ${item.recoveryCost} recovery cost pts) even though currently recoverable.`
        };
      } else {
        recommendation = {
          kind: 'RESERVE_FACULTY',
          title: `Add Reserve Standby Capacity Around ${item.id}`,
          rationale: `Lowers recovery cost (${item.recoveryCost} pts) and blast radius (${item.studentsAffected} students).`
        };
      }
    }

    return {
      item,
      whyVulnerable,
      contributingDependencies: depNodes.slice(0, 8),
      criticalImpactedIds: criticalImpacted.map((c) => `${c.id} (${c.activityType})`),
      whyInsufficient,
      recommendation
    };
  }

  /**
   * Counterfactual evaluation using a temporary deep clone of state (never mutates baseState or DB).
   */
  function testRecommendedImprovement(baseState, item, baselineAudit = null) {
    const Engine = global.OMNIS_ENGINE;
    if (!baseState || !item) return null;
    const analysis = analyzeVulnerability(baseState, item);
    if (!analysis || !analysis.recommendation) return null;

    const cloned = Engine.cloneState(baseState);
    const rec = analysis.recommendation;
    const targetIds = Array.isArray(item.ids) && item.ids.length ? item.ids : [item.id];

    if (rec.kind === 'RESERVE_BUS') {
      const targetBus = cloned.buses.find((b) => b.id === targetIds[0]);
      cloned.buses.push({
        id: 'BUS-RES-TMP',
        name: 'Standby Contingency Bus (Counterfactual)',
        route: targetBus ? targetBus.route : 'Multi-Corridor Reserve',
        capacity: 75,
        studentLoad: 0,
        linkedSections: [],
        linkedFaculty: []
      });
    } else if (rec.kind === 'BACKUP_LAB') {
      const targetLab = cloned.labs.find((l) => l.id === targetIds[0]) || cloned.labs[0];
      if (targetLab) {
        cloned.labs.push({
          ...targetLab,
          id: `${targetLab.id}-RES`,
          name: `${targetLab.name} (Reserve Pod)`,
          powerZone: targetLab.powerZone === 'PZ-1' ? 'PZ-2' : 'PZ-3',
          requiresNetwork: false
        });
      }
    } else if (rec.kind === 'RESERVE_FACULTY') {
      const refFac = cloned.faculty.find((f) => f.id === targetIds[0]) || cloned.faculty[0];
      const dept = refFac ? refFac.department : 'CSE';
      const deptSubs = cloned.subjects.filter((s) => s.department === dept).map((s) => s.id);
      cloned.faculty.push({
        id: `FAC-RES-TMP`,
        name: `Reserve Specialist (${dept})`,
        department: dept,
        designation: 'Visiting Professor (Standby)',
        qualifications: deptSubs,
        maxWeeklyLoad: 16,
        busId: null,
        isHostelWarden: null
      });
    } else if (rec.kind === 'ZONE_UPS_BACKUP') {
      // Simulate microgrid/UPS decoupling Block rooms in that zone from grid failure by moving half of rooms to alternate feeder
      const z = targetIds[0].startsWith('PZ-') ? targetIds[0] : 'PZ-1';
      let flipped = 0;
      cloned.classrooms.forEach((c) => {
        if (c.powerZone === z && flipped % 2 === 0) c.powerZone = z === 'PZ-1' ? 'PZ-2' : 'PZ-3';
        flipped++;
      });
    } else if (rec.kind === 'BACKUP_INFRA') {
      // Shift hostel backup feeder to secondary zone
      const h = cloned.hostels.find((x) => x.id === targetIds[0]);
      if (h) h.powerZone = h.powerZone === 'PZ-3' ? 'PZ-2' : 'PZ-3';
    }

    // Re-evaluate target & full N-1 clone score cleanly without modifying live baseState
    const projectedTarget = evaluateTarget(cloned, targetIds, {
      id: item.id,
      name: item.name,
      category: item.category,
      group: item.group
    });

    const baseScore = baselineAudit ? baselineAudit.readinessScore : null;
    let projectedScore = baseScore;
    let baseCert = baselineAudit ? baselineAudit.certifiedCount : null;
    let projectedCert = baseCert;

    if (baselineAudit && Array.isArray(baselineAudit.items)) {
      // Re-evaluate resources in affected categories on clone for fast accurate projected institutional readiness score
      const resources = collectAuditableResources(baseState);
      const updatedItems = baselineAudit.items.map((origIt) => {
        const shouldRecheck =
          origIt.id === item.id ||
          (rec.kind === 'RESERVE_BUS' && origIt.category === 'Bus') ||
          (rec.kind === 'ZONE_UPS_BACKUP' && (origIt.category === 'Power Zone' || origIt.id === 'ADM-02')) ||
          (rec.kind === 'BACKUP_LAB' && origIt.category === 'Laboratory') ||
          (rec.kind === 'RESERVE_FACULTY' && origIt.category === 'Faculty' && origIt.group === item.group);
        if (!shouldRecheck) return origIt;
        const meta = resources.find((r) => r.id === origIt.id) || origIt;
        return evaluateTarget(cloned, [origIt.id], meta);
      });
      const projSummary = computeReadinessSummary(cloned, updatedItems, []);
      projectedScore = projSummary.readinessScore;
      projectedCert = projSummary.certifiedCount;
    }

    return {
      targetId: item.id,
      recommendation: rec,
      baseline: {
        recoveryPct: item.recoveryPct,
        studentsRemaining: item.studentsRemaining,
        unresolvedConflicts: item.unresolvedConflicts,
        recoveryCost: item.recoveryCost,
        fullyRecoverable: item.fullyRecoverable,
        readinessScore: baseScore,
        certifiedCount: baseCert
      },
      projected: {
        recoveryPct: projectedTarget.recoveryPct,
        studentsRemaining: projectedTarget.studentsRemaining,
        unresolvedConflicts: projectedTarget.unresolvedConflicts,
        recoveryCost: projectedTarget.recoveryCost,
        fullyRecoverable: projectedTarget.fullyRecoverable,
        readinessScore: projectedScore,
        certifiedCount: projectedCert
      },
      scoreDelta: (baseScore !== null && projectedScore !== null) ? Math.round((projectedScore - baseScore) * 10) / 10 : 0,
      studentsSaved: Math.max(0, item.studentsRemaining - projectedTarget.studentsRemaining)
    };
  }

  global.OMNIS_READINESS = {
    READINESS_WEIGHTS,
    STORAGE_KEY,
    collectAuditableResources,
    evaluateTarget,
    runReadinessAudit,
    analyzeVulnerability,
    testRecommendedImprovement,
    saveAuditResult,
    loadAuditResult,
    clearAuditResult
  };
})(window);
