// auth.js - Sistema de autenticación con DEBUG
const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const router = express.Router();

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

router.post('/login', async (req, res) => {
  console.log('\n🔐 ===== INTENTO DE LOGIN =====');
  console.log('📦 Body recibido:', req.body);
  
  let { username, password } = req.body || {};
  
  console.log('📝 Username original:', username);
  console.log('🔑 Password recibida (length):', password?.length);

  username = sanitizeUsername(username);
  password = sanitizePassword(password);

  console.log('📝 Username sanitizado:', username);
  console.log('🔑 Password sanitizada (length):', password?.length);

  if (!username || !password) {
    console.log('❌ Faltan campos');
    return res.status(400).json({ mensaje: 'Usuario y contraseña son requeridos' });
  }
  
  if (!isValidUsername(username) || !isValidPassword(password)) {
    console.log('❌ Formato inválido');
    console.log('   Username válido?', isValidUsername(username));
    console.log('   Password válido?', isValidPassword(password));
    return res.status(400).json({ mensaje: 'Credenciales con formato inválido' });
  }

  try {
    console.log('🔍 Buscando usuario en BD:', username);
    
    const { rows } = await pool.query(
      'SELECT id, username, password, rol, email, nombre_completo FROM usuarios WHERE username = $1',
      [username]
    );

    console.log('📊 Resultados encontrados:', rows.length);

    if (rows.length === 0) {
      console.log('❌ Usuario no encontrado en BD');
      return res.status(401).json({ mensaje: 'Usuario o contraseña inválidos' });
    }

    const usuario = rows[0];
    console.log('✅ Usuario encontrado:');
    console.log('   ID:', usuario.id);
    console.log('   Username:', usuario.username);
    console.log('   Email:', usuario.email);
    console.log('   Rol:', usuario.rol);
    console.log('   Password hash length:', usuario.password?.length);
    console.log('   Password hash (primeros 20):', usuario.password?.substring(0, 20));

    console.log('🔐 Comparando contraseñas...');
    console.log('   Password ingresada:', password);
    console.log('   Hash en BD:', usuario.password?.substring(0, 30) + '...');
    
    const ok = await bcrypt.compare(password, usuario.password);
    
    console.log('🔐 Resultado de bcrypt.compare:', ok);

    if (!ok) {
      console.log('❌ Contraseña incorrecta');
      
      // TEST: Intentar con el hash directo
      console.log('🧪 TEST: Verificando hash de "123456"...');
      const testHash = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';
      const testCompare = await bcrypt.compare('123456', testHash);
      console.log('   bcrypt.compare("123456", testHash):', testCompare);
      
      return res.status(401).json({ mensaje: 'Usuario o contraseña inválidos' });
    }

    console.log('✅ Login exitoso!');

    await pool.query(
      'UPDATE usuarios SET ultimo_login = NOW() WHERE id = $1',
      [usuario.id]
    );

    console.log('💾 Último login actualizado');
    console.log('📤 Enviando respuesta exitosa');

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
    console.error('❌ ERROR en /auth/login:', error);
    console.error('   Stack:', error.stack);
    return res.status(500).json({ mensaje: 'Error al realizar el login' });
  }
});

router.post('/register', async (req, res) => {
  let { username, password, email, nombre_completo, rol } = req.body || {};

  username = sanitizeUsername(username);
  password = sanitizePassword(password);
  email = sanitizeEmail(email);
  nombre_completo = (nombre_completo || '').trim();
  rol = (rol || 'usuario').toLowerCase();

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