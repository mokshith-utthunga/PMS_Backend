/**
 * Script to sync manager_history table with employee_quarter_transitions
 * 
 * This script:
 * 1. Backfills transition_id in existing manager_history records
 * 2. Creates missing manager_history records for existing transitions
 * 
 * Usage: node server/scripts/sync-manager-history.js
 */

import { query } from '../config/database.js';

async function syncManagerHistory() {
  try {
    console.log('Starting manager_history sync...\n');

    // Step 1: Get all transitions
    const transitionsResult = await query(`
      SELECT 
        id,
        employee_id,
        old_manager_id,
        new_manager_id,
        transition_date,
        created_at
      FROM employee_quarter_transitions
      ORDER BY created_at ASC
    `);

    if (transitionsResult.rows.length === 0) {
      console.log('No transitions found. Exiting.');
      return;
    }

    console.log(`Found ${transitionsResult.rows.length} transition(s).\n`);

    let updatedCount = 0;
    let createdCount = 0;
    let skippedCount = 0;

    for (const transition of transitionsResult.rows) {
      console.log(`Processing transition ${transition.id} for employee ${transition.employee_id}...`);
      console.log(`  Transition date: ${transition.transition_date}`);
      console.log(`  Old manager: ${transition.old_manager_id || 'NULL'}`);
      console.log(`  New manager: ${transition.new_manager_id || 'NULL'}`);

      // Check if manager_history record exists for this transition
      const existingHistoryResult = await query(
        `SELECT id, transition_id, old_manager_id, new_manager_id
         FROM manager_history
         WHERE transition_id = $1
         LIMIT 1`,
        [transition.id]
      );

      if (existingHistoryResult.rows.length > 0) {
        const existingHistory = existingHistoryResult.rows[0];
        
        // Check if transition_id is already set
        if (existingHistory.transition_id) {
          console.log(`  ✓ Manager history already linked to transition (ID: ${existingHistory.id})`);
          skippedCount++;
          continue;
        }

        // Update existing record with transition_id
        console.log(`  Updating existing manager_history record ${existingHistory.id} with transition_id...`);
        await query(
          `UPDATE manager_history
           SET transition_id = $1
           WHERE id = $2`,
          [transition.id, existingHistory.id]
        );
        console.log(`  ✓ Updated manager_history record ${existingHistory.id}`);
        updatedCount++;
        continue;
      }

      // Check if manager_history exists for this employee and date (without transition_id)
      const historyByDateResult = await query(
        `SELECT id, transition_id, old_manager_id, new_manager_id
         FROM manager_history
         WHERE employee_id = $1
           AND effective_date = $2
           AND (transition_id IS NULL OR transition_id != $3)
         ORDER BY created_at DESC
         LIMIT 1`,
        [transition.employee_id, transition.transition_date, transition.id]
      );

      if (historyByDateResult.rows.length > 0) {
        const historyByDate = historyByDateResult.rows[0];
        
        // Check if the manager IDs match
        if (historyByDate.old_manager_id === transition.old_manager_id &&
            historyByDate.new_manager_id === transition.new_manager_id) {
          // Update this record with transition_id
          console.log(`  Updating existing manager_history record ${historyByDate.id} (by date) with transition_id...`);
          await query(
            `UPDATE manager_history
             SET transition_id = $1
             WHERE id = $2`,
            [transition.id, historyByDate.id]
          );
          console.log(`  ✓ Updated manager_history record ${historyByDate.id}`);
          updatedCount++;
          continue;
        } else {
          console.log(`  ⚠ Manager history exists but manager IDs don't match. Creating new record...`);
        }
      }

      // Create new manager_history record if manager actually changed
      if (transition.old_manager_id !== transition.new_manager_id) {
        // Get created_by from transition
        const transitionDetailsResult = await query(
          `SELECT created_by FROM employee_quarter_transitions WHERE id = $1`,
          [transition.id]
        );
        const createdBy = transitionDetailsResult.rows[0]?.created_by || null;

        console.log(`  Creating new manager_history record...`);
        const insertResult = await query(
          `INSERT INTO manager_history (
            employee_id, old_manager_id, new_manager_id, effective_date, changed_by, transition_id
          ) VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id`,
          [
            transition.employee_id,
            transition.old_manager_id,
            transition.new_manager_id,
            transition.transition_date,
            createdBy,
            transition.id
          ]
        );
        console.log(`  ✓ Created manager_history record ${insertResult.rows[0].id}`);
        createdCount++;
      } else {
        console.log(`  ⊘ Skipping - manager didn't change (old_manager_id === new_manager_id or both NULL)`);
        skippedCount++;
      }
    }

    console.log('\n=== Sync Summary ===');
    console.log(`Total transitions processed: ${transitionsResult.rows.length}`);
    console.log(`Manager history records updated: ${updatedCount}`);
    console.log(`Manager history records created: ${createdCount}`);
    console.log(`Skipped (already synced or no manager change): ${skippedCount}`);
    console.log('===================\n');

    // Step 2: Verify sync - check for transitions without manager_history
    const orphanedTransitionsResult = await query(`
      SELECT eqt.id, eqt.employee_id, eqt.transition_date, eqt.old_manager_id, eqt.new_manager_id
      FROM employee_quarter_transitions eqt
      WHERE eqt.old_manager_id != eqt.new_manager_id
        AND NOT EXISTS (
          SELECT 1 FROM manager_history mh
          WHERE mh.transition_id = eqt.id
        )
      ORDER BY eqt.created_at ASC
    `);

    if (orphanedTransitionsResult.rows.length > 0) {
      console.log(`⚠ Warning: Found ${orphanedTransitionsResult.rows.length} transition(s) without manager_history:`);
      orphanedTransitionsResult.rows.forEach(t => {
        console.log(`  - Transition ${t.id} (Employee: ${t.employee_id}, Date: ${t.transition_date})`);
      });
      console.log('\nThese transitions have manager changes but no manager_history record.');
      console.log('You may want to review these manually.\n');
    } else {
      console.log('✓ All transitions with manager changes have corresponding manager_history records.\n');
    }

    console.log('✅ Sync completed successfully!');
  } catch (error) {
    console.error('❌ Error syncing manager_history:', error);
    throw error;
  }
}

// Run the script
syncManagerHistory()
  .then(() => {
    console.log('\nScript finished.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
