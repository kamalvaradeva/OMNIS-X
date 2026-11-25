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

  global.OMNIS_READINESS = {
    READINESS_WEIGHTS,
    STORAGE_KEY,
    collectAuditableResources,
    evaluateTarget,
    runReadinessAudit,
    saveAuditResult,
    loadAuditResult,
    clearAuditResult
  };
})(window);
