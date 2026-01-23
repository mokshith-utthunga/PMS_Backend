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

async function syncCalibration() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('\n🔧 Syncing calibration across KPI templates with same title...\n');
    
    // Find KPI templates without calibration that have a matching template with calibration
    const result = await client.query(`
      UPDATE kpi_templates kt_no_calib
      SET calibration = kt_has_calib.calibration
      FROM kpi_templates kt_has_calib
      WHERE kt_no_calib.title = kt_has_calib.title
        AND kt_no_calib.calibration IS NULL
        AND kt_has_calib.calibration IS NOT NULL
      RETURNING kt_no_calib.id, kt_no_calib.title, kt_no_calib.kra_template_id
    `);
    
    if (result.rows.length === 0) {
      console.log('✅ All KPI templates with matching titles already have calibration synced.');
    } else {
      console.log(`✅ Updated ${result.rows.length} KPI templates:\n`);
      result.rows.forEach(row => {
        console.log(`   - "${row.title}" (ID: ${row.id})`);
      });
    }
    
    // Verification
    console.log('\n📋 Verification - KPI templates now:\n');
    
    const verification = await client.query(`
      SELECT kt.title, kt.kra_template_id, krat.title as kra_title, kt.calibration IS NOT NULL as has_calib
      FROM kpi_templates kt
      JOIN kra_templates krat ON kt.kra_template_id = krat.id
      ORDER BY krat.title, kt.title
    `);
    
    let currentKra = '';
    verification.rows.forEach(row => {
      if (row.kra_title !== currentKra) {
        currentKra = row.kra_title;
        console.log(`\n📁 ${currentKra}:`);
      }
      const status = row.has_calib ? '✅' : '❌';
      console.log(`   ${status} "${row.title}"`);
    });
    
    console.log('\n✅ Done!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

syncCalibration();
