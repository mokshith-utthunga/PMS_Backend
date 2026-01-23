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

async function checkTable() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    
    console.log('\n📋 goals_quarterly_cycles columns:');
    const gqc = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'goals_quarterly_cycles' 
      ORDER BY ordinal_position
    `);
    gqc.rows.forEach(row => console.log(`   - ${row.column_name} (${row.data_type})`));
    
    console.log('\n📋 quarterly_cycles columns:');
    const qc = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'quarterly_cycles' 
      ORDER BY ordinal_position
    `);
    qc.rows.forEach(row => console.log(`   - ${row.column_name} (${row.data_type})`));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkTable();
