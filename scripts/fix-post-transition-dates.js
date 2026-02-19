/**
 * Fix post-transition period_start_date for goals and KRAs
 * 
 * This script corrects the period_start_date for post_transition goals/KRAs
 * that are one day behind due to timezone conversion issues.
 * 
 * For post_transition: period_start_date should equal transition_date
 * For pre_transition: period_end_date should be transition_date - 1 day
 */

import { query } from '../config/database.js';

async function fixPostTransitionDates() {
  try {
    console.log('Starting fix for post-transition period dates...\n');

    // Get all transitions
    const transitionsResult = await query(`
      SELECT id, employee_id, cycle_id, quarter, transition_date
      FROM employee_quarter_transitions
      ORDER BY created_at DESC
    `);

    console.log(`Found ${transitionsResult.rows.length} transitions to process\n`);

    let totalGoalsFixed = 0;
    let totalKrasFixed = 0;

    for (const transition of transitionsResult.rows) {
      const transitionId = transition.id;
      const transitionDate = transition.transition_date;
      
      // Format transition date as YYYY-MM-DD (avoid timezone issues)
      const transitionDateStr = transitionDate instanceof Date
        ? transitionDate.toISOString().split('T')[0]
        : (typeof transitionDate === 'string'
          ? transitionDate.split('T')[0]
          : new Date(transitionDate).toISOString().split('T')[0]);

      // Pre-transition ends on the transition date itself (not transition date - 1)
      const preEndDateStr = transitionDateStr;

      console.log(`Processing transition ${transitionId}:`);
      console.log(`  Transition date: ${transitionDateStr}`);
      console.log(`  Post-transition start should be: ${transitionDateStr}`);
      console.log(`  Pre-transition end should be: ${preEndDateStr} (same as transition date)`);

      // Fix post-transition goals
      const goalsResult = await query(`
        UPDATE goals
        SET period_start_date = $1
        WHERE transition_id = $2
          AND period_type = 'post_transition'
          AND (period_start_date IS NULL OR period_start_date != $3)
        RETURNING id, period_start_date, period_end_date
      `, [transitionDateStr, transitionId, transitionDateStr]);

      if (goalsResult.rows.length > 0) {
        console.log(`  Fixed ${goalsResult.rows.length} post-transition goals`);
        totalGoalsFixed += goalsResult.rows.length;
      }

      // Fix pre-transition goals (ensure period_end_date is correct)
      const preGoalsResult = await query(`
        UPDATE goals
        SET period_end_date = $1
        WHERE transition_id = $2
          AND period_type = 'pre_transition'
          AND (period_end_date IS NULL OR period_end_date != $3)
        RETURNING id, period_start_date, period_end_date
      `, [preEndDateStr, transitionId, preEndDateStr]);

      if (preGoalsResult.rows.length > 0) {
        console.log(`  Fixed ${preGoalsResult.rows.length} pre-transition goals (end date)`);
        totalGoalsFixed += preGoalsResult.rows.length;
      }

      // Fix post-transition KRAs
      const krasResult = await query(`
        UPDATE kras
        SET period_start_date = $1
        WHERE transition_id = $2
          AND period_type = 'post_transition'
          AND (period_start_date IS NULL OR period_start_date != $3)
        RETURNING id, period_start_date, period_end_date
      `, [transitionDateStr, transitionId, transitionDateStr]);

      if (krasResult.rows.length > 0) {
        console.log(`  Fixed ${krasResult.rows.length} post-transition KRAs`);
        totalKrasFixed += krasResult.rows.length;
      }

      // Fix pre-transition KRAs (ensure period_end_date is correct)
      const preKrasResult = await query(`
        UPDATE kras
        SET period_end_date = $1
        WHERE transition_id = $2
          AND period_type = 'pre_transition'
          AND (period_end_date IS NULL OR period_end_date != $3)
        RETURNING id, period_start_date, period_end_date
      `, [preEndDateStr, transitionId, preEndDateStr]);

      if (preKrasResult.rows.length > 0) {
        console.log(`  Fixed ${preKrasResult.rows.length} pre-transition KRAs (end date)`);
        totalKrasFixed += preKrasResult.rows.length;
      }

      console.log('');
    }

    console.log(`\nFix complete!`);
    console.log(`Total goals fixed: ${totalGoalsFixed}`);
    console.log(`Total KRAs fixed: ${totalKrasFixed}`);

    process.exit(0);
  } catch (error) {
    console.error('Error fixing post-transition dates:', error);
    process.exit(1);
  }
}

// Run the fix
fixPostTransitionDates();
