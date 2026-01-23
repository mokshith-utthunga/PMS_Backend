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

async function test() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('\n📋 Testing KPI Templates with calibration:\n');
    
    const result = await client.query(`
      SELECT id, title, kra_template_id, calibration, 
             pg_typeof(calibration) as calib_type
      FROM kpi_templates 
      WHERE calibration IS NOT NULL
      LIMIT 5
    `);
    
    result.rows.forEach(row => {
      console.log(`"${row.title}"`);
      console.log(`   ID: ${row.id}`);
      console.log(`   Type: ${row.calib_type}`);
      console.log(`   Calibration: ${JSON.stringify(row.calibration)}`);
      console.log('');
    });
    
    // Simulate the API query
    console.log('\n📋 Simulating API query (SELECT *):\n');
    const apiResult = await client.query(`
      SELECT * FROM kpi_templates 
      WHERE kra_template_id = (SELECT kra_template_id FROM kpi_templates WHERE calibration IS NOT NULL LIMIT 1)
    `);
    
    apiResult.rows.forEach(row => {
      console.log(`"${row.title}"`);
      console.log(`   Has calibration: ${row.calibration ? 'YES' : 'NO'}`);
      if (row.calibration) {
        console.log(`   Calibration value: ${JSON.stringify(row.calibration)}`);
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

test();
