// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// Routers
const authRoutes = require('./auth');
const comidaRoutes = require('./comida');
const pedidosRoutes = require('./pedidos'); // <= asegúrate que este archivo exista

// CORS: Netlify + entornos locales
const allowedOrigins = [
  'https://foodsaver0.netlify.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5500',
  'http://localhost:5500'
];

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
  credentials: true
}));
app.options('*', cors());

app.use(express.json());

// Helper para evitar pasar URLs completas en paths
function mount(path, router) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    throw new Error(`Ruta inválida para app.use: "${path}" (debe empezar con "/")`);
  }
  app.use(path, router);
}

// Montaje de rutas (SIEMPRE paths relativos)
mount('/auth', authRoutes);     // -> /auth/*
mount('/api', comidaRoutes);    // -> /api/comidas...
mount('/api', pedidosRoutes);   // -> /api/pedidos...

// Healthcheck
app.get('/__health', (req, res) => res.json({ ok: true }));

// Root
app.get('/', (req, res) => {
  res.send('¡Bienvenido a la API de comidas y login con PostgreSQL!');
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error(err.stack || err);
  res.status(err.status || 500).send(err.message || 'Algo salió mal!');
});

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
