const express = require('express');
const cors = require('cors'); // Importamos el paquete cors
const app = express();
const port = 3000;

const authRoutes = require('./auth');
const comidaRoutes = require('./comida');

// Middleware para habilitar CORS en todas las rutas
app.use(cors());  // Esto permite solicitudes desde cualquier origen

// Middleware para poder parsear datos JSON
app.use(express.json());

// Usamos las rutas de autenticación
app.use('/auth', authRoutes);

// Usamos las rutas de comida
app.use('/api', comidaRoutes);

// Ruta principal
app.get('/', (req, res) => {
  res.send('¡Bienvenido a la API de comidas y login con PostgreSQL!');
});

// El servidor escucha en el puerto 3000
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
