// server.js
'use strict';

const express = require('express');
const cors = require('cors');
require('dotenv-flow').config(); // lee .env* según NODE_ENV

// Verificar variables de entorno críticas al iniciar
console.log('🔧 Verificando configuración...');
console.log('   NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('   PORT:', process.env.PORT || 3000);
console.log('   STRIPE_PUBLISHABLE_KEY:', process.env.STRIPE_PUBLISHABLE_KEY ? '✅ Configurada' : '❌ NO configurada');
console.log('   STRIPE_SECRET_KEY:', process.env.STRIPE_SECRET_KEY ? '✅ Configurada' : '❌ NO configurada');

if (!process.env.STRIPE_PUBLISHABLE_KEY || !process.env.STRIPE_SECRET_KEY) {
  console.error('⚠️ ADVERTENCIA: Las claves de Stripe no están configuradas correctamente');
  console.error('   Asegúrate de tener STRIPE_PUBLISHABLE_KEY y STRIPE_SECRET_KEY en tu archivo .env');
}

// Inicializa conexión a Postgres (hace ping y loguea)
require('./db');

const { runMigrations } = require('./migrate'); // para /admin/run-migrations

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const port = process.env.PORT || 3000;

/* ================= CORS ================= */
const allowlist = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'https://foodsaver0.netlify.app',
];

const allowedRegexes = [
  /^https?:\/\/([a-z0-9-]+\.)*netlify\.app$/i,
  /^https?:\/\/([a-z0-9-]+\.)*onrender\.com$/i,
];

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // Postman/cURL/local
    if (allowlist.includes(origin) || allowedRegexes.some(rx => rx.test(origin))) {
      console.log('✅ CORS permitido para:', origin);
      return cb(null, true);
    }
    console.log('❌ CORS bloqueado para:', origin);
    return cb(new Error(`CORS bloqueado para origen: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-session-id'],
  credentials: false,
};

app.use(cors(corsOptions));

/* ============== Body parsers ============== */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/* ============== Logging Middleware (desarrollo) ============== */
if (!isProd) {
  app.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.path}`);
    if (req.headers['x-session-id']) {
      console.log('   Session ID:', req.headers['x-session-id']);
    }
    next();
  });
}

/* ============== Rutas importadas ============== */
const authRoutes = require('./auth');
const comidaRoutes = require('./comida');
const pedidoRoutes = require('./pedido');
const categoriaRoutes = require('./categoria');
const carritoRoutes = require('./carrito');   
const checkoutRoutes = require('./checkout'); 

/* ============== Healthcheck ============== */
app.get('/health', (_req, res) => {
  res.json({ 
    ok: true, 
    env: process.env.NODE_ENV || 'development',
    stripe_configured: !!(process.env.STRIPE_PUBLISHABLE_KEY && process.env.STRIPE_SECRET_KEY)
  });
});

/* ============== Auth ============== */
app.use('/auth', authRoutes);

/* ============== API ============== */
app.use('/api', comidaRoutes);
app.use('/api', pedidoRoutes);
app.use('/api', categoriaRoutes);
app.use('/api', carritoRoutes); 
app.use('/api', checkoutRoutes);   

/* ============== Admin: correr migraciones (temporal) ============== */
app.post('/admin/run-migrations', async (req, res) => {
  try {
    const secret = req.header('X-Init-Secret');
    if (!process.env.INIT_DB_SECRET || secret !== process.env.INIT_DB_SECRET) {
      return res.status(401).json({ mensaje: 'No autorizado' });
    }
    const result = await runMigrations();
    res.json({ ok: true, result });
  } catch (e) {
    console.error('Migraciones error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ============== Raíz ============== */
app.get('/', (_req, res) => {
  res.send('¡Servidor de Comida Sobrante funcionando! 🍽️');
});

/* ============== 404 ============== */
app.use((req, res, _next) => {
  console.log('❌ 404 - Ruta no encontrada:', req.originalUrl);
  res.status(404).json({ mensaje: 'Ruta no encontrada', path: req.originalUrl });
});

/* ============== Errores ============== */
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  console.error('🔥 Error:', {
    status,
    method: req.method,
    url: req.originalUrl,
    msg: err.message,
    stack: isProd ? undefined : err.stack,
  });
  res.status(status).json({ 
    mensaje: 'Error interno del servidor', 
    error: err.message,
    details: isProd ? undefined : err.stack
  });
});

/* ============== Escucha ============== */
app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${port}`);
  console.log(`   Entorno: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   Base de datos: ${process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL ? '✅ Configurada' : '❌ NO configurada'}`);
  console.log(`   Stripe: ${process.env.STRIPE_SECRET_KEY ? '✅ Configurado' : '❌ NO configurado'}`);
});