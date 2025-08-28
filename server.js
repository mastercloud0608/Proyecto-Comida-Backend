// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// Puerto (Render/producción o local)
const port = process.env.PORT || 3000;

// Rutas
const authRoutes = require('./auth');
const comidaRoutes = require('./comida');

// CORS: permitir Netlify y entornos locales de desarrollo
const allowedOrigins = [
  'https://foodsaver0.netlify.app',
  'http://localhost:3000',
  'http://localhost:5173',     // Vite
  'http://127.0.0.1:5500',     // Live Server
  'http://localhost:5500'
];

app.use(cors({
  origin(origin, cb) {
    // Permite clientes sin origin (curl/Postman)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
}));
app.options('*', cors());

// Parseo JSON
app.use(express.json());

// Rutas de la API
app.use('/auth', authRoutes);   // -> /auth/*
app.use('/api', comidaRoutes);  // -> /api/comidas, etc.

// Healthcheck / raíz
app.get('/', (req, res) => {
  res.send('¡Bienvenido a la API de comidas y login con PostgreSQL!');
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).send(err.message || 'Algo salió mal!');
});

// Levantar servidor
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
