// server.js
'use strict';

const express = require('express');
const cors = require('cors');
require('dotenv-flow').config(); // lee .env* según NODE_ENV

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
  // 'https://proyecto-comida-backend.onrender.com', // agrega si lo necesitas
];

const allowedRegexes = [
  /^https?:\/\/([a-z0-9-]+\.)*netlify\.app$/i,
  /^https?:\/\/([a-z0-9-]+\.)*onrender\.com$/i,
];

const corsOptions = {
  origin(origin, cb) {
    if (!origin) return cb(null, true); // Postman/cURL
    if (allowlist.includes(origin) || allowedRegexes.some(rx => rx.test(origin))) {
      return cb(null, true);
    }
    return cb(new Error(`CORS bloqueado para origen: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
};

app.use(cors(corsOptions)); // ✅ suficiente

/* ============== Body parsers ============== */
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

/* ============== Rutas importadas ============== */
const authRoutes = require('./auth');
const comidaRoutes = require('./comida');
const pedidoRoutes = require('./pedido');
const categoriaRoutes = require('./categoria');
const pago = require('./pago');

/* ============== Healthcheck ============== */
app.get('/health', (_req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

/* ============== Auth ============== */
app.use('/auth', authRoutes);

/* ============== API ============== */
app.use('/api', comidaRoutes);
app.use('/api', pedidoRoutes);
app.use('/api', categoriaRoutes);

/* ============== Admin: correr migraciones (temporal) ==============
   Añade en Render una var de entorno: INIT_DB_SECRET
   y llama: POST /admin/run-migrations con header X-Init-Secret: <valor>
*/
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

/* ============== Pago (Stripe) ============== */
app.post('/realizar-pago', async (req, res) => {
  const { name, email, cardToken, productId, amount, currency } = req.body;
  try {
    const customerId = await pago.createUser(name, email);
    const paymentMethodId = await pago.createPaymentMethod(cardToken);
    await pago.addPaymentMethodToUser(customerId, paymentMethodId);
    const paymentIntent = await pago.createPayment(
      customerId,
      paymentMethodId,
      productId,
      amount,
      currency
    );
    res.status(200).json({ mensaje: 'Pago realizado correctamente', paymentId: paymentIntent.id });
  } catch (error) {
    console.error('Error al realizar el pago:', error.message);
    res.status(500).json({ mensaje: 'Error al procesar el pago', error: error.message });
  }
});

/* ============== Raíz ============== */
app.get('/', (_req, res) => {
  res.send('¡Enai, enai!');
});

/* ============== 404 ============== */
app.use((req, res, _next) => {
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
  res.status(status).json({ mensaje: 'Error interno del servidor', error: err.message });
});

/* ============== Escucha ============== */
app.listen(port, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${port} (env: ${process.env.NODE_ENV || 'development'})`);
});
