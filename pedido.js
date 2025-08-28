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
  const usuario_id = toInt(req.body?.usuario_id);
  const comida_id = toInt(req.body?.comida_id);
  const cantidad_single = toPosInt(req.body?.cantidad);
  const itemsBody = Array.isArray(req.body?.items) ? req.body.items : null;

  if (usuario_id === null) {
    return res.status(400).json({ mensaje: 'usuario_id es requerido' });
  }

  // Normalizamos a una lista de items
  let items = [];
  if (itemsBody && itemsBody.length) {
    items = itemsBody.map(i => ({
      comida_id: toInt(i.comida_id),
      cantidad: toPosInt(i.cantidad)
    })).filter(i => i.comida_id !== null && i.cantidad !== null);
  } else if (comida_id !== null && cantidad_single !== null) {
    items = [{ comida_id, cantidad: cantidad_single }];
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

    // Verificar comidas y obtener precios actuales
    const comidaIds = items.map(i => i.comida_id);
    const { rows: comidas } = await client.query(
      'SELECT id, precio FROM comidas WHERE id = ANY($1::int[])',
      [comidaIds]
    );
    const precioMap = new Map(comidas.map(c => [c.id, Number(c.precio)]));

    for (const it of items) {
      if (!precioMap.has(it.comida_id)) {
        await client.query('ROLLBACK');
        return res.status(404).json({ mensaje: `Comida no encontrada: id=${it.comida_id}` });
      }
    }

    // Crear pedido
    const { rows: pedidoRows } = await client.query(
      'INSERT INTO pedidos (usuario_id, estado) VALUES ($1, $2) RETURNING id, usuario_id, estado, fecha',
      [usuario_id, 'pendiente']
    );
    const pedido = pedidoRows[0];

    // Insertar items (precio unitario fijo al momento del pedido)
    for (const it of items) {
      await client.query(
        `INSERT INTO pedido_comida (pedido_id, comida_id, cantidad, precio)
         VALUES ($1, $2, $3, $4)`,
        [pedido.id, it.comida_id, it.cantidad, precioMap.get(it.comida_id)]
      );
    }

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

    const { rows: exists } = await client.query('SELECT id FROM pedidos WHERE id = $1', [id]);
    if (!exists.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    await client.query('DELETE FROM pedido_comida WHERE pedido_id = $1', [id]);
    await client.query('DELETE FROM pedidos WHERE id = $1', [id]);

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

/* -------------------------------------------
 * GET /api/pedidos/estadisticas/resumen
 * - Ventas = SUM(cantidad * precio_unitario)
 * -----------------------------------------*/
router.get('/pedidos/estadisticas/resumen', async (req, res) => {
  try {
    const { rows: porEstado } = await pool.query(
      `
      SELECT p.estado,
             COUNT(DISTINCT p.id) AS cantidad,
             COALESCE(SUM(pc.cantidad * pc.precio), 0) AS total_ventas
      FROM pedidos p
      LEFT JOIN pedido_comida pc ON pc.pedido_id = p.id
      GROUP BY p.estado
      ORDER BY cantidad DESC
      `
    );

    const { rows: totalPedidos } = await pool.query(
      'SELECT COUNT(*)::int AS total FROM pedidos'
    );

    const { rows: hoy } = await pool.query(
      `
      SELECT
        COUNT(DISTINCT p.id)::int AS pedidos_hoy,
        COALESCE(SUM(pc.cantidad * pc.precio), 0) AS ventas_hoy
      FROM pedidos p
      LEFT JOIN pedido_comida pc ON pc.pedido_id = p.id
      WHERE DATE(p.fecha) = CURRENT_DATE
      `
    );

    res.json({
      por_estado: porEstado.map(r => ({
        estado: r.estado,
        cantidad: Number(r.cantidad),
        total_ventas: Number(r.total_ventas)
      })),
      total_pedidos: Number(totalPedidos[0].total),
      estadisticas_hoy: {
        pedidos_hoy: Number(hoy[0].pedidos_hoy),
        ventas_hoy: Number(hoy[0].ventas_hoy)
      }
    });
  } catch (error) {
    console.error('GET /pedidos/estadisticas/resumen error:', error);
    res.status(500).json({ mensaje: 'Error al obtener estadísticas', error: error.message });
  }
});

module.exports = router;
