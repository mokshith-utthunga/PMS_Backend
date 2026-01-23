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
    console.log('\n📊 DATA MIGRATION VERIFICATION\n');
    console.log('='.repeat(50));
    
    // KRAs summary
    const krasTotal = await client.query('SELECT COUNT(*) as count FROM kras');
    const krasWithTemplate = await client.query('SELECT COUNT(*) as count FROM kras WHERE kra_template_id IS NOT NULL');
    console.log('\n📁 KRAs:');
    console.log(`   Total KRAs: ${krasTotal.rows[0].count}`);
    console.log(`   With template reference: ${krasWithTemplate.rows[0].count}`);
    
    // KPIs summary
    const kpisTotal = await client.query("SELECT COUNT(*) as count FROM goals WHERE goal_type = 'kpi'");
    const kpisWithTemplate = await client.query("SELECT COUNT(*) as count FROM goals WHERE kpi_template_id IS NOT NULL AND goal_type = 'kpi'");
    const kpisWithCalibration = await client.query("SELECT COUNT(*) as count FROM goals WHERE calibration IS NOT NULL AND goal_type = 'kpi'");
    const kpisWithQuarter = await client.query("SELECT COUNT(*) as count FROM goals WHERE quarter IS NOT NULL AND goal_type = 'kpi'");
    console.log('\n📋 KPIs (Goals):');
    console.log(`   Total KPIs: ${kpisTotal.rows[0].count}`);
    console.log(`   With template reference: ${kpisWithTemplate.rows[0].count}`);
    console.log(`   With calibration: ${kpisWithCalibration.rows[0].count}`);
    console.log(`   With quarter: ${kpisWithQuarter.rows[0].count}`);
    
    // Sample data
    console.log('\n📝 Sample KRAs with template reference:');
    const sampleKras = await client.query(`
      SELECT k.id, k.title, k.kra_template_id, k.quarter, kt.title as template_title
      FROM kras k
      LEFT JOIN kra_templates kt ON k.kra_template_id = kt.id
      LIMIT 5
    `);
    sampleKras.rows.forEach(row => {
      console.log(`   - "${row.title}" (Q${row.quarter || 'N/A'}) → Template: ${row.template_title || 'Custom'}`);
    });
    
    console.log('\n📝 Sample KPIs with calibration:');
    const sampleKpis = await client.query(`
      SELECT g.id, g.title, g.quarter, g.calibration, g.kpi_template_id
      FROM goals g
      WHERE g.goal_type = 'kpi'
      LIMIT 5
    `);
    sampleKpis.rows.forEach(row => {
      const hasCalib = row.calibration ? '✅ Has calibration' : '❌ No calibration';
      console.log(`   - "${row.title}" (Q${row.quarter || 'N/A'}) - ${hasCalib}`);
    });
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ Verification complete!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

verify();
