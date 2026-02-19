import { query } from '../config/database.js';

/**
 * Period Rating Service
 * Handles calculation of ratings for pre and post-transition periods
 * Follows DRY and KISS principles
 */

/**
 * Calculate weighted average rating for a period
 */
export async function calculatePeriodRating(employeeId, cycleId, quarter, periodType, transitionId = null) {
  // Get all KRAs for this period
  let kraSql = `
    SELECT id, weight, title
    FROM kras
    WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3 AND period_type = $4::period_type
  `;
  const kraParams = [employeeId, cycleId, quarter, periodType];
  
  if (transitionId) {
    kraSql += ' AND transition_id = $5';
    kraParams.push(transitionId);
  } else {
    kraSql += ' AND transition_id IS NULL';
  }
  
  const krasResult = await query(kraSql, kraParams);
  const kras = krasResult.rows;
  
  if (kras.length === 0) {
    return null;
  }
  
  // Get all KPIs for these KRAs
  const kraIds = kras.map(k => k.id);
  const kpisResult = await query(
    `SELECT id, kra_id, weight, title
     FROM goals
     WHERE kra_id = ANY($1::uuid[]) AND period_type = $2::period_type`,
    [kraIds, periodType]
  );
  const kpis = kpisResult.rows;
  
  // Get manager ratings for KPIs from quarterly_manager_reviews
  const kpiRatingsResult = await query(
    `SELECT gmr.goal_id, gmr.rating
     FROM quarterly_kpi_manager_feedback gmr
     JOIN quarterly_manager_reviews qmr ON gmr.manager_review_id = qmr.id
     WHERE qmr.employee_id = $1 
       AND qmr.cycle_id = $2 
       AND qmr.quarter = $3
       AND qmr.period_type = $4::period_type
       AND gmr.goal_id = ANY($5::uuid[])`,
    [employeeId, cycleId, quarter, periodType, kpis.map(k => k.id)]
  );
  
  const kpiRatings = {};
  kpiRatingsResult.rows.forEach(row => {
    kpiRatings[row.goal_id] = row.rating;
  });
  
  // Calculate KRA ratings (weighted average of KPIs)
  const kraRatings = {};
  kras.forEach(kra => {
    const kraKpis = kpis.filter(k => k.kra_id === kra.id);
    if (kraKpis.length === 0) {
      kraRatings[kra.id] = null;
      return;
    }
    
    let totalWeightedRating = 0;
    let totalWeight = 0;
    let hasAnyRating = false;
    
    kraKpis.forEach(kpi => {
      const rating = kpiRatings[kpi.id];
      if (rating !== null && rating !== undefined) {
        const kpiWeight = Number(kpi.weight || 0);
        totalWeightedRating += Number(rating) * kpiWeight;
        totalWeight += kpiWeight;
        hasAnyRating = true;
      }
    });
    
    kraRatings[kra.id] = hasAnyRating && totalWeight > 0 ? totalWeightedRating / totalWeight : null;
  });
  
  // Calculate period rating (weighted average of KRAs)
  let totalWeightedRating = 0;
  let totalWeight = 0;
  let hasAnyRating = false;
  
  kras.forEach(kra => {
    const rating = kraRatings[kra.id];
    if (rating !== null && rating !== undefined) {
      const kraWeight = Number(kra.weight || 0);
      totalWeightedRating += Number(rating) * kraWeight;
      totalWeight += kraWeight;
      hasAnyRating = true;
    }
  });
  
  return hasAnyRating && totalWeight > 0 ? totalWeightedRating / totalWeight : null;
}

/**
 * Store period rating
 */
export async function storePeriodRating(employeeId, cycleId, quarter, periodType, transitionId, periodStartDate, periodEndDate, rating, managerId) {
  const periodDays = Math.ceil((new Date(periodEndDate) - new Date(periodStartDate)) / (1000 * 60 * 60 * 24)) + 1;
  
  // Check if record exists first (since we can't use expression in ON CONFLICT)
  const existing = await query(
    `SELECT id FROM quarterly_period_ratings 
     WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3 AND period_type = $4::period_type
       AND (transition_id = $5 OR (transition_id IS NULL AND $5 IS NULL))`,
    [employeeId, cycleId, quarter, periodType, transitionId]
  );
  
  if (existing.rows.length > 0) {
    // Update existing record
    const result = await query(
      `UPDATE quarterly_period_ratings 
       SET weighted_avg_rating = $1,
           manager_id = $2,
           is_final = true,
           updated_at = NOW()
       WHERE employee_id = $3 AND cycle_id = $4 AND quarter = $5 AND period_type = $6::period_type
         AND (transition_id = $7 OR (transition_id IS NULL AND $7 IS NULL))
       RETURNING *`,
      [rating, managerId, employeeId, cycleId, quarter, periodType, transitionId]
    );
    return result.rows[0];
  } else {
    // Insert new record
    const result = await query(
      `INSERT INTO quarterly_period_ratings (
        employee_id, cycle_id, quarter, transition_id, period_type,
        period_start_date, period_end_date, period_days,
        weighted_avg_rating, manager_id, is_final
      ) VALUES ($1, $2, $3, $4, $5::period_type, $6, $7, $8, $9, $10, true)
      RETURNING *`,
      [employeeId, cycleId, quarter, transitionId, periodType, periodStartDate, periodEndDate, periodDays, rating, managerId]
    );
    return result.rows[0];
  }
}

/**
 * Calculate final quarterly rating from pre and post-transition ratings
 */
export async function calculateFinalQuarterRating(employeeId, cycleId, quarter, useTimeWeighted = false) {
  // Get period ratings
  const periodRatingsResult = await query(
    `SELECT period_type, weighted_avg_rating, period_days, transition_id
     FROM quarterly_period_ratings
     WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3 AND is_final = true
     ORDER BY period_type`,
    [employeeId, cycleId, quarter]
  );
  
  const periodRatings = periodRatingsResult.rows;
  
  if (periodRatings.length === 0) {
    return null;
  }
  
  // If only one period (full_quarter), return that rating
  if (periodRatings.length === 1 && periodRatings[0].period_type === 'full_quarter') {
    return {
      finalRating: periodRatings[0].weighted_avg_rating,
      preTransitionRating: null,
      postTransitionRating: null,
      calculationMethod: 'single_period'
    };
  }
  
  // Get pre and post transition ratings
  const preTransition = periodRatings.find(p => p.period_type === 'pre_transition');
  const postTransition = periodRatings.find(p => p.period_type === 'post_transition');
  
  if (!preTransition || !postTransition) {
    // If one is missing, return the available one
    const available = preTransition || postTransition;
    return {
      finalRating: available.weighted_avg_rating,
      preTransitionRating: preTransition?.weighted_avg_rating || null,
      postTransitionRating: postTransition?.weighted_avg_rating || null,
      calculationMethod: 'single_period_available'
    };
  }
  
  const preRating = parseFloat(preTransition.weighted_avg_rating);
  const postRating = parseFloat(postTransition.weighted_avg_rating);
  const preDays = preTransition.period_days || 0;
  const postDays = postTransition.period_days || 0;
  
  let finalRating;
  let calculationMethod;
  
  if (useTimeWeighted && preDays > 0 && postDays > 0) {
    // Time-weighted average
    const totalDays = preDays + postDays;
    finalRating = (preRating * preDays + postRating * postDays) / totalDays;
    calculationMethod = 'time_weighted';
  } else {
    // Simple average
    finalRating = (preRating + postRating) / 2;
    calculationMethod = 'simple_average';
  }
  
  return {
    finalRating,
    preTransitionRating: preRating,
    postTransitionRating: postRating,
    preTransitionDays: preDays,
    postTransitionDays: postDays,
    calculationMethod,
    transitionId: preTransition.transition_id || postTransition.transition_id
  };
}

/**
 * Store final quarterly rating
 */
export async function storeFinalQuarterRating(employeeId, cycleId, quarter, ratingData) {
  const {
    finalRating,
    preTransitionRating,
    postTransitionRating,
    preTransitionDays,
    postTransitionDays,
    calculationMethod,
    transitionId,
    calculatedBy
  } = ratingData;
  
  const result = await query(
    `INSERT INTO quarterly_final_ratings (
      employee_id, cycle_id, quarter, transition_id,
      pre_transition_rating, post_transition_rating,
      pre_transition_days, post_transition_days,
      final_quarterly_rating, calculation_method,
      is_final, calculated_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11)
    ON CONFLICT (employee_id, cycle_id, quarter)
    DO UPDATE SET
      pre_transition_rating = EXCLUDED.pre_transition_rating,
      post_transition_rating = EXCLUDED.post_transition_rating,
      pre_transition_days = EXCLUDED.pre_transition_days,
      post_transition_days = EXCLUDED.post_transition_days,
      final_quarterly_rating = EXCLUDED.final_quarterly_rating,
      calculation_method = EXCLUDED.calculation_method,
      is_final = true,
      calculated_by = EXCLUDED.calculated_by,
      calculated_at = NOW(),
      updated_at = NOW()
    RETURNING *`,
    [
      employeeId, cycleId, quarter, transitionId,
      preTransitionRating, postTransitionRating,
      preTransitionDays, postTransitionDays,
      finalRating, calculationMethod,
      calculatedBy
    ]
  );
  
  // Update manager_evaluations table
  const quarterColumn = `q${quarter}_rating`;
  const preColumn = `q${quarter}_pre_transition_rating`;
  const postColumn = `q${quarter}_post_transition_rating`;
  const transitionColumn = `q${quarter}_transition_id`;
  
  await query(
    `UPDATE manager_evaluations
     SET ${quarterColumn} = $1,
         ${preColumn} = $2,
         ${postColumn} = $3,
         ${transitionColumn} = $4,
         updated_at = NOW()
     WHERE employee_id = $5 AND cycle_id = $6`,
    [finalRating, preTransitionRating, postTransitionRating, transitionId, employeeId, cycleId]
  );
  
  return result.rows[0];
}
