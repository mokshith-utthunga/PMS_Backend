import { query } from '../config/database.js';

/**
 * Normalization Configuration
 * These can be moved to a config table or environment variables
 */
const DEFAULT_CONFIG = {
  minGroupSize: 3,              // Minimum group size for full normalization
  managerWeight: 0.5,           // Weight for manager-level normalization
  gradeWeight: 0.5,             // Weight for grade-level normalization
  useWinsorization: true,       // Apply percentile clipping to reduce outlier impact
  winsorizationPercentileLow: 5.0,   // P5
  winsorizationPercentileHigh: 95.0, // P95
  maxChangeFromRaw: 2.0,        // Maximum allowed change from raw rating (safeguard)
  roundToDecimals: 2            // Round only at final display
};

/**
 * Box-Cox Transform Implementation
 * Transforms data to approximate normality
 * @param {number} value - Input value (must be > 0)
 * @param {number} lambda - Transformation parameter
 * @returns {number} Transformed value
 */
function boxCoxTransform(value, lambda) {
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
 * Find optimal lambda using maximum likelihood estimation
 * Simplified approach: test range of lambda values and pick one that minimizes variance
 * @param {number[]} values - Array of positive values
 * @returns {number} Optimal lambda value
 */
function findOptimalLambda(values) {
  if (values.length < 2) {
    return 0; // Default to log transform for single value
  }
  
  // Check if all values are the same
  const uniqueValues = new Set(values);
  if (uniqueValues.size === 1) {
    return 0; // All same, use log transform
  }
  
  // Test lambda values from -2 to 2 in steps of 0.5
  const lambdaCandidates = [];
  for (let lambda = -2; lambda <= 2; lambda += 0.5) {
    try {
      const transformed = values.map(v => boxCoxTransform(v, lambda));
      const mean = transformed.reduce((a, b) => a + b, 0) / transformed.length;
      const variance = transformed.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / transformed.length;
      lambdaCandidates.push({ lambda, variance });
    } catch (e) {
      // Skip invalid lambda
      continue;
    }
  }
  
  // Find lambda with minimum variance (most normal distribution)
  if (lambdaCandidates.length === 0) {
    return 0; // Fallback to log transform
  }
  
  const optimal = lambdaCandidates.reduce((min, candidate) => 
    candidate.variance < min.variance ? candidate : min
  );
  
  return optimal.lambda;
}

/**
 * Ensure all values are positive by shifting if needed
 * @param {number[]} values - Array of values
 * @returns {{values: number[], shift: number}} Shifted values and shift amount
 */
function ensurePositive(values) {
  const minValue = Math.min(...values);
  if (minValue > 0) {
    return { values, shift: 0 };
  }
  
  // Shift all values to be positive (add constant)
  const shift = Math.abs(minValue) + 1;
  return {
    values: values.map(v => v + shift),
    shift
  };
}

/**
 * Winsorization: Clip extreme values to percentiles
 * Prevents one extreme outlier from distorting the whole group
 * @param {number[]} values - Array of values
 * @param {number} percentileLow - Lower percentile (e.g., 5)
 * @param {number} percentileHigh - Upper percentile (e.g., 95)
 * @returns {number[]} Winsorized values
 */
function winsorize(values, percentileLow = 5.0, percentileHigh = 95.0) {
  if (values.length < 3) {
    return values; // Not enough data for winsorization
  }
  
  const sorted = [...values].sort((a, b) => a - b);
  const lowIndex = Math.floor((percentileLow / 100) * sorted.length);
  const highIndex = Math.ceil((percentileHigh / 100) * sorted.length) - 1;
  
  const p5 = sorted[lowIndex];
  const p95 = sorted[highIndex];
  
  return values.map(v => {
    if (v < p5) return p5;
    if (v > p95) return p95;
    return v;
  });
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
 * Global scaling fallback for tiny groups
 * Scales raw rating to [1, 5] using global min/max of the quarter
 * @param {number} rawRating - Raw rating value
 * @param {number} globalMin - Minimum rating in the quarter
 * @param {number} globalMax - Maximum rating in the quarter
 * @returns {number} Scaled value in [1, 5]
 */
function globalScale(rawRating, globalMin, globalMax) {
  if (globalMax === globalMin) {
    return 3; // Default to middle if all same
  }
  return 1 + (rawRating - globalMin) * (5 - 1) / (globalMax - globalMin);
}

/**
 * Apply "no-shock" safeguard: cap change from raw rating
 * @param {number} normalizedRating - Normalized rating
 * @param {number} rawRating - Original raw rating
 * @param {number} maxChange - Maximum allowed change
 * @returns {number} Clamped rating
 */
function applyNoShockSafeguard(normalizedRating, rawRating, maxChange = 2.0) {
  const change = Math.abs(normalizedRating - rawRating);
  if (change <= maxChange) {
    return normalizedRating;
  }
  
  // Clamp to within maxChange
  if (normalizedRating > rawRating) {
    return rawRating + maxChange;
  } else {
    return rawRating - maxChange;
  }
}

/**
 * Normalize ratings for a given quarter and cycle
 * @param {number} quarter - Quarter number (1-4)
 * @param {string} cycleId - Performance cycle ID
 * @param {string} hrUserId - HR user ID performing normalization
 * @param {object} config - Optional configuration override
 * @returns {Promise<{processed: number, skipped: number, message: string, runId: string}>}
 */
export async function normalizeRatings(quarter, cycleId, hrUserId, config = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  try {
    // Fetch all submitted manager reviews for the quarter
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
    `;
    
    const reviewsResult = await query(reviewsQuery, [cycleId, quarter]);
    const reviews = reviewsResult.rows;
    
    console.log(`Found ${reviews.length} submitted ratings for quarter ${quarter}, cycle ${cycleId}`);
    
    if (reviews.length === 0) {
      return { processed: 0, skipped: 0, message: 'No submitted ratings found for this quarter', runId: null };
    }
    
    // Calculate global min/max for fallback scaling
    const allRawRatings = reviews.map(r => parseFloat(r.raw_rating));
    const globalMin = Math.min(...allRawRatings);
    const globalMax = Math.max(...allRawRatings);
    
    // Check existing normalized ratings to skip PUBLISHED ones
    const existingQuery = `
      SELECT employee_id, status
      FROM normalized_ratings
      WHERE performance_cycle_id = $1 AND quarter = $2 AND status = 'PUBLISHED'
    `;
    const existingResult = await query(existingQuery, [cycleId, quarter]);
    const publishedEmployeeIds = new Set(existingResult.rows.map(r => r.employee_id));
    
    const reviewsToProcess = reviews.filter(r => !publishedEmployeeIds.has(r.employee_id));
    
    if (reviewsToProcess.length === 0) {
      return { processed: 0, skipped: reviews.length, message: 'All ratings already published', runId: null };
    }
    
    // Group by manager for Level 1 normalization
    const managerGroups = new Map();
    reviewsToProcess.forEach(review => {
      const managerId = review.manager_id;
      if (!managerGroups.has(managerId)) {
        managerGroups.set(managerId, []);
      }
      managerGroups.get(managerId).push(review);
    });
    
    // Group by grade for Level 2 normalization
    const gradeGroups = new Map();
    reviewsToProcess.forEach(review => {
      const grade = review.grade || 'UNKNOWN';
      if (!gradeGroups.has(grade)) {
        gradeGroups.set(grade, []);
      }
      gradeGroups.get(grade).push(review);
    });
    
    // Level 1: Normalize within each manager's team
    const managerNormalized = new Map();
    const managerMetadata = new Map(); // Store lambda, group size, min, max
    
    for (const [managerId, groupReviews] of managerGroups) {
      if (groupReviews.length < finalConfig.minGroupSize) {
        // Too small for full normalization - use global scaling fallback
        console.log(`Manager ${managerId}: Only ${groupReviews.length} employee(s) (< ${finalConfig.minGroupSize}), using global scaling fallback`);
        groupReviews.forEach(review => {
          const scaled = globalScale(parseFloat(review.raw_rating), globalMin, globalMax);
          managerNormalized.set(review.employee_id, scaled);
          managerMetadata.set(review.employee_id, {
            lambda: null,
            groupSize: groupReviews.length,
            minValue: globalMin,
            maxValue: globalMax,
            method: 'global_scaling'
          });
        });
        continue;
      }
      
      const rawRatings = groupReviews.map(r => parseFloat(r.raw_rating));
      console.log(`Manager ${managerId}: Normalizing ${groupReviews.length} employees with raw ratings:`, rawRatings);
      
      // Apply winsorization if enabled
      let processedRatings = rawRatings;
      if (finalConfig.useWinsorization) {
        processedRatings = winsorize(rawRatings, finalConfig.winsorizationPercentileLow, finalConfig.winsorizationPercentileHigh);
        console.log(`Manager ${managerId}: After winsorization:`, processedRatings);
      }
      
      const { values: positiveRatings } = ensurePositive(processedRatings);
      
      // Find optimal lambda
      const lambda = findOptimalLambda(positiveRatings);
      console.log(`Manager ${managerId}: Optimal lambda = ${lambda.toFixed(3)}`);
      
      // Apply Box-Cox transform
      const transformed = positiveRatings.map(v => boxCoxTransform(v, lambda));
      console.log(`Manager ${managerId}: After Box-Cox:`, transformed.map(v => v.toFixed(3)));
      
      // Min-Max scale to [1, 5]
      const min = Math.min(...transformed);
      const max = Math.max(...transformed);
      const scaled = transformed.map(v => minMaxScale(v, min, max));
      console.log(`Manager ${managerId}: After Min-Max scaling [1-5]:`, scaled.map(v => v.toFixed(3)));
      
      // Map back to employees and store metadata
      groupReviews.forEach((review, index) => {
        managerNormalized.set(review.employee_id, scaled[index]);
        managerMetadata.set(review.employee_id, {
          lambda: lambda,
          groupSize: groupReviews.length,
          minValue: min,
          maxValue: max,
          method: 'boxcox_minmax'
        });
      });
    }
    
    // Level 2: Normalize within each grade/band
    const gradeNormalized = new Map();
    const gradeMetadata = new Map();
    
    for (const [grade, groupReviews] of gradeGroups) {
      if (groupReviews.length < finalConfig.minGroupSize) {
        // Too small for full normalization - use global scaling fallback
        console.log(`Grade ${grade}: Only ${groupReviews.length} employee(s) (< ${finalConfig.minGroupSize}), using global scaling fallback`);
        groupReviews.forEach(review => {
          const scaled = globalScale(parseFloat(review.raw_rating), globalMin, globalMax);
          gradeNormalized.set(review.employee_id, scaled);
          gradeMetadata.set(review.employee_id, {
            lambda: null,
            groupSize: groupReviews.length,
            minValue: globalMin,
            maxValue: globalMax,
            method: 'global_scaling'
          });
        });
        continue;
      }
      
      const rawRatings = groupReviews.map(r => parseFloat(r.raw_rating));
      console.log(`Grade ${grade}: Normalizing ${groupReviews.length} employees with raw ratings:`, rawRatings);
      
      // Apply winsorization if enabled
      let processedRatings = rawRatings;
      if (finalConfig.useWinsorization) {
        processedRatings = winsorize(rawRatings, finalConfig.winsorizationPercentileLow, finalConfig.winsorizationPercentileHigh);
        console.log(`Grade ${grade}: After winsorization:`, processedRatings);
      }
      
      const { values: positiveRatings } = ensurePositive(processedRatings);
      
      // Find optimal lambda
      const lambda = findOptimalLambda(positiveRatings);
      console.log(`Grade ${grade}: Optimal lambda = ${lambda.toFixed(3)}`);
      
      // Apply Box-Cox transform
      const transformed = positiveRatings.map(v => boxCoxTransform(v, lambda));
      console.log(`Grade ${grade}: After Box-Cox:`, transformed.map(v => v.toFixed(3)));
      
      // Min-Max scale to [1, 5]
      const min = Math.min(...transformed);
      const max = Math.max(...transformed);
      const scaled = transformed.map(v => minMaxScale(v, min, max));
      console.log(`Grade ${grade}: After Min-Max scaling [1-5]:`, scaled.map(v => v.toFixed(3)));
      
      // Map back to employees and store metadata
      groupReviews.forEach((review, index) => {
        gradeNormalized.set(review.employee_id, scaled[index]);
        gradeMetadata.set(review.employee_id, {
          lambda: lambda,
          groupSize: groupReviews.length,
          minValue: min,
          maxValue: max,
          method: 'boxcox_minmax'
        });
      });
    }
    
    // Combine results: weighted average (configurable weights)
    const normalizedResults = [];
    for (const review of reviewsToProcess) {
      const managerRating = managerNormalized.get(review.employee_id);
      const gradeRating = gradeNormalized.get(review.employee_id);
      const managerMeta = managerMetadata.get(review.employee_id);
      const gradeMeta = gradeMetadata.get(review.employee_id);
      
      // Determine final rating based on what's available
      let finalRating;
      if (managerRating === undefined && gradeRating === undefined) {
        // Neither available (shouldn't happen, but fallback)
        finalRating = parseFloat(review.raw_rating);
      } else if (managerRating === undefined) {
        // Only grade available
        finalRating = parseFloat(gradeRating);
      } else if (gradeRating === undefined) {
        // Only manager available
        finalRating = parseFloat(managerRating);
      } else {
        // Both available: weighted average
        finalRating = finalConfig.managerWeight * parseFloat(managerRating) + 
                     finalConfig.gradeWeight * parseFloat(gradeRating);
      }
      
      // Apply no-shock safeguard
      const rawRatingFloat = parseFloat(review.raw_rating);
      finalRating = applyNoShockSafeguard(finalRating, rawRatingFloat, finalConfig.maxChangeFromRaw);
      
      console.log(`Employee ${review.employee_id}: Raw=${rawRatingFloat.toFixed(3)}, Manager=${managerRating?.toFixed(3) || 'N/A'}, Grade=${gradeRating?.toFixed(3) || 'N/A'}, Final=${finalRating.toFixed(3)}`);
      
      normalizedResults.push({
        employee_id: review.employee_id,
        manager_id: review.manager_id,
        raw_rating: rawRatingFloat,
        boxcox_manager_level_rating: managerRating || rawRatingFloat,
        boxcox_grade_level_rating: gradeRating || rawRatingFloat,
        final_normalized_rating: finalRating, // Keep high precision, round only at display
        manager_lambda: managerMeta?.lambda ?? null,
        manager_group_size: managerMeta?.groupSize ?? null,
        manager_min_value: managerMeta?.minValue ?? null,
        manager_max_value: managerMeta?.maxValue ?? null,
        grade_lambda: gradeMeta?.lambda ?? null,
        grade_group_size: gradeMeta?.groupSize ?? null,
        grade_min_value: gradeMeta?.minValue ?? null,
        grade_max_value: gradeMeta?.maxValue ?? null,
        manager_weight: finalConfig.managerWeight,
        grade_weight: finalConfig.gradeWeight
      });
    }
    
    // Calculate summary statistics for audit
    const avgRaw = allRawRatings.reduce((a, b) => a + b, 0) / allRawRatings.length;
    const avgNormalized = normalizedResults.reduce((sum, r) => sum + r.final_normalized_rating, 0) / normalizedResults.length;
    const minRaw = globalMin;
    const maxRaw = globalMax;
    const minNormalized = Math.min(...normalizedResults.map(r => r.final_normalized_rating));
    const maxNormalized = Math.max(...normalizedResults.map(r => r.final_normalized_rating));
    
    // Create normalization run record
    const runInsertQuery = `
      INSERT INTO normalization_runs (
        performance_cycle_id, quarter, run_by, total_employees, processed_count, skipped_count,
        manager_weight, grade_weight, min_group_size, use_winsorization,
        winsorization_percentile_low, winsorization_percentile_high, max_change_from_raw,
        avg_raw_rating, avg_normalized_rating, min_raw_rating, max_raw_rating,
        min_normalized_rating, max_normalized_rating
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING id
    `;
    
    const runResult = await query(runInsertQuery, [
      cycleId, quarter, hrUserId, reviews.length, normalizedResults.length,
      reviews.length - reviewsToProcess.length,
      finalConfig.managerWeight, finalConfig.gradeWeight, finalConfig.minGroupSize,
      finalConfig.useWinsorization, finalConfig.winsorizationPercentileLow,
      finalConfig.winsorizationPercentileHigh, finalConfig.maxChangeFromRaw,
      avgRaw, avgNormalized, minRaw, maxRaw, minNormalized, maxNormalized
    ]);
    
    const runId = runResult.rows[0].id;
    
    // Upsert to normalized_ratings table
    let processed = 0;
    for (const result of normalizedResults) {
      // First check if record exists and is PUBLISHED
      const existingCheck = await query(
        `SELECT id, status FROM normalized_ratings 
         WHERE employee_id = $1 AND performance_cycle_id = $2 AND quarter = $3`,
        [result.employee_id, cycleId, quarter]
      );
      
      // Skip if already published
      if (existingCheck.rows.length > 0 && existingCheck.rows[0].status === 'PUBLISHED') {
        continue;
      }
      
      const upsertQuery = `
        INSERT INTO normalized_ratings (
          employee_id, manager_id, performance_cycle_id, quarter,
          raw_rating, boxcox_manager_level_rating, boxcox_grade_level_rating,
          final_normalized_rating, status, updated_by_hr, updated_at,
          manager_lambda, manager_group_size, manager_min_value, manager_max_value,
          grade_lambda, grade_group_size, grade_min_value, grade_max_value,
          manager_weight, grade_weight
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, NOW(), $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        ON CONFLICT (employee_id, performance_cycle_id, quarter)
        DO UPDATE SET
          raw_rating = EXCLUDED.raw_rating,
          boxcox_manager_level_rating = EXCLUDED.boxcox_manager_level_rating,
          boxcox_grade_level_rating = EXCLUDED.boxcox_grade_level_rating,
          final_normalized_rating = EXCLUDED.final_normalized_rating,
          updated_by_hr = EXCLUDED.updated_by_hr,
          updated_at = EXCLUDED.updated_at,
          manager_lambda = EXCLUDED.manager_lambda,
          manager_group_size = EXCLUDED.manager_group_size,
          manager_min_value = EXCLUDED.manager_min_value,
          manager_max_value = EXCLUDED.manager_max_value,
          grade_lambda = EXCLUDED.grade_lambda,
          grade_group_size = EXCLUDED.grade_group_size,
          grade_min_value = EXCLUDED.grade_min_value,
          grade_max_value = EXCLUDED.grade_max_value,
          manager_weight = EXCLUDED.manager_weight,
          grade_weight = EXCLUDED.grade_weight,
          status = CASE 
            WHEN normalized_ratings.status = 'PUBLISHED' THEN normalized_ratings.status
            ELSE 'DRAFT'
          END
        RETURNING id
      `;
      
      try {
        const upsertResult = await query(upsertQuery, [
          result.employee_id,
          result.manager_id,
          cycleId,
          quarter,
          result.raw_rating,
          result.boxcox_manager_level_rating,
          result.boxcox_grade_level_rating,
          result.final_normalized_rating,
          hrUserId,
          result.manager_lambda,
          result.manager_group_size,
          result.manager_min_value,
          result.manager_max_value,
          result.grade_lambda,
          result.grade_group_size,
          result.grade_min_value,
          result.grade_max_value,
          result.manager_weight,
          result.grade_weight
        ]);
        
        if (upsertResult.rows.length > 0) {
          processed++;
        }
      } catch (upsertError) {
        console.error(`Error upserting normalized rating for employee ${result.employee_id}:`, upsertError);
        // Continue with next rating instead of failing completely
      }
    }
    
    console.log(`Normalization complete: processed ${processed}, skipped ${reviews.length - reviewsToProcess.length}, runId: ${runId}`);
    
    return {
      processed,
      skipped: reviews.length - reviewsToProcess.length,
      message: `Normalized ${processed} ratings`,
      runId
    };
  } catch (error) {
    console.error('Error in normalizeRatings:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
}
