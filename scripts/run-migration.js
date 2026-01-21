import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Database configuration from environment variables
const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};

async function runMigration(migrationFile) {
  const client = new Client(dbConfig);
  
  try {
    console.log(`\n🔄 Connecting to database: ${dbConfig.database}...`);
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // Read migration file
    const migrationPath = join(__dirname, '..', 'db', 'migrations', migrationFile);
    console.log(`📄 Reading migration file: ${migrationFile}...`);
    const sql = readFileSync(migrationPath, 'utf8');

    console.log(`🚀 Executing migration: ${migrationFile}...\n`);
    
    // Execute migration
    await client.query(sql);
    
    console.log(`\n✅ Migration ${migrationFile} completed successfully!\n`);
    
  } catch (error) {
    console.error(`\n❌ Error running migration ${migrationFile}:`);
    console.error(error.message);
    if (error.position) {
      console.error(`Error at position: ${error.position}`);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Get migration file from command line argument
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.error('❌ Please provide a migration file name.');
  console.log('\nUsage: node scripts/run-migration.js <migration-file>');
  console.log('\nExample:');
  console.log('  node scripts/run-migration.js 001_schema_refactor.sql');
  console.log('  node scripts/run-migration.js 002_fix_manager_code_fkey.sql');
  process.exit(1);
}

// Validate database config
if (!dbConfig.database || !dbConfig.user) {
  console.error('❌ Database configuration missing!');
  console.error('Please ensure DB_NAME, DB_USER, and DB_PASSWORD are set in your .env file');
  process.exit(1);
}

runMigration(migrationFile);
