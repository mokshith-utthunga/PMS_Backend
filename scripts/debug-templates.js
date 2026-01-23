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

async function debug() {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    console.log('\n🔍 Debug: Checking kpi_template_id matching...\n');
    
    // Check the actual kpi_template_id values in goals
    const goals = await client.query(`
      SELECT id, title, kpi_template_id
      FROM goals
      WHERE goal_type = 'kpi'
    `);
    
    console.log('Goals kpi_template_id values:');
    for (const g of goals.rows) {
      console.log(`\n"${g.title}"`);
      console.log(`  kpi_template_id: ${g.kpi_template_id}`);
      
      // Check if this ID exists in kpi_templates
      const template = await client.query(`
        SELECT id, title, calibration 
        FROM kpi_templates 
        WHERE id = $1
      `, [g.kpi_template_id]);
      
      if (template.rows.length > 0) {
        console.log(`  Template found: "${template.rows[0].title}"`);
        console.log(`  Template calibration: ${template.rows[0].calibration ? JSON.stringify(template.rows[0].calibration) : 'NULL'}`);
      } else {
        console.log(`  ❌ Template NOT FOUND!`);
      }
    }
    
    // Find templates by title match
    console.log('\n\n📋 Finding templates by title match:');
    for (const g of goals.rows) {
      const template = await client.query(`
        SELECT id, title, calibration 
        FROM kpi_templates 
        WHERE title = $1
      `, [g.title]);
      
      if (template.rows.length > 0) {
        console.log(`\n"${g.title}"`);
        console.log(`  Current kpi_template_id: ${g.kpi_template_id}`);
        console.log(`  Correct template ID: ${template.rows[0].id}`);
        console.log(`  Match: ${g.kpi_template_id === template.rows[0].id ? '✅' : '❌ MISMATCH'}`);
        console.log(`  Template calibration: ${template.rows[0].calibration ? 'Has data' : 'NULL'}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

debug();
