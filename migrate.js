// migrate.js
'use strict';

const fs = require('fs');
const path = require('path');
const pool = require('./db'); // 👈 aquí llega el Pool

/**
 * Ejecuta el archivo migrations/001_init.sql dentro de una transacción.
 * Devuelve información mínima de lo aplicado.
 */
async function runMigrations() {
  const filePath = path.join(__dirname, 'migrations', '001_init.sql');

  if (!fs.existsSync(filePath)) {
    throw new Error(`No existe el archivo de migración: ${filePath}`);
  }

  const sql = fs.readFileSync(filePath, 'utf8').trim();
  if (!sql) {
    return { applied: null, message: 'El archivo SQL está vacío, no hay cambios.' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql); // Ejecuta todo el script (múltiples sentencias soportadas)
    await client.query('COMMIT');
    return { applied: path.basename(filePath) };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Migración falló:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };
