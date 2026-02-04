/**
 * Script to fix existing KRAs and KPIs that were created before transitions
 * were set up. This script updates them to have the correct period_type and transition_id.
 * 
 * Usage: node server/scripts/fix-pre-transition-kras-kpis.js
 */

import { query } from '../config/database.js';

async function fixPreTransitionKRAsKPIs() {
  try {
    console.log('Starting fix for pre-transition KRAs and KPIs...\n');

    // Get all transitions
    const transitionsResult = await query(`
      SELECT 
        id,
        employee_id,
        cycle_id,
        quarter,
        transition_date,
        pre_period_start_date,
        pre_period_end_date
      FROM employee_quarter_transitions
      ORDER BY employee_id, cycle_id, quarter, transition_date
    `);

    if (transitionsResult.rows.length === 0) {
      console.log('No transitions found. Exiting.');
      return;
    }

    console.log(`Found ${transitionsResult.rows.length} transition(s).\n`);

    for (const transition of transitionsResult.rows) {
      console.log(`\nProcessing transition ${transition.id} for employee ${transition.employee_id}, Q${transition.quarter}...`);
      console.log(`Transition date: ${transition.transition_date}`);

      // Get all KRAs for this employee/cycle/quarter that don't have period_type='pre_transition' or have NULL transition_id
      // These are likely KRAs created before the transition was set up
      const krasResult = await query(`
        SELECT 
          id,
          title,
          quarter,
          period_type,
          transition_id,
          period_start_date,
          period_end_date,
          created_at
        FROM kras
        WHERE employee_id = $1
          AND cycle_id = $2
          AND quarter = $3
          AND (
            period_type IS NULL 
            OR period_type = 'full_quarter'
            OR transition_id IS NULL
            OR (period_type != 'pre_transition' AND period_type != 'post_transition')
          )
          AND status = 'approved'
        ORDER BY created_at ASC
      `, [transition.employee_id, transition.cycle_id, transition.quarter]);

      console.log(`Found ${krasResult.rows.length} KRA(s) to potentially update.`);

      if (krasResult.rows.length === 0) {
        console.log('No KRAs to update for this transition.');
        continue;
      }

      // Determine if each KRA should be pre_transition or post_transition
      const transitionDate = new Date(transition.transition_date);
      transitionDate.setHours(0, 0, 0, 0);

      for (const kra of krasResult.rows) {
        // Check when the KRA was created or use period_start_date
        const kraDate = kra.created_at ? new Date(kra.created_at) : (kra.period_start_date ? new Date(kra.period_start_date) : null);
        
        // If we can't determine the date, check if period_start_date is before transition_date
        let shouldBePreTransition = false;
        if (kra.period_start_date) {
          const kraStartDate = new Date(kra.period_start_date);
          kraStartDate.setHours(0, 0, 0, 0);
          shouldBePreTransition = kraStartDate < transitionDate;
        } else if (kraDate) {
          kraDate.setHours(0, 0, 0, 0);
          shouldBePreTransition = kraDate < transitionDate;
        } else {
          // Default: if we can't determine, assume it's pre-transition (most common case)
          shouldBePreTransition = true;
        }

        // Calculate period dates
        const prePeriodStartDate = transition.pre_period_start_date || null;
        const prePeriodEndDate = transition.pre_period_end_date || transition.transition_date;

        if (shouldBePreTransition) {
          console.log(`  Updating KRA ${kra.id} (${kra.title}) to pre_transition...`);
          
          // Update KRA to pre_transition
          await query(`
            UPDATE kras
            SET 
              period_type = 'pre_transition',
              transition_id = $1,
              period_start_date = COALESCE($2, period_start_date),
              period_end_date = COALESCE($3, period_end_date),
              updated_at = NOW()
            WHERE id = $4
          `, [
            transition.id,
            prePeriodStartDate,
            prePeriodEndDate,
            kra.id
          ]);

          // Update all KPIs for this KRA
          const kpisResult = await query(`
            SELECT id, title, created_at, period_start_date
            FROM goals
            WHERE kra_id = $1
          `, [kra.id]);

          for (const kpi of kpisResult.rows) {
            // Determine if KPI should be pre_transition
            let kpiShouldBePreTransition = shouldBePreTransition;
            if (kpi.period_start_date) {
              const kpiStartDate = new Date(kpi.period_start_date);
              kpiStartDate.setHours(0, 0, 0, 0);
              kpiShouldBePreTransition = kpiStartDate < transitionDate;
            } else if (kpi.created_at) {
              const kpiDate = new Date(kpi.created_at);
              kpiDate.setHours(0, 0, 0, 0);
              kpiShouldBePreTransition = kpiDate < transitionDate;
            }

            if (kpiShouldBePreTransition) {
              await query(`
                UPDATE goals
                SET 
                  period_type = 'pre_transition',
                  transition_id = $1,
                  period_start_date = COALESCE($2, period_start_date),
                  period_end_date = COALESCE($3, period_end_date),
                  updated_at = NOW()
                WHERE id = $4
              `, [
                transition.id,
                prePeriodStartDate,
                prePeriodEndDate,
                kpi.id
              ]);
            }
          }

          console.log(`  ✓ Updated KRA ${kra.id} and its KPIs to pre_transition.`);
        } else {
          console.log(`  Skipping KRA ${kra.id} (${kra.title}) - appears to be post_transition.`);
        }
      }
    }

    console.log('\n✅ Fix completed successfully!');
  } catch (error) {
    console.error('❌ Error fixing pre-transition KRAs/KPIs:', error);
    throw error;
  }
}

// Run the script
fixPreTransitionKRAsKPIs()
  .then(() => {
    console.log('\nScript finished.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
