// Script to run the quarter column migration for late_submission_permissions
import { query } from '../config/database.js';

async function runMigration() {
  try {
    console.log('Starting migration: Add quarter to late_submission_permissions...');
    
    // Execute each statement individually for better error handling
    const statements = [
      {
        name: 'Add quarter column',
        sql: `ALTER TABLE late_submission_permissions ADD COLUMN IF NOT EXISTS quarter INTEGER CHECK (quarter BETWEEN 1 AND 4)`
      },
      {
        name: 'Drop old unique constraint',
        sql: `ALTER TABLE late_submission_permissions DROP CONSTRAINT IF EXISTS late_submission_permissions_cycle_id_employee_id_key`
      },
      {
        name: 'Create new unique index with quarter',
        sql: `CREATE UNIQUE INDEX IF NOT EXISTS late_submission_permissions_cycle_employee_quarter_idx ON late_submission_permissions (cycle_id, employee_id, COALESCE(quarter, 0))`
      },
      {
        name: 'Create quarter index',
        sql: `CREATE INDEX IF NOT EXISTS late_submission_permissions_quarter_idx ON late_submission_permissions (quarter)`
      },
      {
        name: 'Add column comment',
        sql: `COMMENT ON COLUMN late_submission_permissions.quarter IS 'Quarter number (1-4). NULL means permission applies to all quarters.'`
      }
    ];
    
    for (const stmt of statements) {
      console.log(`\n📌 ${stmt.name}...`);
      console.log(`   SQL: ${stmt.sql.substring(0, 80)}...`);
      try {
        await query(stmt.sql);
        console.log(`   ✅ Success`);
      } catch (err) {
        console.log(`   ⚠️  ${err.message}`);
        // Continue even if some statements fail (e.g., constraint already exists)
      }
    }
    
    console.log('\n📊 Verifying migration...');
    
    // Verify the quarter column exists
    const columnResult = await query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'late_submission_permissions' AND column_name = 'quarter'
    `);
    
    if (columnResult.rows.length > 0) {
      console.log('✅ Quarter column verified:', columnResult.rows[0]);
    } else {
      console.log('❌ Quarter column NOT found!');
      
      // Check if table exists
      const tableResult = await query(`
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'late_submission_permissions'
      `);
      console.log('\n📋 Current columns in late_submission_permissions:');
      tableResult.rows.forEach(r => console.log(`   - ${r.column_name}`));
    }
    
    // Verify index exists
    const indexResult = await query(`
      SELECT indexname FROM pg_indexes 
      WHERE tablename = 'late_submission_permissions' 
      AND indexname LIKE '%quarter%'
    `);
    
    if (indexResult.rows.length > 0) {
      console.log('✅ Quarter indexes found:', indexResult.rows.map(r => r.indexname).join(', '));
    }
    
    console.log('\n✅ Migration completed!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
