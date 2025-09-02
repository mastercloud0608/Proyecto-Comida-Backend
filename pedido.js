// pedidos.js
const express = require('express');
const pool = require('./db'); // Conexión a PostgreSQL (pg Pool)
const router = express.Router();

/**
 * Schema que usas (resumen):
 *  - usuarios(id, username, password)
 *  - comidas(id, nombre, categoria, precio)
 *  - pedidos(id, usuario_id, estado, fecha)
 *  - pedido_comida(id, pedido_id, comida_id, cantidad, precio)  <-- precio = unitario al momento del pedido
 */

const ESTADOS_VALIDOS = ['pendiente', 'confirmado', 'en-preparacion', 'listo', 'entregado', 'cancelado'];

const toInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};
const toPosInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const norm = (v) => (typeof v === 'string' ? v.trim() : '');

/* -------------------------------------------
 * Utilidad para armar pedidos con items
 * -----------------------------------------*/
async function hydratePedidos(rows) {
  if (!rows.length) return [];

  const ids = rows.map(r => r.id);
  const { rows: items } = await pool.query(
    `
    SELECT pc.id,
           pc.pedido_id,
           pc.comida_id,
           pc.cantidad,
           pc.precio,
           c.nombre AS nombre_comida,
           c.categoria
    FROM pedido_comida pc
    JOIN comidas c ON c.id = pc.comida_id
    WHERE pc.pedido_id = ANY($1::int[])
    ORDER BY pc.id ASC
    `,
    [ids]
  );

  const byPedido = new Map();
  for (const it of items) {
    const arr = byPedido.get(it.pedido_id) || [];
    arr.push({
      id: it.id,
      comida_id: it.comida_id,
      nombre_comida: it.nombre_comida,
      categoria: it.categoria,
      cantidad: Number(it.cantidad),
      precio_unitario: Number(it.precio),
      subtotal: Number(it.precio) * Number(it.cantidad)
    });
    byPedido.set(it.pedido_id, arr);
  }

  return rows.map(r => {
    const its = byPedido.get(r.id) || [];
    const total = its.reduce((acc, x) => acc + x.subtotal, 0);
    return {
      id: r.id,
      usuario_id: r.usuario_id,
      username: r.username || null,
      estado: r.estado,
      fecha: r.fecha,
      items: its,
      total
    };
  });
}

/* -------------------------------------------
 * GET /api/pedidos
 * Filtros opcionales:
 *   - estado=pendiente
 *   - usuario_id=1
 *   - cliente=juan (coincide con username ILIKE)
 *   - limit, offset (paginación)
 * -----------------------------------------*/
router.get('/pedidos', async (req, res) => {
  try {
    const estado = norm(req.query.estado);
    const usuarioId = toInt(req.query.usuario_id);
    const cliente = norm(req.query.cliente); // compat: buscar por username

    const limit = toPosInt(req.query.limit) ?? 100;
    const offset = toInt(req.query.offset) ?? 0;

    const where = [];
    const params = [];

    if (estado) {
      where.push(`p.estado = $${params.length + 1}`);
      params.push(estado);
    }
    if (usuarioId !== null) {
      where.push(`p.usuario_id = $${params.length + 1}`);
      params.push(usuarioId);
    }
    if (cliente) {
      where.push(`u.username ILIKE $${params.length + 1}`);
      params.push(`%${cliente}%`);
    }

    let sql = `
      SELECT p.id, p.usuario_id, p.estado, p.fecha, u.username
      FROM pedidos p
      LEFT JOIN usuarios u ON u.id = p.usuario_id
    `;
    if (where.length) sql += ` WHERE ${where.join(' AND ')} `;
    sql += ` ORDER BY p.fecha DESC, p.id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(sql, params);
    const pedidos = await hydratePedidos(rows);
    res.json(pedidos);
  } catch (error) {
    console.error('GET /pedidos error:', error);
    res.status(500).json({ mensaje: 'Error al obtener los pedidos', error: error.message });
  }
});

/* -------------------------------------------
 * GET /api/pedidos/:id
 * -----------------------------------------*/
router.get('/pedidos/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return res.status(400).json({ mensaje: 'ID inválido' });

  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.usuario_id, p.estado, p.fecha, u.username
       FROM pedidos p
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       WHERE p.id = $1`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ mensaje: 'Pedido no encontrado' });

    const [pedido] = await hydratePedidos(rows);
    res.json(pedido);
  } catch (error) {
    console.error('GET /pedidos/:id error:', error);
    res.status(500).json({ mensaje: 'Error al obtener el pedido', error: error.message });
  }
});

/* -------------------------------------------
 * POST /api/pedidos
 * Admite dos formatos:
 *  A) Un solo item:
 *     { usuario_id, comida_id, cantidad }
 *  B) Varios items:
 *     { usuario_id, items: [{ comida_id, cantidad }, ...] }
 * El precio unitario se toma de "comidas.precio" en el momento del pedido.
 * -----------------------------------------*/
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

  if (!items.length) {
    return res.status(400).json({ mensaje: 'Debe especificar al menos un item con comida_id y cantidad > 0' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verificar usuario
    const u = await client.query('SELECT id FROM usuarios WHERE id = $1', [usuario_id]);
    if (!u.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Usuario no encontrado' });
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
      RETURNING *
    `, [
      comida_id, 
      nombre_cliente, 
      email_cliente, 
      telefono_cliente, 
      direccion, 
      cantidad, 
      precioTotal, 
      notas
    ]);

    await client.query('COMMIT');

    // Devolver pedido hidratado
    const { rows } = await pool.query(
      `SELECT p.id, p.usuario_id, p.estado, p.fecha, u.username
       FROM pedidos p
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       WHERE p.id = $1`,
      [pedido.id]
    );
    const [pedidoOut] = await hydratePedidos(rows);
    res.status(201).json(pedidoOut);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('POST /pedidos error:', error);
    res.status(500).json({ mensaje: 'Error al crear el pedido', error: error.message });
  } finally {
    client.release();
  }
});

/* -------------------------------------------
 * PATCH /api/pedidos/:id/estado
 * -----------------------------------------*/
router.patch('/pedidos/:id/estado', async (req, res) => {
  const id = toInt(req.params.id);
  const estado = norm(req.body?.estado);

  if (id === null) return res.status(400).json({ mensaje: 'ID inválido' });
  if (!ESTADOS_VALIDOS.includes(estado)) {
    return res.status(400).json({ mensaje: `Estado no válido. Permitidos: ${ESTADOS_VALIDOS.join(', ')}` });
  }

  try {
    const { rowCount } = await pool.query(
      'UPDATE pedidos SET estado = $1 WHERE id = $2',
      [estado, id]
    );
    if (!rowCount) return res.status(404).json({ mensaje: 'Pedido no encontrado' });

    const { rows } = await pool.query(
      `SELECT p.id, p.usuario_id, p.estado, p.fecha, u.username
       FROM pedidos p
       LEFT JOIN usuarios u ON u.id = p.usuario_id
       WHERE p.id = $1`,
      [id]
    );
    const [pedido] = await hydratePedidos(rows);
    res.json(pedido);
  } catch (error) {
    console.error('PATCH /pedidos/:id/estado error:', error);
    res.status(500).json({ mensaje: 'Error al actualizar el estado del pedido', error: error.message });
  }
});

/* -------------------------------------------
 * DELETE /api/pedidos/:id
 * -----------------------------------------*/
router.delete('/pedidos/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (id === null) return res.status(400).json({ mensaje: 'ID inválido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Obtener el pedido actual
    const pedidoActual = await client.query('SELECT * FROM pedido WHERE id = $1', [id]);
    
    if (pedidoActual.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    const pedido = pedidoActual.rows[0];

    // Si cambió la cantidad, recalcular el precio total
    let precioTotal = pedido.precio_total;
    if (parseInt(cantidad) !== parseInt(pedido.cantidad)) {
      const comidaResult = await client.query('SELECT precio FROM comida WHERE id = $1', [pedido.comida_id]);
      const precioUnitario = parseFloat(comidaResult.rows[0].precio);
      precioTotal = precioUnitario * parseInt(cantidad);
    }

    // Actualizar el pedido
    const result = await client.query(`
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
      RETURNING *
    `, [
      nombre_cliente, 
      email_cliente, 
      telefono_cliente, 
      direccion, 
      cantidad, 
      precioTotal, 
      estado || pedido.estado, 
      notas, 
      id
    ]);

    await client.query('COMMIT');
    res.status(204).send();
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('DELETE /pedidos/:id error:', error);
    res.status(500).json({ mensaje: 'Error al eliminar el pedido', error: error.message });
  } finally {
    client.release();
  }
});

// Ruta PATCH para actualizar solo el estado de un pedido
router.patch('/pedidos/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  // Validar estado
  const estadosValidos = ['pendiente', 'confirmado', 'en-preparacion', 'listo', 'entregado', 'cancelado'];
  if (!estado || !estadosValidos.includes(estado)) {
    return res.status(400).json({ 
      mensaje: 'Estado requerido. Estados permitidos: ' + estadosValidos.join(', ')
    });
  }

  try {
    const result = await pool.query(`
      UPDATE pedido 
      SET estado = $1, fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = $2 
      RETURNING *
    `, [estado, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    // Obtener el pedido completo actualizado
    const pedidoCompleto = await pool.query('SELECT * FROM vista_pedidos_completos WHERE id = $1', [id]);

    res.json(pedidoCompleto.rows[0]);
  } catch (error) {
    console.error('Error al actualizar estado del pedido:', error);
    res.status(500).json({ 
      mensaje: 'Error al actualizar el estado del pedido', 
      error: error.message 
    });
  }
});

// Ruta DELETE para eliminar un pedido
router.delete('/pedidos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM pedido WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    res.status(204).send(); // No hay contenido, pero la operación fue exitosa
  } catch (error) {
    console.error('Error al eliminar pedido:', error);
    res.status(500).json({ 
      mensaje: 'Error al eliminar el pedido', 
      error: error.message 
    });
  }
});

// Ruta GET para obtener estadísticas de pedidos
router.get('/pedidos/estadisticas/resumen', async (req, res) => {
  try {
    const result = await pool.query(`
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
      por_estado: result.rows,
      total_pedidos: parseInt(totalPedidos.rows[0].total),
      estadisticas_hoy: ventasHoy.rows[0]
    });
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener estadísticas', 
      error: error.message 
    });
  }
});

module.exports = router;
