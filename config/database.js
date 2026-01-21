import { Sequelize, QueryTypes } from 'sequelize';
import dotenv from 'dotenv';

dotenv.config();

// Database configuration
const config = {
  development: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: process.env.NODE_ENV === 'development' ? console.log : false,
    pool: {
      max: 5,
      min: 0,
      acquire: 30000,
      idle: 10000
    }
  },
  test: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME_TEST,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    dialect: 'postgres',
    logging: false
  },
  production: {
    username: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: false,
    pool: {
      max: 20,
      min: 5,
      acquire: 30000,
      idle: 10000
    }
  }
};

// Create Sequelize instance
const env = process.env.NODE_ENV || 'development';
const sequelize = new Sequelize(
  config[env].database,
  config[env].username,
  config[env].password,
  {
    host: config[env].host,
    port: config[env].port,
    dialect: config[env].dialect,
    logging: config[env].logging,
    pool: config[env].pool
  }
);

// Test database connection
export const testConnection = async () => {
  try {
    await sequelize.authenticate();
    console.log('✅ Database connection established successfully.');
  } catch (error) {
    console.error('❌ Unable to connect to the database:', error);
  }
};

// Query helper function (for backward compatibility with pg-style queries)
// Converts $1, $2, etc. to Sequelize's ? placeholders
export const query = async (text, params = []) => {
  try {
    // Convert PostgreSQL-style $1, $2 to ? placeholders
    let queryText = text;
    if (params && params.length > 0) {
      for (let i = params.length; i >= 1; i--) {
        queryText = queryText.replace(new RegExp(`\\$${i}`, 'g'), '?');
      }
    }

    // Determine query type
    const upperQuery = queryText.trim().toUpperCase();
    const isSelect = upperQuery.startsWith('SELECT');
    const hasReturning = upperQuery.includes('RETURNING');
    const isInsert = upperQuery.startsWith('INSERT');
    const isUpdate = upperQuery.startsWith('UPDATE');
    const isDelete = upperQuery.startsWith('DELETE');

    // For queries with RETURNING, execute without specifying type to let PostgreSQL handle it correctly
    // This ensures UPDATE/DELETE/INSERT with RETURNING clauses execute and return rows properly
    if (hasReturning) {
      const [results] = await sequelize.query(queryText, {
        replacements: params
      });
      // Results from RETURNING queries are returned as an array of objects
      const rows = Array.isArray(results) ? results : (results ? [results] : []);
      return { rows, rowCount: rows.length };
    } else if (isSelect) {
      const results = await sequelize.query(queryText, {
        replacements: params,
        type: QueryTypes.SELECT
      });
      return { rows: results, rowCount: results.length };
    } else if (isInsert) {
      const [results, metadata] = await sequelize.query(queryText, {
        replacements: params,
        type: QueryTypes.INSERT
      });
      return { rows: Array.isArray(results) ? results : [], rowCount: metadata };
    } else if (isUpdate) {
      const [, metadata] = await sequelize.query(queryText, {
        replacements: params,
        type: QueryTypes.UPDATE
      });
      return { rows: [], rowCount: metadata };
    } else if (isDelete) {
      const [, metadata] = await sequelize.query(queryText, {
        replacements: params,
        type: QueryTypes.DELETE
      });
      return { rows: [], rowCount: metadata };
    } else {
      const [results] = await sequelize.query(queryText, {
        replacements: params
      });
      return { rows: results || [], rowCount: results?.length || 0 };
    }
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
};

export { sequelize, config };
export default sequelize;
