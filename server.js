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

// Middleware para habilitar CORS en todas las rutas
app.use(cors({
  origin: [
    'https://foodsaver0.netlify.app',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5500',
    'http://localhost:5500'
  ],
  methods: ['GET','POST','PUT','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.options('*', cors());

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

// El servidor escucha en el puerto configurado
app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});

// Manejo de errores (si algo sale mal)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Algo salió mal!');
});
