// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Routers
const authRoutes = require('./auth');
const comidaRoutes = require('./comida');

// Middleware para habilitar CORS en todas las rutas
// Si quieres restringir el acceso a ciertos dominios, puedes hacerlo de la siguiente manera:
const corsOptions = {
 origin: 'https://foodsaver0.netlify.app/',
 };
app.use(cors());  // Esto permite solicitudes desde cualquier origen (si quieres más control, pasa corsOptions aquí)

// Middleware para poder parsear datos JSON
app.use(express.json());

// Usamos las rutas de autenticación
app.use('/auth', authRoutes);

// Usamos las rutas de comida
app.use('/api', comidaRoutes);

// Healthcheck
app.get('/__health', (req, res) => res.json({ ok: true }));

// Root
app.get('/', (req, res) => {
  res.send('¡Enai, enai!');
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(err.status || 500).send(err.message || 'Algo salió mal!');
});

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
