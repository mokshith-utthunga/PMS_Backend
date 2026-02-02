import { query } from '../config/database.js';

const employeeId = 'e4444444-4444-4444-4444-444444444444';

async function fixTransitionData() {
  try {
    console.log('Checking transition data for employee:', employeeId);
    
    // 1. Check if transition exists
    const transitionResult = await query(
      'SELECT * FROM employee_quarter_transitions WHERE employee_id = $1',
      [employeeId]
    );
    
    if (transitionResult.rows.length === 0) {
      console.log('No transition found for this employee');
      return;
    }
    
    const transition = transitionResult.rows[0];
    console.log('Found transition:', {
      id: transition.id,
      quarter: transition.quarter,
      transition_date: transition.transition_date,
      cycle_id: transition.cycle_id
    });
    
    // 2. Check KRAs
    const krasResult = await query(
      `SELECT id, period_type, transition_id, status FROM kras 
       WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3`,
      [employeeId, transition.cycle_id, transition.quarter]
    );
    console.log(`\nKRAs (${krasResult.rows.length}):`);
    krasResult.rows.forEach(kra => {
      console.log(`  - ${kra.id}: period_type=${kra.period_type}, transition_id=${kra.transition_id}, status=${kra.status}`);
    });
    
    // 3. Check Goals
    const goalsResult = await query(
      `SELECT id, period_type, transition_id, status FROM goals 
       WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3`,
      [employeeId, transition.cycle_id, transition.quarter]
    );
    console.log(`\nGoals (${goalsResult.rows.length}):`);
    goalsResult.rows.forEach(goal => {
      console.log(`  - ${goal.id}: period_type=${goal.period_type}, transition_id=${goal.transition_id}, status=${goal.status}`);
    });
    
    // 4. Check Self Reviews
    const selfReviewsResult = await query(
      `SELECT id, period_type, transition_id, status FROM quarterly_self_reviews 
       WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3`,
      [employeeId, transition.cycle_id, transition.quarter]
    );
    console.log(`\nSelf Reviews (${selfReviewsResult.rows.length}):`);
    selfReviewsResult.rows.forEach(review => {
      console.log(`  - ${review.id}: period_type=${review.period_type}, transition_id=${review.transition_id}, status=${review.status}`);
    });
    
    // 5. Check Manager Reviews
    const managerReviewsResult = await query(
      `SELECT id, period_type, transition_id, status, is_old_manager_review FROM quarterly_manager_reviews 
       WHERE employee_id = $1 AND cycle_id = $2 AND quarter = $3`,
      [employeeId, transition.cycle_id, transition.quarter]
    );
    console.log(`\nManager Reviews (${managerReviewsResult.rows.length}):`);
    managerReviewsResult.rows.forEach(review => {
      console.log(`  - ${review.id}: period_type=${review.period_type}, transition_id=${review.transition_id}, status=${review.status}, is_old_manager=${review.is_old_manager_review}`);
    });
    
    // 6. Fix data if needed
    const transitionDate = new Date(transition.transition_date);
    const transitionDateStr = transitionDate.toISOString().split('T')[0];
    
    // Get quarter date range for period dates
    const quarterRange = await query(
      `SELECT quarterly_start_date, quarterly_end_date 
       FROM goals_quarterly_cycles 
       WHERE performance_cycle_id = $1 AND quarter = $2`,
      [transition.cycle_id, transition.quarter]
    );
    
    let periodStartDate = transitionDate;
    if (quarterRange.rows.length > 0) {
      periodStartDate = quarterRange.rows[0].quarterly_start_date;
    }
    const preEndDate = new Date(transitionDate);
    preEndDate.setDate(preEndDate.getDate() - 1);
    const periodEndDateStr = preEndDate.toISOString().split('T')[0];
    const periodStartDateStr = periodStartDate instanceof Date 
      ? periodStartDate.toISOString().split('T')[0] 
      : new Date(periodStartDate).toISOString().split('T')[0];
    
    // Update KRAs that don't have period_type set
    const krasToUpdate = krasResult.rows.filter(k => !k.period_type || k.period_type === 'full_quarter');
    if (krasToUpdate.length > 0) {
      console.log(`\nUpdating ${krasToUpdate.length} KRAs...`);
      const updateResult = await query(
        `UPDATE kras 
         SET period_type = 'pre_transition'::period_type,
             transition_id = $1,
             period_start_date = $2,
             period_end_date = $3,
             status = 'locked'
         WHERE employee_id = $4 
           AND cycle_id = $5
           AND quarter = $6
           AND (period_type IS NULL OR period_type = 'full_quarter'::period_type)`,
        [transition.id, periodStartDateStr, periodEndDateStr, employeeId, transition.cycle_id, transition.quarter]
      );
      console.log(`Updated ${updateResult.rowCount} KRAs`);
    }
    
    // Update Goals that don't have period_type set
    const goalsToUpdate = goalsResult.rows.filter(g => !g.period_type || g.period_type === 'full_quarter');
    if (goalsToUpdate.length > 0) {
      console.log(`\nUpdating ${goalsToUpdate.length} Goals...`);
      const updateResult = await query(
        `UPDATE goals 
         SET period_type = 'pre_transition'::period_type,
             transition_id = $1,
             period_start_date = $2,
             period_end_date = $3,
             status = 'locked'
         WHERE employee_id = $4 
           AND cycle_id = $5
           AND quarter = $6
           AND (period_type IS NULL OR period_type = 'full_quarter'::period_type)`,
        [transition.id, periodStartDateStr, periodEndDateStr, employeeId, transition.cycle_id, transition.quarter]
      );
      console.log(`Updated ${updateResult.rowCount} Goals`);
    }
    
    // Update Self Reviews that don't have period_type set
    const selfReviewsToUpdate = selfReviewsResult.rows.filter(r => !r.period_type || r.period_type === 'full_quarter');
    if (selfReviewsToUpdate.length > 0) {
      console.log(`\nUpdating ${selfReviewsToUpdate.length} Self Reviews...`);
      
      // Get period dates
      const quarterRange = await query(
        `SELECT quarterly_start_date, quarterly_end_date 
         FROM goals_quarterly_cycles 
         WHERE performance_cycle_id = $1 AND quarter = $2`,
        [transition.cycle_id, transition.quarter]
      );
      
      if (quarterRange.rows.length > 0) {
        const quarterStart = quarterRange.rows[0].quarterly_start_date;
        const preEndDate = new Date(transitionDate);
        preEndDate.setDate(preEndDate.getDate() - 1);
        const preEndDateStr = preEndDate.toISOString().split('T')[0];
        
        const updateResult = await query(
          `UPDATE quarterly_self_reviews 
           SET period_type = 'pre_transition'::period_type,
               transition_id = $1,
               period_start_date = $2,
               period_end_date = $3
           WHERE employee_id = $4 
             AND cycle_id = $5
             AND quarter = $6
             AND (period_type IS NULL OR period_type = 'full_quarter'::period_type)`,
          [transition.id, quarterStart, preEndDateStr, employeeId, transition.cycle_id, transition.quarter]
        );
        console.log(`Updated ${updateResult.rowCount} Self Reviews`);
      }
    }
    
    // Update Manager Reviews that don't have period_type set
    const managerReviewsToUpdate = managerReviewsResult.rows.filter(r => !r.period_type || r.period_type === 'full_quarter');
    if (managerReviewsToUpdate.length > 0) {
      console.log(`\nUpdating ${managerReviewsToUpdate.length} Manager Reviews...`);
      
      // Get period dates
      const quarterRange = await query(
        `SELECT quarterly_start_date, quarterly_end_date 
         FROM goals_quarterly_cycles 
         WHERE performance_cycle_id = $1 AND quarter = $2`,
        [transition.cycle_id, transition.quarter]
      );
      
      if (quarterRange.rows.length > 0) {
        const quarterStart = quarterRange.rows[0].quarterly_start_date;
        const preEndDate = new Date(transitionDate);
        preEndDate.setDate(preEndDate.getDate() - 1);
        const preEndDateStr = preEndDate.toISOString().split('T')[0];
        
        const updateResult = await query(
          `UPDATE quarterly_manager_reviews 
           SET period_type = 'pre_transition'::period_type,
               transition_id = $1,
               period_start_date = $2,
               period_end_date = $3,
               is_old_manager_review = CASE 
                 WHEN reviewer_id = $4 THEN true 
                 ELSE is_old_manager_review 
               END
           WHERE employee_id = $5 
             AND cycle_id = $6
             AND quarter = $7
             AND (period_type IS NULL OR period_type = 'full_quarter'::period_type)`,
          [transition.id, quarterStart, preEndDateStr, transition.old_manager_id, employeeId, transition.cycle_id, transition.quarter]
        );
        console.log(`Updated ${updateResult.rowCount} Manager Reviews`);
      }
    }
    
    console.log('\n✅ Data fix complete!');
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    process.exit(0);
  }
}

fixTransitionData();
