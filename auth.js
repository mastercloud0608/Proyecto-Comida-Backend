const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('./db'); // Conexión a la base de datos
const router = express.Router();

// Ruta POST para login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  // Validación básica para verificar que los campos no estén vacíos
  if (!username || !password) {
    return res.status(400).json({ mensaje: 'Usuario y contraseña son requeridos' });
  }

  try {
    // Buscar el usuario por username en la base de datos
    const result = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);

    if (result.rows.length === 0) {
      return res.status(400).json({ mensaje: 'Usuario no encontrado' });
    }

    const usuario = result.rows[0];

    // Comparar la contraseña
    const match = await bcrypt.compare(password, usuario.password);

    if (match) {
      return res.status(200).json({ mensaje: 'Login exitoso', usuario });
    } else {
      return res.status(400).json({ mensaje: 'Contraseña incorrecta' });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al realizar el login' });
  }
});

// Ruta POST para registrar un nuevo usuario
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  // Validación básica para verificar que los campos no estén vacíos
  if (!username || !password) {
    return res.status(400).json({ mensaje: 'Usuario y contraseña son requeridos' });
  }

  try {
    // Verificar si el usuario ya existe
    const result = await pool.query('SELECT * FROM usuarios WHERE username = $1', [username]);

    if (result.rows.length > 0) {
      return res.status(400).json({ mensaje: 'El nombre de usuario ya está registrado' });
    }

    // Cifrar la contraseña antes de almacenarla
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insertar el nuevo usuario en la base de datos
    const newUser = await pool.query(
      'INSERT INTO usuarios (username, password) VALUES ($1, $2) RETURNING *',
      [username, hashedPassword]
    );

    const user = newUser.rows[0];

    return res.status(201).json({
      mensaje: 'Usuario registrado exitosamente',
      usuario: {
        id: user.id,
        username: user.username,
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al registrar el usuario' });
  }
});

module.exports = router;
