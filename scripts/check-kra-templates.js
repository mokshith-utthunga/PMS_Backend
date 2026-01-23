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

async function check() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('\n📋 KRA Templates and their KPI templates:\n');
    
    const kraTemplates = await client.query(`
      SELECT id, title, is_active 
      FROM kra_templates 
      ORDER BY title
    `);
    
    for (const kra of kraTemplates.rows) {
      console.log(`\n📁 "${kra.title}" (${kra.is_active ? '✅ Active' : '❌ Inactive'})`);
      console.log(`   ID: ${kra.id}`);
      
      const kpis = await client.query(`
        SELECT title, calibration IS NOT NULL as has_calib
        FROM kpi_templates 
        WHERE kra_template_id = $1
      `, [kra.id]);
      
      if (kpis.rows.length === 0) {
        console.log('   No KPIs');
      } else {
        console.log(`   KPIs (${kpis.rows.length}):`);
        kpis.rows.forEach(kpi => {
          const calibStatus = kpi.has_calib ? '✅ Has calibration' : '❌ No calibration';
          console.log(`      - "${kpi.title}" - ${calibStatus}`);
        });
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

check();
