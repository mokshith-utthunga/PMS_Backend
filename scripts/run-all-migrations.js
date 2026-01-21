import { readdirSync } from 'fs';
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

async function runAllMigrations() {
  const client = new Client(dbConfig);
  
  try {
    console.log(`\n🔄 Connecting to database: ${dbConfig.database}...`);
    await client.connect();
    console.log('✅ Connected successfully!\n');

    // Get all migration files sorted by name
    const migrationsDir = join(__dirname, '..', 'db', 'migrations');
    const files = readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      console.log('⚠️  No migration files found.');
      return;
    }

    console.log(`📋 Found ${files.length} migration file(s):\n`);
    files.forEach((file, index) => {
      console.log(`  ${index + 1}. ${file}`);
    });
    console.log('');

    // Run each migration
    for (const file of files) {
      const migrationPath = join(migrationsDir, file);
      console.log(`\n📄 Executing: ${file}...`);
      
      try {
        const sql = readFileSync(migrationPath, 'utf8');
        await client.query(sql);
        console.log(`✅ ${file} completed successfully!`);
      } catch (error) {
        console.error(`\n❌ Error in migration ${file}:`);
        console.error(error.message);
        if (error.position) {
          console.error(`Error at position: ${error.position}`);
        }
        throw error;
      }
    }

    console.log(`\n\n🎉 All migrations completed successfully!\n`);
    
  } catch (error) {
    console.error(`\n❌ Migration failed:`);
    console.error(error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Validate database config
if (!dbConfig.database || !dbConfig.user) {
  console.error('❌ Database configuration missing!');
  console.error('Please ensure DB_NAME, DB_USER, and DB_PASSWORD are set in your .env file');
  process.exit(1);
}

runAllMigrations();
