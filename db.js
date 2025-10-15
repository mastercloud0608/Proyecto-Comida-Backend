// db.js
'use strict';
const { Pool } = require('pg');
require('dotenv-flow').config(); // carga .env*, respeta NODE_ENV
const { runMigrations } = require('./migrate');


const isProd = process.env.NODE_ENV === 'production';

if (isProd && !process.env.DATABASE_URL) {
  console.error('❌ Falta DATABASE_URL en producción');
}
if (!isProd && !process.env.LOCAL_DATABASE_URL) {
  console.warn('⚠️ Falta LOCAL_DATABASE_URL. Usaré DATABASE_URL si existe.');
}

const pool = new Pool({
  connectionString: isProd
    ? process.env.DATABASE_URL
    : (process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL),
  ssl: isProd ? { rejectUnauthorized: false } : false,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT || 30000),
  connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT || 10000),
});

// Logs útiles
pool.on('connect', () => console.log('✅ Conectado a PostgreSQL'));
pool.on('error', (err) => console.error('💥 Error en el pool PG:', err));

// Pequeño “ping” al iniciar (opcional)
(async () => {
  try {
    const { rows } = await pool.query('SELECT NOW() as now');
    console.log('🟢 PG listo:', rows[0].now);
  } catch (e) {
    console.error('⛔ No se pudo conectar a PostgreSQL:', e.message);
  }
})();



module.exports = pool;
