// pedidos.js - Corregido
const express = require('express');
const pool = require('./db');
const router = express.Router();

const ESTADOS_VALIDOS = ['pendiente', 'confirmado', 'en-preparacion', 'listo', 'entregado', 'cancelado'];

const toInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

const norm = (v) => (typeof v === 'string' ? v.trim() : '');

/* ============================================
 * GET /api/pedidos - Listar todos los pedidos
 * ============================================ */
router.get('/pedidos', async (req, res) => {
  try {
    const estado = norm(req.query.estado);
    const limit = toInt(req.query.limit) || 100;
    const offset = toInt(req.query.offset) || 0;

    const where = [];
    const params = [];

    if (estado && ESTADOS_VALIDOS.includes(estado)) {
      params.push(estado);
      where.push(`estado = $${params.length}`);
    }

    let sql = 'SELECT * FROM vista_pedidos_completos';
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    
    params.push(limit, offset);
    sql += ` ORDER BY fecha_pedido DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error('GET /pedidos error:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener los pedidos', 
      error: error.message 
    });
  }
});

/* ============================================
 * GET /api/pedidos/:id - Obtener un pedido
 * ============================================ */
router.get('/pedidos/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) {
    return res.status(400).json({ mensaje: 'ID inválido' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT * FROM vista_pedidos_completos WHERE id = $1',
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('GET /pedidos/:id error:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener el pedido', 
      error: error.message 
    });
  }
});

/* ============================================
 * POST /api/pedidos - Crear nuevo pedido
 * ============================================ */
router.post('/pedidos', async (req, res) => {
  const { 
    comida_id, 
    nombre_cliente, 
    email_cliente, 
    telefono_cliente, 
    direccion, 
    cantidad, 
    notas 
  } = req.body;

  // Validación de campos requeridos
  if (!comida_id || !nombre_cliente || !email_cliente || !cantidad) {
    return res.status(400).json({ 
      mensaje: 'Los campos comida_id, nombre_cliente, email_cliente y cantidad son requeridos' 
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

    // Verificar que la comida existe y obtener su precio
    const comidaResult = await client.query(
      'SELECT id, precio FROM comidas WHERE id = $1',
      [comida_id]
    );

    if (comidaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Comida no encontrada' });
    }

    const precioUnitario = parseFloat(comidaResult.rows[0].precio);
    const precioTotal = precioUnitario * parseInt(cantidad);

    // Crear el pedido
    const result = await client.query(`
      INSERT INTO pedido (
        comida_id, 
        nombre_cliente, 
        email_cliente, 
        telefono_cliente, 
        direccion, 
        cantidad, 
        precio_total, 
        notas
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING id
    `, [
      comida_id, 
      nombre_cliente, 
      email_cliente, 
      telefono_cliente || null, 
      direccion || null, 
      cantidad, 
      precioTotal, 
      notas || null
    ]);

    await client.query('COMMIT');

    const pedidoId = result.rows[0].id;

    // Obtener el pedido completo con la vista
    const pedidoCompleto = await pool.query(
      'SELECT * FROM vista_pedidos_completos WHERE id = $1',
      [pedidoId]
    );

    res.status(201).json(pedidoCompleto.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('POST /pedidos error:', error);
    res.status(500).json({ 
      mensaje: 'Error al crear el pedido', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

/* ============================================
 * PUT /api/pedidos/:id - Actualizar pedido completo
 * ============================================ */
router.put('/pedidos/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) {
    return res.status(400).json({ mensaje: 'ID inválido' });
  }

  const { 
    nombre_cliente, 
    email_cliente, 
    telefono_cliente, 
    direccion, 
    cantidad, 
    estado, 
    notas 
  } = req.body;

  // Validación
  if (!nombre_cliente || !email_cliente || !cantidad) {
    return res.status(400).json({ 
      mensaje: 'Los campos nombre_cliente, email_cliente y cantidad son requeridos' 
    });
  }

  if (estado && !ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ 
      mensaje: `Estado no válido. Permitidos: ${ESTADOS_VALIDOS.join(', ')}` 
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Obtener el pedido actual
    const pedidoActual = await client.query(
      'SELECT * FROM pedido WHERE id = $1', 
      [id]
    );
    
    if (pedidoActual.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    const pedido = pedidoActual.rows[0];

    // Si cambió la cantidad, recalcular el precio total
    let precioTotal = pedido.precio_total;
    if (parseInt(cantidad) !== parseInt(pedido.cantidad)) {
      const comidaResult = await client.query(
        'SELECT precio FROM comidas WHERE id = $1', 
        [pedido.comida_id]
      );
      const precioUnitario = parseFloat(comidaResult.rows[0].precio);
      precioTotal = precioUnitario * parseInt(cantidad);
    }

    // Actualizar el pedido
    await client.query(`
      UPDATE pedido 
      SET nombre_cliente = $1, 
          email_cliente = $2, 
          telefono_cliente = $3, 
          direccion = $4, 
          cantidad = $5, 
          precio_total = $6, 
          estado = $7, 
          notas = $8,
          fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = $9
    `, [
      nombre_cliente, 
      email_cliente, 
      telefono_cliente || null, 
      direccion || null, 
      cantidad, 
      precioTotal, 
      estado || pedido.estado, 
      notas || null, 
      id
    ]);

    await client.query('COMMIT');

    // Obtener pedido actualizado
    const pedidoCompleto = await pool.query(
      'SELECT * FROM vista_pedidos_completos WHERE id = $1',
      [id]
    );

    res.json(pedidoCompleto.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('PUT /pedidos/:id error:', error);
    res.status(500).json({ 
      mensaje: 'Error al actualizar el pedido', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

/* ============================================
 * PATCH /api/pedidos/:id/estado - Solo cambiar estado
 * ============================================ */
router.patch('/pedidos/:id/estado', async (req, res) => {
  const id = toInt(req.params.id);
  const estado = norm(req.body?.estado);

  if (id === null) {
    return res.status(400).json({ mensaje: 'ID inválido' });
  }

  if (!ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ 
      mensaje: `Estado no válido. Permitidos: ${ESTADOS_VALIDOS.join(', ')}` 
    });
  }

  try {
    const result = await pool.query(`
      UPDATE pedido 
      SET estado = $1, fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = $2 
      RETURNING id
    `, [estado, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    // Obtener el pedido completo actualizado
    const pedidoCompleto = await pool.query(
      'SELECT * FROM vista_pedidos_completos WHERE id = $1',
      [id]
    );

    res.json(pedidoCompleto.rows[0]);
  } catch (error) {
    console.error('PATCH /pedidos/:id/estado error:', error);
    res.status(500).json({ 
      mensaje: 'Error al actualizar el estado del pedido', 
      error: error.message 
    });
  }
});

/* ============================================
 * DELETE /api/pedidos/:id - Eliminar pedido
 * ============================================ */
router.delete('/pedidos/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) {
    return res.status(400).json({ mensaje: 'ID inválido' });
  }

  try {
    const result = await pool.query(
      'DELETE FROM pedido WHERE id = $1 RETURNING id', 
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('DELETE /pedidos/:id error:', error);
    res.status(500).json({ 
      mensaje: 'Error al eliminar el pedido', 
      error: error.message 
    });
  }
});

/* ============================================
 * GET /api/pedidos/estadisticas/resumen
 * ============================================ */
router.get('/pedidos/estadisticas/resumen', async (req, res) => {
  try {
    const porEstado = await pool.query(`
      SELECT 
        estado,
        COUNT(*) as cantidad,
        SUM(precio_total) as total_ventas
      FROM pedido 
      GROUP BY estado
      ORDER BY cantidad DESC
    `);

    const totalPedidos = await pool.query('SELECT COUNT(*) as total FROM pedido');
    
    const ventasHoy = await pool.query(`
      SELECT 
        COUNT(*) as pedidos_hoy,
        COALESCE(SUM(precio_total), 0) as ventas_hoy
      FROM pedido 
      WHERE DATE(fecha_pedido) = CURRENT_DATE
    `);

    res.json({
      por_estado: porEstado.rows,
      total_pedidos: parseInt(totalPedidos.rows[0].total),
      estadisticas_hoy: ventasHoy.rows[0]
    });
  } catch (error) {
    console.error('GET /estadisticas error:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener estadísticas', 
      error: error.message 
    });
  }
});

module.exports = router;