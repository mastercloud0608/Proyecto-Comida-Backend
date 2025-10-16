// carrito.js - Router para gestión del carrito de compras
const express = require('express');
const pool = require('./db');
const { v4: uuidv4 } = require('uuid'); // Instalar: npm install uuid
const router = express.Router();

/* ============================================
 * UTILIDADES
 * ============================================ */
const toInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

const norm = (v) => (typeof v === 'string' ? v.trim() : '');

// Generar o recuperar session_id
const getOrCreateSessionId = (req) => {
  // El frontend debe enviar el session_id en headers o como cookie
  // Por simplicidad, lo tomamos del header 'x-session-id'
  let sessionId = req.headers['x-session-id'];
  
  if (!sessionId || sessionId === 'undefined') {
    sessionId = uuidv4();
  }
  
  return sessionId;
};

/* ============================================
 * GET /api/carrito
 * Obtener el carrito actual (o crear uno vacío)
 * ============================================ */
router.get('/carrito', async (req, res) => {
  try {
    const sessionId = getOrCreateSessionId(req);
    
    // Buscar carrito activo
    let { rows } = await pool.query(
      'SELECT * FROM carritos WHERE session_id = $1 AND estado = $2',
      [sessionId, 'activo']
    );
    
    let carrito;
    
    if (rows.length === 0) {
      // Crear carrito nuevo
      const result = await pool.query(
        `INSERT INTO carritos (session_id, fecha_expiracion)
         VALUES ($1, NOW() + INTERVAL '7 days')
         RETURNING *`,
        [sessionId]
      );
      carrito = result.rows[0];
    } else {
      carrito = rows[0];
    }
    
    // Obtener items del carrito con info de comidas
    const { rows: items } = await pool.query(
      `SELECT 
        ci.id,
        ci.comida_id,
        ci.cantidad,
        ci.precio_unitario,
        ci.notas,
        ci.fecha_agregado,
        c.nombre,
        c.categoria,
        c.imagen,
        (ci.cantidad * ci.precio_unitario) as subtotal
       FROM carrito_items ci
       JOIN comidas c ON c.id = ci.comida_id
       WHERE ci.carrito_id = $1
       ORDER BY ci.fecha_agregado DESC`,
      [carrito.id]
    );
    
    // Calcular totales
    const total = items.reduce((sum, item) => sum + parseFloat(item.subtotal), 0);
    const totalItems = items.reduce((sum, item) => sum + parseInt(item.cantidad), 0);
    
    res.json({
      carrito: {
        id: carrito.id,
        session_id: sessionId,
        email_cliente: carrito.email_cliente,
        nombre_cliente: carrito.nombre_cliente,
        telefono_cliente: carrito.telefono_cliente,
        direccion: carrito.direccion,
        estado: carrito.estado,
        fecha_creacion: carrito.fecha_creacion
      },
      items,
      resumen: {
        total_items: totalItems,
        subtotal: total,
        impuestos: 0, // Puedes calcular impuestos si lo necesitas
        total: total
      }
    });
  } catch (error) {
    console.error('GET /carrito error:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener el carrito', 
      error: error.message 
    });
  }
});

/* ============================================
 * POST /api/carrito/items
 * Agregar item al carrito
 * Body: { comida_id, cantidad, notas? }
 * ============================================ */
router.post('/carrito/items', async (req, res) => {
  const { comida_id, cantidad, notas } = req.body;
  
  if (!comida_id || !cantidad) {
    return res.status(400).json({ 
      mensaje: 'comida_id y cantidad son requeridos' 
    });
  }
  
  if (parseInt(cantidad) <= 0) {
    return res.status(400).json({ 
      mensaje: 'La cantidad debe ser mayor a 0' 
    });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const sessionId = getOrCreateSessionId(req);
    
    // Obtener o crear carrito
    let carritoResult = await client.query(
      'SELECT * FROM carritos WHERE session_id = $1 AND estado = $2',
      [sessionId, 'activo']
    );
    
    let carritoId;
    
    if (carritoResult.rows.length === 0) {
      const newCarrito = await client.query(
        `INSERT INTO carritos (session_id, fecha_expiracion)
         VALUES ($1, NOW() + INTERVAL '7 days')
         RETURNING id`,
        [sessionId]
      );
      carritoId = newCarrito.rows[0].id;
    } else {
      carritoId = carritoResult.rows[0].id;
    }
    
    // Verificar que la comida existe y obtener precio
    const comidaResult = await client.query(
      'SELECT id, nombre, precio FROM comidas WHERE id = $1',
      [comida_id]
    );
    
    if (comidaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Comida no encontrada' });
    }
    
    const comida = comidaResult.rows[0];
    const precioUnitario = parseFloat(comida.precio);
    
    // Verificar si el item ya existe en el carrito
    const itemExistente = await client.query(
      'SELECT * FROM carrito_items WHERE carrito_id = $1 AND comida_id = $2',
      [carritoId, comida_id]
    );
    
    let result;
    
    if (itemExistente.rows.length > 0) {
      // Actualizar cantidad
      const nuevaCantidad = parseInt(itemExistente.rows[0].cantidad) + parseInt(cantidad);
      result = await client.query(
        `UPDATE carrito_items 
         SET cantidad = $1, notas = COALESCE($2, notas)
         WHERE carrito_id = $3 AND comida_id = $4
         RETURNING *`,
        [nuevaCantidad, notas, carritoId, comida_id]
      );
    } else {
      // Insertar nuevo item
      result = await client.query(
        `INSERT INTO carrito_items (carrito_id, comida_id, cantidad, precio_unitario, notas)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [carritoId, comida_id, cantidad, precioUnitario, notas]
      );
    }
    
    // Actualizar timestamp del carrito
    await client.query(
      'UPDATE carritos SET fecha_actualizacion = NOW() WHERE id = $1',
      [carritoId]
    );
    
    await client.query('COMMIT');
    
    const item = result.rows[0];
    res.status(201).json({
      mensaje: 'Item agregado al carrito',
      item: {
        ...item,
        nombre_comida: comida.nombre,
        subtotal: parseFloat(item.precio_unitario) * parseInt(item.cantidad)
      },
      session_id: sessionId
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('POST /carrito/items error:', error);
    res.status(500).json({ 
      mensaje: 'Error al agregar item al carrito', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

/* ============================================
 * PUT /api/carrito/items/:itemId
 * Actualizar cantidad de un item
 * Body: { cantidad }
 * ============================================ */
router.put('/carrito/items/:itemId', async (req, res) => {
  const itemId = toInt(req.params.itemId);
  const { cantidad } = req.body;
  
  if (itemId === null) {
    return res.status(400).json({ mensaje: 'ID de item inválido' });
  }
  
  if (!cantidad || parseInt(cantidad) <= 0) {
    return res.status(400).json({ mensaje: 'Cantidad debe ser mayor a 0' });
  }
  
  try {
    const sessionId = getOrCreateSessionId(req);
    
    // Verificar que el item pertenece al carrito del usuario
    const result = await pool.query(
      `UPDATE carrito_items ci
       SET cantidad = $1
       FROM carritos c
       WHERE ci.id = $2 
         AND ci.carrito_id = c.id 
         AND c.session_id = $3 
         AND c.estado = 'activo'
       RETURNING ci.*`,
      [cantidad, itemId, sessionId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Item no encontrado en el carrito' });
    }
    
    const item = result.rows[0];
    res.json({
      mensaje: 'Cantidad actualizada',
      item: {
        ...item,
        subtotal: parseFloat(item.precio_unitario) * parseInt(item.cantidad)
      }
    });
  } catch (error) {
    console.error('PUT /carrito/items/:itemId error:', error);
    res.status(500).json({ 
      mensaje: 'Error al actualizar item', 
      error: error.message 
    });
  }
});

/* ============================================
 * DELETE /api/carrito/items/:itemId
 * Eliminar item del carrito
 * ============================================ */
router.delete('/carrito/items/:itemId', async (req, res) => {
  const itemId = toInt(req.params.itemId);
  
  if (itemId === null) {
    return res.status(400).json({ mensaje: 'ID de item inválido' });
  }
  
  try {
    const sessionId = getOrCreateSessionId(req);
    
    const result = await pool.query(
      `DELETE FROM carrito_items ci
       USING carritos c
       WHERE ci.id = $1 
         AND ci.carrito_id = c.id 
         AND c.session_id = $2 
         AND c.estado = 'activo'
       RETURNING ci.id`,
      [itemId, sessionId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Item no encontrado' });
    }
    
    res.status(204).send();
  } catch (error) {
    console.error('DELETE /carrito/items/:itemId error:', error);
    res.status(500).json({ 
      mensaje: 'Error al eliminar item', 
      error: error.message 
    });
  }
});

/* ============================================
 * DELETE /api/carrito
 * Vaciar carrito completo
 * ============================================ */
router.delete('/carrito', async (req, res) => {
  try {
    const sessionId = getOrCreateSessionId(req);
    
    const result = await pool.query(
      `DELETE FROM carrito_items ci
       USING carritos c
       WHERE ci.carrito_id = c.id 
         AND c.session_id = $1 
         AND c.estado = 'activo'`,
      [sessionId]
    );
    
    res.json({ 
      mensaje: 'Carrito vaciado', 
      items_eliminados: result.rowCount 
    });
  } catch (error) {
    console.error('DELETE /carrito error:', error);
    res.status(500).json({ 
      mensaje: 'Error al vaciar carrito', 
      error: error.message 
    });
  }
});

/* ============================================
 * PUT /api/carrito/info
 * Actualizar información del cliente en el carrito
 * Body: { nombre_cliente, email_cliente, telefono_cliente?, direccion? }
 * ============================================ */
router.put('/carrito/info', async (req, res) => {
  const { nombre_cliente, email_cliente, telefono_cliente, direccion } = req.body;
  
  if (!nombre_cliente || !email_cliente) {
    return res.status(400).json({ 
      mensaje: 'nombre_cliente y email_cliente son requeridos' 
    });
  }
  
  try {
    const sessionId = getOrCreateSessionId(req);
    
    const result = await pool.query(
      `UPDATE carritos 
       SET nombre_cliente = $1,
           email_cliente = $2,
           telefono_cliente = $3,
           direccion = $4,
           fecha_actualizacion = NOW()
       WHERE session_id = $5 AND estado = 'activo'
       RETURNING *`,
      [nombre_cliente, email_cliente, telefono_cliente, direccion, sessionId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Carrito no encontrado' });
    }
    
    res.json({ 
      mensaje: 'Información actualizada', 
      carrito: result.rows[0] 
    });
  } catch (error) {
    console.error('PUT /carrito/info error:', error);
    res.status(500).json({ 
      mensaje: 'Error al actualizar información', 
      error: error.message 
    });
  }
});

module.exports = router;