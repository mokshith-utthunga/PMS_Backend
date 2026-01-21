import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runHRReviewMigration() {
  try {
    console.log('\n🔄 Running HR Review Workflow Migration...\n');
    
    const migrationPath = join(__dirname, '..', 'db', 'migrations', '002_hr_review_workflow.sql');
    const sql = readFileSync(migrationPath, 'utf8');
    
    // Split by semicolons and execute each statement
    const statements = sql.split(';').filter(s => s.trim().length > 0);
    
    for (const statement of statements) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        try {
          await query(trimmed);
          console.log('✅ Executed statement successfully');
        } catch (error) {
          // Ignore errors for IF NOT EXISTS checks
          if (error.message.includes('already exists') || error.message.includes('does not exist')) {
            console.log('⚠️  Skipped (already exists or conditional):', error.message.substring(0, 100));
          } else {
            throw error;
          }
        }
      }
    }
    
    console.log('\n✅ HR Review Workflow Migration completed successfully!\n');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Migration failed:');
    console.error(error.message);
    process.exit(1);
  }
}

runHRReviewMigration();
