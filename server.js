// server.js
'use strict';
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const port = process.env.PORT || 3000;

// Inicializa conexión a Postgres y logs (ping inicial)
require('./db');

// ====== CORS ======
const allowlist = [
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'https://foodsaver0.netlify.app',
  // agrega aquí tu dominio público del backend en Render si lo necesitas en otros servicios
  // 'https://proyecto-comida-backend.onrender.com',
];

// Permite también subdominios de Netlify/Render de forma segura
const allowedRegexes = [
  /^https?:\/\/([a-z0-9-]+\.)*netlify\.app$/i,
  /^https?:\/\/([a-z0-9-]+\.)*onrender\.com$/i,
];

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // Postman/cURL
    if (allowlist.includes(origin) || allowedRegexes.some((rx) => rx.test(origin))) {
      return cb(null, true);
    }
    return cb(new Error(`CORS bloqueado para origen: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // preflight

// ====== Body parsers ======
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ====== Rutas ======
const authRoutes = require('./auth');
const comidaRoutes = require('./comida');
const pedidoRoutes = require('./pedido');
const categoriaRoutes = require('./categoria');
const pago = require('./pago');

// Healthcheck (útil para Render)
app.get('/health', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

// Auth
app.use('/auth', authRoutes);

// API
app.use('/api', comidaRoutes);
app.use('/api', pedidoRoutes);
app.use('/api', categoriaRoutes);

// Pago (Stripe)
app.post('/realizar-pago', async (req, res) => {
  const { name, email, cardToken, productId, amount, currency } = req.body;
  try {
    const customerId = await pago.createUser(name, email);
    const paymentMethodId = await pago.createPaymentMethod(cardToken);
    await pago.addPaymentMethodToUser(customerId, paymentMethodId);
    const paymentIntent = await pago.createPayment(customerId, paymentMethodId, productId, amount, currency);
    res.status(200).json({ mensaje: 'Pago realizado correctamente', paymentId: paymentIntent.id });
  } catch (error) {
    console.error('Error al realizar el pago:', error.message);
    res.status(500).json({ mensaje: 'Error al procesar el pago', error: error.message });
  }
});

// Raíz
app.get('/', (_req, res) => {
  res.send('¡Enai, enai!');
});

// 404 si no coincide ninguna ruta
app.use((req, res, _next) => {
  res.status(404).json({ mensaje: 'Ruta no encontrada', path: req.originalUrl });
});

// Manejo de errores (debe ir al final SIEMPRE)
app.use((err, req, res, _next) => {
  const status = err.status || 500;
  console.error('🔥 Error:', {
    status,
    method: req.method,
    url: req.originalUrl,
    msg: err.message,
    stack: isProd ? undefined : err.stack,
  });
  res.status(status).json({ mensaje: 'Error interno del servidor', error: err.message });
});

// Escucha
app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${port} (env: ${process.env.NODE_ENV || 'development'})`);
});
