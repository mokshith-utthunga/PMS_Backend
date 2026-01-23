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

async function fixReferences() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('\n🔧 Fixing KPI template references to use templates with calibration...\n');
    
    // Step 1: Update kpi_template_id to point to templates WITH calibration
    const updateTemplateIds = await client.query(`
      UPDATE goals g
      SET kpi_template_id = correct_template.id
      FROM (
        SELECT kt.id, kt.title
        FROM kpi_templates kt
        WHERE kt.calibration IS NOT NULL
      ) correct_template
      WHERE g.title = correct_template.title
        AND g.goal_type = 'kpi'
      RETURNING g.id, g.title, g.kpi_template_id
    `);
    
    console.log(`✅ Updated ${updateTemplateIds.rows.length} goal template references:`);
    updateTemplateIds.rows.forEach(r => {
      console.log(`   - "${r.title}" → ${r.kpi_template_id}`);
    });
    
    // Step 2: Copy calibration from templates to goals
    console.log('\n🔧 Copying calibration from templates to goals...\n');
    
    const copyCalib = await client.query(`
      UPDATE goals g
      SET calibration = kt.calibration
      FROM kpi_templates kt
      WHERE g.kpi_template_id = kt.id
        AND kt.calibration IS NOT NULL
      RETURNING g.id, g.title
    `);
    
    console.log(`✅ Copied calibration to ${copyCalib.rows.length} goals:`);
    copyCalib.rows.forEach(r => {
      console.log(`   - "${r.title}"`);
    });
    
    // Verification
    console.log('\n📊 Verification:\n');
    
    const verify = await client.query(`
      SELECT g.title, g.calibration, kt.title as template_title, kt.calibration as template_calib
      FROM goals g
      LEFT JOIN kpi_templates kt ON g.kpi_template_id = kt.id
      WHERE g.goal_type = 'kpi'
    `);
    
    verify.rows.forEach(g => {
      const goalCalib = g.calibration ? `✅ ${g.calibration.length} rules` : '❌ NULL';
      const templateCalib = g.template_calib ? `✅ ${g.template_calib.length} rules` : '❌ NULL';
      console.log(`"${g.title}"`);
      console.log(`   Template: ${g.template_title}`);
      console.log(`   Goal calibration: ${goalCalib}`);
      console.log(`   Template calibration: ${templateCalib}`);
      console.log('');
    });
    
    console.log('✅ Done!\n');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error);
  } finally {
    await client.end();
  }
}

fixReferences();
