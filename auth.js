// auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('./db'); // Conexión a la base de datos (pg Pool)
const router = express.Router();

/**
 * Helpers simples de validación/sanitización
 */
const sanitizeUsername = (v) => (v || '').trim().toLowerCase();
const sanitizePassword = (v) => (v || '').trim();
const isValidUsername = (u) =>
  typeof u === 'string' &&
  u.length >= 3 &&
  u.length <= 50 &&
  /^[a-z0-9._-]+$/i.test(u); // letras, números, punto, guion y guion bajo
const isValidPassword = (p) =>
  typeof p === 'string' && p.length >= 6 && p.length <= 255;

/**
 * POST /auth/login
 */
router.post('/login', async (req, res) => {
  let { username, password } = req.body || {};

  username = sanitizeUsername(username);
  password = sanitizePassword(password);

  if (!username || !password) {
    return res
      .status(400)
      .json({ mensaje: 'Usuario y contraseña son requeridos' });
  }
  if (!isValidUsername(username) || !isValidPassword(password)) {
    return res
      .status(400)
      .json({ mensaje: 'Credenciales con formato inválido' });
  }

  try {
    // Buscar usuario (obtenemos el hash para comparar)
    const { rows } = await pool.query(
      'SELECT id, username, password FROM usuarios WHERE username = $1',
      [username]
    );

    if (rows.length === 0) {
      // Evitamos filtrar si el usuario existe o no
      return res.status(401).json({ mensaje: 'Usuario o contraseña inválidos' });
    }

    const usuario = rows[0];
    const ok = await bcrypt.compare(password, usuario.password);

    if (!ok) {
      return res.status(401).json({ mensaje: 'Usuario o contraseña inválidos' });
    }

    // Nunca devolver el hash
    return res.status(200).json({
      mensaje: 'Login exitoso',
      usuario: { id: usuario.id, username: usuario.username }
    });
  } catch (error) {
    console.error('Error en /auth/login:', error);
    return res.status(500).json({ mensaje: 'Error al realizar el login' });
  }
});

/**
 * POST /auth/register
 */
router.post('/register', async (req, res) => {
  let { username, password } = req.body || {};

  username = sanitizeUsername(username);
  password = sanitizePassword(password);

  if (!username || !password) {
    return res
      .status(400)
      .json({ mensaje: 'Usuario y contraseña son requeridos' });
  }
  if (!isValidUsername(username)) {
    return res.status(400).json({
      mensaje:
        'El nombre de usuario debe tener 3-50 caracteres y solo puede incluir letras, números, punto, guion y guion bajo'
    });
  }
  if (!isValidPassword(password)) {
    return res
      .status(400)
      .json({ mensaje: 'La contraseña debe tener al menos 6 caracteres' });
  }

  try {
    // Verificar existencia previa (extra por claridad, aunque la columna es UNIQUE)
    const exists = await pool.query(
      'SELECT 1 FROM usuarios WHERE username = $1',
      [username]
    );
    if (exists.rows.length > 0) {
      return res
        .status(400)
        .json({ mensaje: 'El nombre de usuario ya está registrado' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const insert = await pool.query(
      'INSERT INTO usuarios (username, password) VALUES ($1, $2) RETURNING id, username',
      [username, hashedPassword]
    );

    const user = insert.rows[0];
    return res.status(201).json({
      mensaje: 'Usuario registrado exitosamente',
      usuario: { id: user.id, username: user.username }
    });
  } catch (error) {
    // Manejar violación de UNIQUE (por si se nos adelantó otra transacción)
    if (error && error.code === '23505') {
      return res
        .status(400)
        .json({ mensaje: 'El nombre de usuario ya está registrado' });
    }
    console.error('Error en /auth/register:', error);
    return res.status(500).json({ mensaje: 'Error al registrar el usuario' });
  }
});

module.exports = router;
