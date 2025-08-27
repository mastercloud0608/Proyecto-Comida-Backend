const { Pool } = require('pg');
require('dotenv').config(); // Cargar las variables de entorno desde el archivo .env

let pool;

if (process.env.NODE_ENV === 'production') {
  // Usar la URL de base de datos de producción (Render)
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false, // Necesario para la conexión SSL con Render
    },
  });
} else {
  // Usar la URL de base de datos de desarrollo (localhost)
  pool = new Pool({
    connectionString: process.env.LOCAL_DATABASE_URL,
  });
}

module.exports = pool;
