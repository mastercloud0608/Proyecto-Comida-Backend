// migrate.js
'use strict';
const fs = require('fs');
const path = require('path');
const pool = require('./db');

async function runMigrations() {
  const file = path.join(__dirname, 'migrations', '001_init.sql');
  const sql = fs.readFileSync(file, 'utf8');
  await pool.query(sql);
  return 'OK';
}

module.exports = { runMigrations };
