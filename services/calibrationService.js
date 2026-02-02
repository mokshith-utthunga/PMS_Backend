import { query } from '../config/database.js';

/**
 * CALIBRATION SERVICE
 * 
 * Applies bell curve distribution (forced distribution) to normalized ratings.
 * Calibration is applied per grade, using final_normalized_rating.
 * 
 * Quotas are read from default_calibration_quotas table (configurable by HR/admin).
 * Default distribution:
 * - 5★ (5) → top 5%
 * - 4★ (4) → next 20%
 * - 3★ (3) → next 50%
 * - 2★ (2) → next 20%
 * - 1★ (1) → bottom 5%
 * 
 * Process:
 * 1. Fetch calibration quotas from default_calibration_quotas table
 * 2. Fetch all DRAFT normalized ratings for the quarter
 * 3. Group by grade
 * 4. Sort by final_normalized_rating DESC within each grade
 * 5. Apply bell curve distribution per grade using quotas
 * 6. Store calibrated_rating (does NOT modify final_normalized_rating)
 */

/**
 * Fetch calibration quotas from database
 * @returns {Promise<Object>} Quotas object with rating -> percentage mapping
 */
async function fetchCalibrationQuotas() {
  try {
    const result = await query(
      'SELECT rating_value, percentage FROM default_calibration_quotas ORDER BY rating_value'
    );
    
    if (result.rows.length === 0) {
      // Fallback to default quotas if table is empty
      console.warn('No calibration quotas found in database, using defaults');
      return {
        5: 0.05,  // 5%
        4: 0.20,  // 20%
        3: 0.50,  // 50%
        2: 0.20,  // 20%
        1: 0.05   // 5%
      };
    }
    
    // Convert to object: rating_value -> percentage (as decimal)
    const quotas = {};
    let totalPercentage = 0;
    
    for (const row of result.rows) {
      const rating = parseInt(row.rating_value);
      const percentage = parseFloat(row.percentage) / 100; // Convert to decimal
      quotas[rating] = percentage;
      totalPercentage += parseFloat(row.percentage);
    }
    
    // Validate that percentages total to 100%
    if (Math.abs(totalPercentage - 100) > 0.01) {
      console.warn(`Calibration quotas total ${totalPercentage}% instead of 100%. Using as-is but may cause issues.`);
    }
    
    // Ensure all ratings 1-5 are present
    for (let i = 1; i <= 5; i++) {
      if (!quotas[i]) {
        console.warn(`Missing quota for rating ${i}, defaulting to 0%`);
        quotas[i] = 0;
      }
    }
    
    console.log('Loaded calibration quotas from database:', quotas);
    return quotas;
  } catch (error) {
    console.error('Error fetching calibration quotas:', error);
    // Fallback to default quotas on error
    return {
      5: 0.05,
      4: 0.20,
      3: 0.50,
      2: 0.20,
      1: 0.05
    };
  }
}

/**
 * Calculate target counts for each rating based on group size and quotas
 * @param {number} groupSize - Number of employees in the grade
 * @param {Object} quotas - Quotas object {5: 0.05, 4: 0.20, ...}
 * @returns {Object} Target counts for each rating
 */
function calculateTargetCounts(groupSize, quotas) {
  const c5 = Math.round(quotas[5] * groupSize);
  const c4 = Math.round(quotas[4] * groupSize);
  const c3 = Math.round(quotas[3] * groupSize);
  const c2 = Math.round(quotas[2] * groupSize);
  const c1 = groupSize - (c5 + c4 + c3 + c2); // Remaining to ensure total = N
  
  return { c5, c4, c3, c2, c1 };
}

/**
 * Apply calibration to a group of employees
 * @param {Array} employees - Array of {employee_id, final_normalized_rating}
 * @param {Object} quotas - Quotas object {5: 0.05, 4: 0.20, ...}
 * @returns {Map} employeeId -> calibrated_rating
 */
function calibrateGroup(employees, quotas) {
  if (employees.length === 0) {
    return new Map();
  }
  
  // Sort by final_normalized_rating DESC (highest first)
  const sorted = [...employees].sort((a, b) => {
    const ratingA = parseFloat(a.final_normalized_rating || 0);
    const ratingB = parseFloat(b.final_normalized_rating || 0);
    return ratingB - ratingA; // DESC
  });
  
  const groupSize = sorted.length;
  const { c5, c4, c3, c2, c1 } = calculateTargetCounts(groupSize, quotas);
  
  const calibrated = new Map();
  let index = 0;
  
  // Assign rating 5 to top c5 employees
  for (let i = 0; i < c5 && index < sorted.length; i++) {
    calibrated.set(sorted[index].employee_id, 5);
    index++;
  }
  
  // Assign rating 4 to next c4 employees
  for (let i = 0; i < c4 && index < sorted.length; i++) {
    calibrated.set(sorted[index].employee_id, 4);
    index++;
  }
  
  // Assign rating 3 to next c3 employees
  for (let i = 0; i < c3 && index < sorted.length; i++) {
    calibrated.set(sorted[index].employee_id, 3);
    index++;
  }
  
  // Assign rating 2 to next c2 employees
  for (let i = 0; i < c2 && index < sorted.length; i++) {
    calibrated.set(sorted[index].employee_id, 2);
    index++;
  }
  
  // Assign rating 1 to remaining employees
  while (index < sorted.length) {
    calibrated.set(sorted[index].employee_id, 1);
    index++;
  }
  
  return calibrated;
}

/**
 * Apply calibration to normalized ratings
 * @param {number} quarter - Quarter number (1-4)
 * @param {string} cycleId - Performance cycle ID
 * @param {string} hrUserId - HR user ID performing calibration
 * @returns {Promise<{processed: number, skipped: number, message: string}>}
 */
export async function applyCalibration(quarter, cycleId, hrUserId) {
  try {
    // Step 1: Fetch calibration quotas from database (configurable by HR/admin)
    const quotas = await fetchCalibrationQuotas();
    
    // Step 2: Fetch all DRAFT normalized ratings with employee grades
    const ratingsQuery = `
      SELECT 
        nr.id,
        nr.employee_id,
        nr.final_normalized_rating,
        e.grade
      FROM normalized_ratings nr
      JOIN employees e ON e.id = nr.employee_id
      WHERE nr.performance_cycle_id = $1
        AND nr.quarter = $2
        AND nr.status = 'DRAFT'
        AND nr.final_normalized_rating IS NOT NULL
        AND nr.final_normalized_rating > 0
    `;
    
    const ratingsResult = await query(ratingsQuery, [cycleId, quarter]);
    const ratings = ratingsResult.rows;
    
    console.log(`Found ${ratings.length} DRAFT normalized ratings for calibration`);
    console.log(`Using calibration quotas:`, quotas);
    
    if (ratings.length === 0) {
      return { 
        processed: 0, 
        skipped: 0, 
        message: 'No DRAFT normalized ratings found for calibration. Please run normalization first.' 
      };
    }
    
    // Step 3: Group ratings by grade
    const gradeGroups = new Map(); // grade -> [{employee_id, final_normalized_rating}]
    
    ratings.forEach(rating => {
      const grade = rating.grade || 'UNKNOWN';
      if (!gradeGroups.has(grade)) {
        gradeGroups.set(grade, []);
      }
      gradeGroups.get(grade).push({
        employee_id: rating.employee_id,
        final_normalized_rating: parseFloat(rating.final_normalized_rating)
      });
    });
    
    console.log(`Grouped into ${gradeGroups.size} grade groups:`, Array.from(gradeGroups.keys()));
    
    // Step 4: Apply calibration per grade using quotas from database
    const allCalibratedRatings = new Map(); // employeeId -> calibrated_rating
    
    for (const [grade, employees] of gradeGroups) {
      console.log(`Calibrating grade "${grade}" with ${employees.length} employees`);
      
      if (employees.length === 0) {
        continue;
      }
      
      // Apply calibration to this grade group using quotas from database
      const calibrated = calibrateGroup(employees, quotas);
      
      // Merge into main map
      calibrated.forEach((rating, employeeId) => {
        allCalibratedRatings.set(employeeId, rating);
      });
      
      // Log distribution for this grade
      const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
      calibrated.forEach(rating => {
        distribution[rating] = (distribution[rating] || 0) + 1;
      });
      console.log(`Grade "${grade}" distribution:`, distribution);
    }
    
    // Step 4: Update normalized_ratings with calibrated_rating
    let processed = 0;
    let errorCount = 0;
    const errors = [];
    
    for (const rating of ratings) {
      const employeeId = rating.employee_id;
      const calibratedRating = allCalibratedRatings.get(employeeId);
      
      if (calibratedRating === undefined) {
        errorCount++;
        errors.push(`No calibrated rating calculated for employee ${employeeId}`);
        continue;
      }
      
      try {
        const updateQuery = `
          UPDATE normalized_ratings
          SET calibrated_rating = $1,
              updated_by_hr = $2,
              updated_at = NOW()
          WHERE employee_id = $3
            AND performance_cycle_id = $4
            AND quarter = $5
            AND status = 'DRAFT'
        `;
        
        const result = await query(updateQuery, [
          calibratedRating,
          hrUserId,
          employeeId,
          cycleId,
          quarter
        ]);
        
        if (result.rowCount > 0) {
          processed++;
        } else {
          errorCount++;
          errors.push(`Failed to update calibrated rating for employee ${employeeId}`);
        }
      } catch (updateError) {
        errorCount++;
        const errorMsg = `Error updating calibrated rating for employee ${employeeId}: ${updateError.message}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }
    
    console.log(`Calibration complete: processed ${processed}, errors: ${errorCount}`);
    
    // Calculate summary statistics
    const calibratedValues = Array.from(allCalibratedRatings.values());
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    calibratedValues.forEach(rating => {
      distribution[rating] = (distribution[rating] || 0) + 1;
    });
    
    return {
      processed,
      skipped: 0,
      message: processed > 0 
        ? `Calibrated ${processed} ratings${errorCount > 0 ? ` (${errorCount} errors)` : ''}`
        : `No ratings calibrated. ${ratings.length > 0 ? 'Check errors in logs.' : 'No DRAFT ratings found.'}`,
      distribution,
      errors: errorCount > 0 ? errors : undefined
    };
  } catch (error) {
    console.error('Error in applyCalibration:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
}
