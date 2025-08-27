const { Pool } = require('pg');

// Configuración para conectar con la base de datos PostgreSQL
const pool = new Pool({
  user: 'postgres',         // Reemplaza con tu usuario de PostgreSQL
  host: 'localhost',
  database: 'comida',     // Nombre de la base de datos que creamos
  password: '123456',  // Reemplaza con tu contraseña de PostgreSQL
  port: 5432,                 // Puerto por defecto para PostgreSQL
});

module.exports = pool;
