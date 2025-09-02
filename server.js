const express = require('express');
const cors = require('cors'); // Importamos el paquete cors
const dotenv = require('dotenv'); // Importamos dotenv para usar variables de entorno
const app = express();

// Cargar las variables de entorno desde el archivo .env
dotenv.config();

// Configuramos el puerto para que se pueda usar en local y en producción
const port = process.env.PORT || 3000;

// Rutas
const authRoutes = require('./auth');
const comidaRoutes = require('./comida');
const pedidoRoutes = require('./pedido');
const categoriaRoutes = require('./categoria');
const pago = require('./pago'); 


// Middleware para habilitar CORS en todas las rutas
// Si quieres restringir el acceso a ciertos dominios, puedes hacerlo de la siguiente manera:
const corsOptions = {
  origin: [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'https://foodsaver0.netlify.app',
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));

// Parser JSON (después de CORS)
app.use(express.json());

// ====================== Rutas de tu API ======================
app.use('/auth', authRoutes);
app.use('/api', comidaRoutes);

// Usamos las rutas de pedido
app.use('/api', pedidoRoutes);

// Usamos las rutas de categoria
app.use('/api', categoriaRoutes);

// Ruta para realizar el pago
app.post('/realizar-pago', async (req, res) => {
  const { name, email, cardToken, productId, amount, currency } = req.body;

  try {
    // Crear un usuario (cliente) en Stripe
    const customerId = await pago.createUser(name, email);

    // Crear el método de pago
    const paymentMethodId = await pago.createPaymentMethod(cardToken);

    // Asociar el método de pago al cliente
    await pago.addPaymentMethodToUser(customerId, paymentMethodId);

    // Crear el pago
    const paymentIntent = await pago.createPayment(customerId, paymentMethodId, productId, amount, currency);

    res.status(200).json({
      mensaje: 'Pago realizado correctamente',
      paymentId: paymentIntent.id
    });
  } catch (error) {
    console.error('Error al realizar el pago:', error.message);
    res.status(500).json({ mensaje: 'Error al procesar el pago', error: error.message });
  }
});


// Ruta principal
app.get('/', (req, res) => {
  res.send('¡Enai, enai!');
});

// El servidor escucha en el puerto configurado
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});

// Manejo de errores (si algo sale mal)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Algo salió mal!');
});
