import { query } from '../config/database.js';

/**
 * GOAL-LEVEL NORMALIZATION SERVICE
 * 
 * This service normalizes ratings ONLY at the Goal/Overall level.
 * KPI and KRA ratings remain unchanged (raw) for auditability.
 * 
 * Process:
 * 1. Fetch Goal Raw Ratings (calculated_overall_rating from quarterly_manager_reviews)
 * 2. Group employees by manager and by grade
 * 3. Normalize goal ratings within each group using Box-Cox (lambda=0.5) + Min-Max
 * 4. Combine manager and grade normalized ratings (50/50)
 * 5. Store raw KPI/KRA ratings for audit (not normalized)
 */

const DEFAULT_CONFIG = {
  minGroupSize: 3,              // Minimum group size for normalization (skip if < 3)
  managerWeight: 0.5,           // Weight for manager-level normalization
  gradeWeight: 0.5,             // Weight for grade-level normalization
  lambda: 0.5,                  // Fixed Box-Cox lambda (business-safe, deterministic)
  roundToDecimals: 2            // Round only at final display
};

/**
 * Box-Cox Transform with fixed lambda = 0.5
 * @param {number} value - Input value (must be > 0)
 * @param {number} lambda - Transformation parameter (default: 0.5)
 * @returns {number} Transformed value
 */
function boxCoxTransform(value, lambda = 0.5) {
  if (value <= 0) {
    throw new Error('Box-Cox transform requires positive values');
  }
  
  if (Math.abs(lambda) < 1e-10) {
    // Lambda ≈ 0: use natural log
    return Math.log(value);
  } else {
    // Lambda ≠ 0: (y^λ - 1) / λ
    return (Math.pow(value, lambda) - 1) / lambda;
  }
}

/**
 * Ensure all values are positive by shifting if needed
 * @param {number[]} values - Array of values
 * @returns {number[]} Positive values
 */
function ensurePositive(values) {
  const minValue = Math.min(...values);
  if (minValue > 0) {
    return values;
  }
  // Shift all values to be positive (add constant)
  const shift = Math.abs(minValue) + 1;
  return values.map(v => v + shift);
}

/**
 * Min-Max scaling to [1, 5] range
 * @param {number} value - Input value
 * @param {number} min - Minimum value in dataset
 * @param {number} max - Maximum value in dataset
 * @returns {number} Scaled value in [1, 5]
 */
function minMaxScale(value, min, max) {
  if (max === min) {
    return 3; // Default to middle if all values same
  }
  return 1 + (value - min) * (5 - 1) / (max - min);
}

/**
 * Normalize goal ratings for a group
 * @param {number[]} rawRatings - Array of raw goal ratings
 * @param {number} lambda - Box-Cox lambda (default: 0.5)
 * @returns {number[]} Normalized ratings in [1, 5]
 */
function normalizeGroup(rawRatings, lambda = 0.5) {
  if (rawRatings.length === 0) {
    return [];
  }
  
  // Ensure positive values
  const positiveRatings = ensurePositive(rawRatings);
  
  // Box-Cox transform
  const transformed = positiveRatings.map(v => boxCoxTransform(v, lambda));
  
  // Min-Max scale to [1, 5]
  const min = Math.min(...transformed);
  const max = Math.max(...transformed);
  const scaled = transformed.map(v => minMaxScale(v, min, max));
  
  return scaled;
}

/**
 * Calculate KRA rating from KPI ratings (weighted average)
 * @param {string} kraId - KRA ID
 * @param {Array} kpis - Array of KPIs with kra_id and weight
 * @param {Object} kpiRatings - Map of goal_id -> rating
 * @returns {number|null} KRA rating or null if no ratings
 */
function calculateKRARating(kraId, kpis, kpiRatings) {
  const kraKpis = kpis.filter(k => k.kra_id === kraId);
  if (kraKpis.length === 0) return null;
  
  let totalWeightedRating = 0;
  let totalWeight = 0;
  let hasAnyRating = false;
  
  for (const kpi of kraKpis) {
    const rating = kpiRatings[kpi.id];
    if (rating !== null && rating !== undefined) {
      const kpiWeight = Number(kpi.weight || 0);
      totalWeightedRating += Number(rating) * kpiWeight;
      totalWeight += kpiWeight;
      hasAnyRating = true;
    }
  }
  
  if (!hasAnyRating || totalWeight === 0) return null;
  return totalWeightedRating / totalWeight;
}

/**
 * Goal-Level Normalization
 * Normalizes ratings ONLY at Goal/Overall level
 * @param {number} quarter - Quarter number (1-4)
 * @param {string} cycleId - Performance cycle ID
 * @param {string} hrUserId - HR user ID performing normalization
 * @param {object} config - Optional configuration override
 * @returns {Promise<{processed: number, skipped: number, message: string, runId: string}>}
 */
export async function normalizeRatings(quarter, cycleId, hrUserId, config = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  try {
    // Step 1: Fetch all submitted manager reviews with goal raw ratings
    const reviewsQuery = `
      SELECT 
        qmr.id,
        qmr.employee_id,
        qmr.reviewer_id as manager_id,
        qmr.calculated_overall_rating as raw_rating,
        e.grade
      FROM quarterly_manager_reviews qmr
      JOIN employees e ON e.id = qmr.employee_id
      WHERE qmr.cycle_id = $1
        AND qmr.quarter = $2
        AND qmr.status = 'submitted'
        AND qmr.calculated_overall_rating IS NOT NULL
        AND qmr.calculated_overall_rating > 0
        AND (qmr.period_type = 'full_quarter'::period_type OR qmr.period_type IS NULL)
    `;
    
    const reviewsResult = await query(reviewsQuery, [cycleId, quarter]);
    const reviews = reviewsResult.rows;
    
    console.log(`Found ${reviews.length} submitted manager reviews for quarter ${quarter}, cycle ${cycleId}`);
    
    if (reviews.length === 0) {
      return { processed: 0, skipped: 0, message: 'No submitted ratings found for this quarter', runId: null };
    }
    
    // Step 2: Fetch raw KPI and KRA ratings for audit (NOT normalized)
    const employeeIds = reviews.map(r => r.employee_id);
    
    // Fetch KPI ratings (for audit storage)
    const kpiRatingsQuery = `
      SELECT 
        gmr.goal_id,
        gmr.rating,
        gmr.manager_review_id,
        qmr.employee_id,
        g.kra_id,
        g.weight as kpi_weight
      FROM quarterly_kpi_manager_feedback gmr
      JOIN quarterly_manager_reviews qmr ON gmr.manager_review_id = qmr.id
      JOIN goals g ON g.id = gmr.goal_id
      WHERE qmr.cycle_id = $1
        AND qmr.quarter = $2
        AND qmr.status = 'submitted'
        AND gmr.rating IS NOT NULL
        AND gmr.rating > 0
        AND (qmr.period_type = 'full_quarter'::period_type OR qmr.period_type IS NULL)
    `;
    
    const kpiRatingsResult = await query(kpiRatingsQuery, [cycleId, quarter]);
    const kpiRatings = kpiRatingsResult.rows;
    
    // Fetch KRAs and KPIs structure for calculating raw KRA ratings
    const krasQuery = `
      SELECT id, weight, employee_id
      FROM kras
      WHERE cycle_id = $1
        AND (period_type = 'full_quarter'::period_type OR period_type IS NULL)
    `;
    
    const krasResult = await query(krasQuery, [cycleId]);
    const allKras = krasResult.rows;
    
    const kpisQuery = `
      SELECT id, kra_id, weight, employee_id
      FROM goals
      WHERE cycle_id = $1 AND kra_id IS NOT NULL
        AND (period_type = 'full_quarter'::period_type OR period_type IS NULL)
    `;
    
    const kpisResult = await query(kpisQuery, [cycleId]);
    const allKpis = kpisResult.rows;
    
    // Calculate raw KRA ratings for storage (from raw KPIs)
    const rawKraRatings = new Map(); // employee_id -> {kra_id -> rating}
    
    for (const review of reviews) {
      const employeeId = review.employee_id;
      const employeeKras = allKras.filter(k => k.employee_id === employeeId);
      const employeeKpis = allKpis.filter(k => k.employee_id === employeeId);
      
      // Get raw KPI ratings for this employee
      const employeeKpiRatings = {};
      kpiRatings
        .filter(k => String(k.employee_id || '').trim() === String(employeeId || '').trim())
        .forEach(k => {
          employeeKpiRatings[k.goal_id] = parseFloat(k.rating);
        });
      
      // Calculate raw KRA ratings (from raw KPIs)
      const rawKras = {};
      employeeKras.forEach(kra => {
        const kraRating = calculateKRARating(kra.id, employeeKpis, employeeKpiRatings);
        if (kraRating !== null) {
          rawKras[kra.id] = kraRating;
        }
      });
      rawKraRatings.set(employeeId, rawKras);
    }
    
    // Check existing normalized ratings to skip PUBLISHED ones (immutable)
    const existingQuery = `
      SELECT employee_id, status
      FROM normalized_ratings
      WHERE performance_cycle_id = $1 AND quarter = $2 AND status = 'PUBLISHED'
    `;
    const existingResult = await query(existingQuery, [cycleId, quarter]);
    const publishedEmployeeIds = new Set(existingResult.rows.map(r => r.employee_id));
    
    // Filter out PUBLISHED records (immutable - cannot be modified)
    const reviewsToProcess = reviews.filter(r => !publishedEmployeeIds.has(r.employee_id));
    
    console.log(`Reviews to process: ${reviewsToProcess.length} (${reviews.length} total, ${reviews.length - reviewsToProcess.length} already published and immutable)`);
    
    if (reviewsToProcess.length === 0) {
      return { 
        processed: 0, 
        skipped: reviews.length, 
        message: 'All ratings already published and are immutable. Cannot rerun normalization on published records.', 
        runId: null 
      };
    }
    
    // Step 3: Group employees by manager and by grade
    const managerGroups = new Map(); // managerId -> [{employeeId, rawRating, grade}]
    const gradeGroups = new Map();   // grade -> [{employeeId, rawRating, managerId}]
    
    reviewsToProcess.forEach(review => {
      const managerId = review.manager_id;
      const grade = review.grade || 'UNKNOWN';
      const rawRating = parseFloat(review.raw_rating);
      
      // Group by manager
      if (!managerGroups.has(managerId)) {
        managerGroups.set(managerId, []);
      }
      managerGroups.get(managerId).push({
        employeeId: review.employee_id,
        rawRating,
        grade
      });
      
      // Group by grade
      if (!gradeGroups.has(grade)) {
        gradeGroups.set(grade, []);
      }
      gradeGroups.get(grade).push({
        employeeId: review.employee_id,
        rawRating,
        managerId
      });
    });
    
    // Step 4: Normalize goal ratings at manager level
    const managerNormalizedRatings = new Map(); // employeeId -> normalized rating
    
    for (const [managerId, employees] of managerGroups) {
      const rawRatings = employees.map(e => e.rawRating);
      
      if (employees.length < finalConfig.minGroupSize) {
        // Group too small - use raw ratings
        employees.forEach(emp => {
          managerNormalizedRatings.set(emp.employeeId, emp.rawRating);
        });
        continue;
      }
      
      // Normalize the group
      const normalized = normalizeGroup(rawRatings, finalConfig.lambda);
      
      // Map normalized ratings back to employees
      employees.forEach((emp, index) => {
        managerNormalizedRatings.set(emp.employeeId, normalized[index]);
      });
    }
    
    // Step 5: Normalize goal ratings at grade level
    const gradeNormalizedRatings = new Map(); // employeeId -> normalized rating
    
    for (const [grade, employees] of gradeGroups) {
      const rawRatings = employees.map(e => e.rawRating);
      
      if (employees.length < finalConfig.minGroupSize) {
        // Group too small - use raw ratings
        employees.forEach(emp => {
          gradeNormalizedRatings.set(emp.employeeId, emp.rawRating);
        });
        continue;
      }
      
      // Normalize the group
      const normalized = normalizeGroup(rawRatings, finalConfig.lambda);
      
      // Map normalized ratings back to employees
      employees.forEach((emp, index) => {
        gradeNormalizedRatings.set(emp.employeeId, normalized[index]);
      });
    }
    
    // Step 6: Combine manager and grade normalized ratings
    const normalizedResults = [];
    
    for (const review of reviewsToProcess) {
      const employeeId = review.employee_id;
      const rawOverallRating = parseFloat(review.raw_rating);
      
      const managerNormalized = managerNormalizedRatings.get(employeeId);
      const gradeNormalized = gradeNormalizedRatings.get(employeeId);
      
      // Combine manager and grade normalized ratings
      let finalRating = null;
      if (managerNormalized !== undefined && gradeNormalized !== undefined) {
        finalRating = finalConfig.managerWeight * managerNormalized + 
                     finalConfig.gradeWeight * gradeNormalized;
      } else if (managerNormalized !== undefined) {
        finalRating = managerNormalized;
      } else if (gradeNormalized !== undefined) {
        finalRating = gradeNormalized;
      } else {
        finalRating = rawOverallRating; // Fallback to raw
      }
      
      // Prepare raw KPI ratings array for storage (for audit)
      const employeeKpiRatingsArray = kpiRatings
        .filter(k => String(k.employee_id || '').trim() === String(employeeId || '').trim())
        .map(k => ({
          goal_id: k.goal_id,
          rating: parseFloat(k.rating),
          weight: parseFloat(k.kpi_weight || 0)
        }));
      
      // Prepare raw KRA ratings array for storage (for audit)
      const rawKrasForEmployee = rawKraRatings.get(employeeId) || {};
      const employeeKras = allKras.filter(k => k.employee_id === employeeId);
      const employeeKraRatingsArray = employeeKras.map(kra => ({
        kra_id: kra.id,
        rating: rawKrasForEmployee[kra.id] ?? null,
        weight: parseFloat(kra.weight || 0)
      }));
      
      normalizedResults.push({
        employee_id: employeeId,
        manager_id: review.manager_id,
        raw_rating: rawOverallRating,
        boxcox_manager_level_rating: managerNormalized ?? null,
        boxcox_grade_level_rating: gradeNormalized ?? null,
        final_normalized_rating: finalRating,
        normalized_kpi_ratings: null, // KPIs not normalized
        normalized_kra_ratings: null, // KRAs not normalized
        raw_kpi_ratings: employeeKpiRatingsArray,
        raw_kra_ratings: employeeKraRatingsArray
      });
    }
    
    console.log(`Created ${normalizedResults.length} normalized results`);
    
    // Calculate summary statistics
    const allRawRatings = reviewsToProcess.map(r => parseFloat(r.raw_rating));
    const avgRaw = allRawRatings.length > 0 
      ? allRawRatings.reduce((a, b) => a + b, 0) / allRawRatings.length 
      : null;
    const avgNormalized = normalizedResults.length > 0
      ? normalizedResults.reduce((sum, r) => sum + (r.final_normalized_rating || 0), 0) / normalizedResults.length
      : null;
    const minRaw = allRawRatings.length > 0 ? Math.min(...allRawRatings) : null;
    const maxRaw = allRawRatings.length > 0 ? Math.max(...allRawRatings) : null;
    const minNormalized = normalizedResults.length > 0 
      ? Math.min(...normalizedResults.map(r => r.final_normalized_rating || 0))
      : null;
    const maxNormalized = normalizedResults.length > 0 
      ? Math.max(...normalizedResults.map(r => r.final_normalized_rating || 0))
      : null;
    
    // Create normalization run record
    const runInsertQuery = `
      INSERT INTO normalization_runs (
        performance_cycle_id, quarter, run_by, total_employees, processed_count, skipped_count,
        manager_weight, grade_weight, min_group_size,
        avg_raw_rating, avg_normalized_rating, min_raw_rating, max_raw_rating,
        min_normalized_rating, max_normalized_rating
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING id
    `;
    
    const runParams = [
      cycleId ?? null, 
      quarter ?? null, 
      hrUserId ?? null, 
      reviews.length, 
      normalizedResults.length,
      reviews.length - reviewsToProcess.length,
      finalConfig.managerWeight ?? 0.5, 
      finalConfig.gradeWeight ?? 0.5, 
      finalConfig.minGroupSize ?? 3,
      (avgRaw !== undefined && !isNaN(avgRaw)) ? avgRaw : null, 
      (avgNormalized !== undefined && !isNaN(avgNormalized)) ? avgNormalized : null, 
      (minRaw !== undefined && !isNaN(minRaw)) ? minRaw : null, 
      (maxRaw !== undefined && !isNaN(maxRaw)) ? maxRaw : null, 
      (minNormalized !== undefined && !isNaN(minNormalized)) ? minNormalized : null, 
      (maxNormalized !== undefined && !isNaN(maxNormalized)) ? maxNormalized : null
    ];
    
    let runResult;
    try {
      runResult = await query(runInsertQuery, runParams);
    } catch (error) {
      console.error('Error inserting normalization run:', error);
      throw error;
    }
    
    const runId = runResult.rows[0].id;
    
    // Upsert to normalized_ratings table
    console.log(`Starting upsert of ${normalizedResults.length} normalized results...`);
    let processed = 0;
    let skippedPublished = 0;
    let errorCount = 0;
    const errors = [];
    
    for (const result of normalizedResults) {
      try {
        // Check if record exists and is PUBLISHED
        const existingCheck = await query(
          `SELECT id, status FROM normalized_ratings 
           WHERE employee_id = $1 AND performance_cycle_id = $2 AND quarter = $3`,
          [result.employee_id ?? null, cycleId ?? null, quarter ?? null]
        );
        
        // Skip if already published
        if (existingCheck.rows.length > 0 && existingCheck.rows[0].status === 'PUBLISHED') {
          skippedPublished++;
          continue;
        }
        
        // Upsert
        const existingCheck2 = await query(
          `SELECT id, status FROM normalized_ratings 
           WHERE employee_id = $1 AND performance_cycle_id = $2 AND quarter = $3`,
          [result.employee_id ?? null, cycleId ?? null, quarter ?? null]
        );
        
        let upsertResult;
        if (existingCheck2.rows.length > 0) {
          // Update existing record
          const existingStatus = existingCheck2.rows[0].status;
          const updateQuery = `
            UPDATE normalized_ratings SET
              raw_rating = $1,
              boxcox_manager_level_rating = $2,
              boxcox_grade_level_rating = $3,
              final_normalized_rating = $4,
              updated_by_hr = $5,
              updated_at = NOW(),
              normalized_kpi_ratings = $6,
              normalized_kra_ratings = $7,
              raw_kpi_ratings = $8,
              raw_kra_ratings = $9,
              status = CASE 
                WHEN $10 = 'PUBLISHED' THEN $10
                ELSE 'DRAFT'
              END
            WHERE employee_id = $11 AND performance_cycle_id = $12 AND quarter = $13
            RETURNING id
          `;
          upsertResult = await query(updateQuery, [
            result.raw_rating,
            result.boxcox_manager_level_rating,
            result.boxcox_grade_level_rating,
            result.final_normalized_rating,
            hrUserId,
            null, // normalized_kpi_ratings - KPIs not normalized
            null, // normalized_kra_ratings - KRAs not normalized
            JSON.stringify(result.raw_kpi_ratings || []),
            JSON.stringify(result.raw_kra_ratings || []),
            existingStatus,
            result.employee_id,
            cycleId,
            quarter
          ]);
        } else {
          // Insert new record
          const insertQuery = `
            INSERT INTO normalized_ratings (
              employee_id, manager_id, performance_cycle_id, quarter,
              raw_rating, boxcox_manager_level_rating, boxcox_grade_level_rating,
              final_normalized_rating, status, updated_by_hr, updated_at,
              normalized_kpi_ratings, normalized_kra_ratings, raw_kpi_ratings, raw_kra_ratings
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, NOW(), $10, $11, $12, $13)
            RETURNING id
          `;
          upsertResult = await query(insertQuery, [
            result.employee_id,
            result.manager_id,
            cycleId,
            quarter,
            result.raw_rating ?? null,
            result.boxcox_manager_level_rating ?? null,
            result.boxcox_grade_level_rating ?? null,
            result.final_normalized_rating ?? null,
            hrUserId,
            null, // normalized_kpi_ratings - KPIs not normalized
            null, // normalized_kra_ratings - KRAs not normalized
            JSON.stringify(result.raw_kpi_ratings || []),
            JSON.stringify(result.raw_kra_ratings || [])
          ]);
        }
        
        if (upsertResult.rows.length > 0) {
          processed++;
        } else {
          errorCount++;
          errors.push(`No rows returned for employee ${result.employee_id}`);
        }
      } catch (upsertError) {
        errorCount++;
        const errorMsg = `Error upserting normalized rating for employee ${result.employee_id}: ${upsertError.message}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }
    
    const totalSkipped = skippedPublished + (reviews.length - reviewsToProcess.length);
    console.log(`Normalization complete: processed ${processed}, skipped ${totalSkipped}, errors: ${errorCount}, runId: ${runId}`);
    
    return {
      processed,
      skipped: totalSkipped,
      message: processed > 0 
        ? `Normalized ${processed} goal-level ratings${errorCount > 0 ? ` (${errorCount} errors)` : ''}`
        : `No ratings processed. ${normalizedResults.length > 0 ? 'Check errors in logs.' : 'No normalized results generated.'}`,
      runId,
      errors: errorCount > 0 ? errors : undefined
    };
  } catch (error) {
    console.error('Error in normalizeRatings:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
}
