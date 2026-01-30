import { query } from '../config/database.js';

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
 * Normalize ratings for a given quarter and cycle
 * @param {number} quarter - Quarter number (1-4)
 * @param {string} cycleId - Performance cycle ID
 * @param {string} hrUserId - HR user ID performing normalization
 * @returns {Promise<{processed: number, skipped: number}>}
 */
export async function normalizeRatings(quarter, cycleId, hrUserId) {
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
    
    if (reviews.length === 0) {
      return { processed: 0, skipped: 0, message: 'No submitted ratings found for this quarter' };
    }
    
    // Check existing normalized ratings to skip PUBLISHED ones
    const existingQuery = `
      SELECT employee_id, status
      FROM normalized_ratings
      WHERE performance_cycle_id = $1 AND quarter = $2
    `;
    const existingResult = await query(existingQuery, [cycleId, quarter]);
    const publishedMap = new Map();
    existingResult.rows.forEach(row => {
      if (row.status === 'PUBLISHED') {
        publishedMap.set(row.employee_id, true);
      }
    });
    
    // Filter out published ratings
    const reviewsToProcess = reviews.filter(r => !publishedMap.has(r.employee_id));
    
    if (reviewsToProcess.length === 0) {
      return { processed: 0, skipped: reviews.length, message: 'All ratings already published' };
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
    for (const [managerId, groupReviews] of managerGroups) {
      if (groupReviews.length < 2) {
        // Single employee: use raw rating (no normalization needed)
        groupReviews.forEach(review => {
          managerNormalized.set(review.employee_id, review.raw_rating);
        });
        continue;
      }
      
      const rawRatings = groupReviews.map(r => parseFloat(r.raw_rating));
      const { values: positiveRatings, shift } = ensurePositive(rawRatings);
      
      // Find optimal lambda
      const lambda = findOptimalLambda(positiveRatings);
      
      // Apply Box-Cox transform
      const transformed = positiveRatings.map(v => boxCoxTransform(v, lambda));
      
      // Min-Max scale to [1, 5]
      const min = Math.min(...transformed);
      const max = Math.max(...transformed);
      const scaled = transformed.map(v => minMaxScale(v, min, max));
      
      // Map back to employees
      groupReviews.forEach((review, index) => {
        managerNormalized.set(review.employee_id, scaled[index]);
      });
    }
    
    // Level 2: Normalize within each grade/band
    const gradeNormalized = new Map();
    for (const [grade, groupReviews] of gradeGroups) {
      if (groupReviews.length < 2) {
        // Single employee: use raw rating
        groupReviews.forEach(review => {
          gradeNormalized.set(review.employee_id, review.raw_rating);
        });
        continue;
      }
      
      const rawRatings = groupReviews.map(r => parseFloat(r.raw_rating));
      const { values: positiveRatings } = ensurePositive(rawRatings);
      
      // Find optimal lambda
      const lambda = findOptimalLambda(positiveRatings);
      
      // Apply Box-Cox transform
      const transformed = positiveRatings.map(v => boxCoxTransform(v, lambda));
      
      // Min-Max scale to [1, 5]
      const min = Math.min(...transformed);
      const max = Math.max(...transformed);
      const scaled = transformed.map(v => minMaxScale(v, min, max));
      
      // Map back to employees
      groupReviews.forEach((review, index) => {
        gradeNormalized.set(review.employee_id, scaled[index]);
      });
    }
    
    // Combine results: weighted average (50% manager-level + 50% grade-level)
    const normalizedResults = [];
    for (const review of reviewsToProcess) {
      const managerRating = managerNormalized.get(review.employee_id) || review.raw_rating;
      const gradeRating = gradeNormalized.get(review.employee_id) || review.raw_rating;
      const finalRating = 0.5 * managerRating + 0.5 * gradeRating;
      
      normalizedResults.push({
        employee_id: review.employee_id,
        manager_id: review.manager_id,
        raw_rating: review.raw_rating,
        boxcox_manager_level_rating: managerRating,
        boxcox_grade_level_rating: gradeRating,
        final_normalized_rating: finalRating
      });
    }
    
    // Upsert to normalized_ratings table
    // Only update DRAFT or REJECTED rows, skip PUBLISHED
    let processed = 0;
    for (const result of normalizedResults) {
      const upsertQuery = `
        INSERT INTO normalized_ratings (
          employee_id, manager_id, performance_cycle_id, quarter,
          raw_rating, boxcox_manager_level_rating, boxcox_grade_level_rating,
          final_normalized_rating, status, updated_by_hr, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, NOW())
        ON CONFLICT (employee_id, performance_cycle_id, quarter)
        DO UPDATE SET
          raw_rating = EXCLUDED.raw_rating,
          boxcox_manager_level_rating = EXCLUDED.boxcox_manager_level_rating,
          boxcox_grade_level_rating = EXCLUDED.boxcox_grade_level_rating,
          final_normalized_rating = EXCLUDED.final_normalized_rating,
          updated_by_hr = EXCLUDED.updated_by_hr,
          updated_at = EXCLUDED.updated_at
        WHERE normalized_ratings.status != 'PUBLISHED'
        RETURNING id
      `;
      
      const upsertResult = await query(upsertQuery, [
        result.employee_id,
        result.manager_id,
        cycleId,
        quarter,
        result.raw_rating,
        result.boxcox_manager_level_rating,
        result.boxcox_grade_level_rating,
        result.final_normalized_rating,
        hrUserId
      ]);
      
      if (upsertResult.rows.length > 0) {
        processed++;
      }
    }
    
    return {
      processed,
      skipped: reviews.length - reviewsToProcess.length,
      message: `Normalized ${processed} ratings`
    };
  } catch (error) {
    console.error('Error in normalizeRatings:', error);
    throw error;
  }
}
