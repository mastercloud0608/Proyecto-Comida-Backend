// auth.js - Sistema de autenticación con roles
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const router = express.Router();

/**
 * Helpers de validación
 */
const sanitizeUsername = (v) => (v || '').trim().toLowerCase();
const sanitizeEmail = (v) => (v || '').trim().toLowerCase();
const sanitizePassword = (v) => (v || '').trim();
const isValidUsername = (u) =>
  typeof u === 'string' &&
  u.length >= 3 &&
  u.length <= 50 &&
  /^[a-z0-9._-]+$/i.test(u);
const isValidEmail = (e) =>
  typeof e === 'string' &&
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
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
    return res.status(400).json({ mensaje: 'Usuario y contraseña son requeridos' });
  }
  if (!isValidUsername(username) || !isValidPassword(password)) {
    return res.status(400).json({ mensaje: 'Credenciales con formato inválido' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT id, username, password, rol, email, nombre_completo FROM usuarios WHERE username = $1',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ mensaje: 'Usuario o contraseña inválidos' });
    }

    const usuario = rows[0];
    const ok = await bcrypt.compare(password, usuario.password);

    if (!ok) {
      return res.status(401).json({ mensaje: 'Usuario o contraseña inválidos' });
    }

    // Registrar último login
    await pool.query(
      'UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1',
      [usuario.id]
    );

    return res.status(200).json({
      mensaje: 'Login exitoso',
      usuario: {
        id: usuario.id,
        username: usuario.username,
        email: usuario.email,
        nombre_completo: usuario.nombre_completo,
        rol: usuario.rol
      }
    });
  } catch (error) {
    console.error('❌ Error en /auth/login:', error);
    return res.status(500).json({ mensaje: 'Error al realizar el login' });
  }
});

/**
 * POST /auth/register
 */
router.post('/register', async (req, res) => {
  let { username, password, email, nombre_completo, rol } = req.body || {};

  username = sanitizeUsername(username);
  password = sanitizePassword(password);
  email = sanitizeEmail(email);
  nombre_completo = (nombre_completo || '').trim();
  rol = (rol || 'usuario').toLowerCase();

  // Validaciones
  if (!username || !password || !email || !nombre_completo) {
    return res.status(400).json({
      mensaje: 'Usuario, contraseña, email y nombre completo son requeridos'
    });
  }

  if (!isValidUsername(username)) {
    return res.status(400).json({
      mensaje: 'El nombre de usuario debe tener 3-50 caracteres alfanuméricos'
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({
      mensaje: 'El email no tiene un formato válido'
    });
  }

  if (!isValidPassword(password)) {
    return res.status(400).json({
      mensaje: 'La contraseña debe tener al menos 6 caracteres'
    });
  }

  if (!['usuario', 'vendedor'].includes(rol)) {
    return res.status(400).json({
      mensaje: 'Rol inválido. Debe ser "usuario" o "vendedor"'
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar username duplicado
    const usernameExists = await client.query(
      'SELECT 1 FROM usuarios WHERE username = $1',
      [username]
    );
    if (usernameExists.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        mensaje: 'El nombre de usuario ya está registrado'
      });
    }

    // Verificar email duplicado
    const emailExists = await client.query(
      'SELECT 1 FROM usuarios WHERE email = $1',
      [email]
    );
    if (emailExists.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        mensaje: 'El email ya está registrado'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const insert = await client.query(
      `INSERT INTO usuarios (username, password, email, nombre_completo, rol) 
       VALUES ($1, $2, $3, $4, $5) 
       RETURNING id, username, email, nombre_completo, rol`,
      [username, hashedPassword, email, nombre_completo, rol]
    );

    await client.query('COMMIT');

    const user = insert.rows[0];
    console.log(`✅ Usuario registrado: ${user.username} (${user.rol})`);

    return res.status(201).json({
      mensaje: 'Usuario registrado exitosamente',
      usuario: {
        id: user.id,
        username: user.username,
        email: user.email,
        nombre_completo: user.nombre_completo,
        rol: user.rol
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    
    if (error && error.code === '23505') {
      return res.status(400).json({
        mensaje: 'El usuario o email ya está registrado'
      });
    }
    
    console.error('❌ Error en /auth/register:', error);
    return res.status(500).json({ mensaje: 'Error al registrar el usuario' });
  } finally {
    client.release();
  }
});

/**
 * GET /auth/profile
 * Obtener información del usuario autenticado
 */
router.get('/profile/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ mensaje: 'ID de usuario inválido' });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, username, email, nombre_completo, rol, fecha_registro, ultimo_login
       FROM usuarios WHERE id = $1`,
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('❌ Error en /auth/profile:', error);
    res.status(500).json({ mensaje: 'Error al obtener perfil' });
  }
});

/**
 * PUT /auth/profile/:userId
 * Actualizar información del perfil
 */
router.put('/profile/:userId', async (req, res) => {
  const userId = parseInt(req.params.userId);
  let { nombre_completo, email } = req.body || {};

  if (!userId || isNaN(userId)) {
    return res.status(400).json({ mensaje: 'ID de usuario inválido' });
  }

  nombre_completo = (nombre_completo || '').trim();
  email = sanitizeEmail(email);

  if (!nombre_completo || !email) {
    return res.status(400).json({
      mensaje: 'Nombre completo y email son requeridos'
    });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({
      mensaje: 'El email no tiene un formato válido'
    });
  }

  try {
    const result = await pool.query(
      `UPDATE usuarios 
       SET nombre_completo = $1, email = $2
       WHERE id = $3
       RETURNING id, username, email, nombre_completo, rol`,
      [nombre_completo, email, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
    }

    console.log(`✅ Perfil actualizado: Usuario ${userId}`);
    res.json({
      mensaje: 'Perfil actualizado exitosamente',
      usuario: result.rows[0]
    });
  } catch (error) {
    if (error && error.code === '23505') {
      return res.status(400).json({
        mensaje: 'El email ya está registrado por otro usuario'
      });
    }
    console.error('❌ Error en /auth/profile PUT:', error);
    res.status(500).json({ mensaje: 'Error al actualizar perfil' });
  }
});

module.exports = router;