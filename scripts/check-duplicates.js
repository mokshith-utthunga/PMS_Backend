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

async function checkDuplicates() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('\n🔍 Checking for duplicate KPI templates...\n');
    
    // Find all templates with same title
    const duplicates = await client.query(`
      SELECT title, COUNT(*) as count
      FROM kpi_templates
      GROUP BY title
      HAVING COUNT(*) > 1
    `);
    
    if (duplicates.rows.length === 0) {
      console.log('No duplicate template titles found.');
    } else {
      console.log(`Found ${duplicates.rows.length} titles with duplicates:\n`);
      
      for (const dup of duplicates.rows) {
        console.log(`"${dup.title}" (${dup.count} copies):`);
        
        const templates = await client.query(`
          SELECT id, kra_template_id, calibration IS NOT NULL as has_calib, created_at
          FROM kpi_templates
          WHERE title = $1
          ORDER BY created_at
        `, [dup.title]);
        
        templates.rows.forEach(t => {
          console.log(`   ID: ${t.id}`);
          console.log(`   KRA Template: ${t.kra_template_id}`);
          console.log(`   Has Calibration: ${t.has_calib ? '✅ YES' : '❌ NO'}`);
          console.log(`   Created: ${t.created_at}`);
          console.log('');
        });
      }
    }
    
    // Show which templates have calibration
    console.log('\n📋 All KPI templates with calibration:');
    const withCalib = await client.query(`
      SELECT kt.id, kt.title, kt.kra_template_id, krat.title as kra_title
      FROM kpi_templates kt
      LEFT JOIN kra_templates krat ON kt.kra_template_id = krat.id
      WHERE kt.calibration IS NOT NULL
    `);
    withCalib.rows.forEach(t => {
      console.log(`   "${t.title}" (KRA: ${t.kra_title || 'N/A'})`);
      console.log(`   ID: ${t.id}`);
    });
    
    // Show goals and their template references
    console.log('\n📋 Goals and their template references:');
    const goals = await client.query(`
      SELECT g.id, g.title, g.kpi_template_id, kt.kra_template_id, krat.title as kra_title
      FROM goals g
      LEFT JOIN kpi_templates kt ON g.kpi_template_id = kt.id
      LEFT JOIN kra_templates krat ON kt.kra_template_id = krat.id
      WHERE g.goal_type = 'kpi'
    `);
    goals.rows.forEach(g => {
      console.log(`   "${g.title}"`);
      console.log(`   KPI Template ID: ${g.kpi_template_id}`);
      console.log(`   Links to KRA Template: ${g.kra_title || 'N/A'}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkDuplicates();
