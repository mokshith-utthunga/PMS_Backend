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

async function copyCalibration() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('\n🔍 Debugging calibration copy...\n');
    
    // Check KPI templates with calibration
    const templates = await client.query(`
      SELECT id, title, calibration 
      FROM kpi_templates 
      WHERE calibration IS NOT NULL
    `);
    console.log(`📋 KPI Templates with calibration: ${templates.rows.length}`);
    templates.rows.forEach(t => {
      console.log(`   - "${t.title}" - ${JSON.stringify(t.calibration)}`);
    });
    
    // Check goals that have kpi_template_id
    const goalsWithTemplate = await client.query(`
      SELECT g.id, g.title, g.kpi_template_id, g.calibration, kt.title as template_title, kt.calibration as template_calibration
      FROM goals g
      LEFT JOIN kpi_templates kt ON g.kpi_template_id = kt.id
      WHERE g.goal_type = 'kpi'
    `);
    console.log(`\n📋 KPIs with template reference:`);
    goalsWithTemplate.rows.forEach(g => {
      console.log(`   - "${g.title}"`);
      console.log(`     Template: ${g.template_title || 'None'}`);
      console.log(`     Goal calibration: ${g.calibration ? 'Has data' : 'NULL'}`);
      console.log(`     Template calibration: ${g.template_calibration ? 'Has data' : 'NULL'}`);
    });
    
    // Now copy calibration from templates to goals
    console.log('\n🚀 Copying calibration from templates to goals...\n');
    
    const updateResult = await client.query(`
      UPDATE goals g
      SET calibration = kt.calibration
      FROM kpi_templates kt
      WHERE g.kpi_template_id = kt.id
        AND kt.calibration IS NOT NULL
      RETURNING g.id, g.title
    `);
    
    console.log(`✅ Updated ${updateResult.rows.length} goals with calibration:`);
    updateResult.rows.forEach(r => {
      console.log(`   - ${r.title}`);
    });
    
    // Verify
    console.log('\n📊 Verification:');
    const verify = await client.query(`
      SELECT g.id, g.title, g.calibration
      FROM goals g
      WHERE g.goal_type = 'kpi' AND g.calibration IS NOT NULL
    `);
    console.log(`KPIs with calibration: ${verify.rows.length}`);
    verify.rows.forEach(g => {
      const rules = g.calibration;
      console.log(`   - "${g.title}": ${rules.length} rules`);
    });
    
    console.log('\n✅ Done!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

copyCalibration();
