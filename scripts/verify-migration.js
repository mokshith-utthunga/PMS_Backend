import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Client } = pg;

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};

async function verify() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('\n🔍 Verifying migration columns...\n');
    
    const result = await client.query(`
      SELECT table_name, column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name IN ('kras', 'goals', 'kpi_templates') 
      AND column_name IN ('kra_template_id', 'kpi_template_id', 'calibration')
      ORDER BY table_name, column_name
    `);
    
    if (result.rows.length === 0) {
      console.log('❌ No columns found! Migration may have failed.');
    } else {
      console.log('✅ Found columns:\n');
      result.rows.forEach(row => {
        console.log(`   ${row.table_name}.${row.column_name} (${row.data_type})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

verify();
