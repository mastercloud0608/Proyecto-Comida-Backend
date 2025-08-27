const { Pool } = require('pg');

// Usamos la URL de conexión proporcionada por Render
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // La URL de la base de datos
  ssl: {
    rejectUnauthorized: false, // Necesario para la conexión SSL con Render
  },
});

module.exports = pool;
