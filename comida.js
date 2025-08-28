// comida.js
const express = require('express');
const pool = require('./db'); // Conexión a la base de datos (pg Pool)
const router = express.Router();

/**
 * Utilidades y validaciones
 */
const CATEGORIAS_PERMITIDAS = new Set([
  'Desayuno', 'Almuerzo', 'Cena', 'Postre', 'Bebida', 'Snack'
]);

const toInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const toPrecio = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const normTexto = (t) => (typeof t === 'string' ? t.trim() : '');
const isCategoriaValida = (c) => !c || CATEGORIAS_PERMITIDAS.has(c);

/**
 * GET /api/comidas
 * Soporta filtros opcionales:
 *  - ?categoria=Almuerzo
 *  - ?q=pollo            (busca en nombre)
 *  - ?limit=10&offset=0  (paginación)
 *  - ?orderBy=precio|nombre|id  & order=asc|desc
 */
router.get('/comidas', async (req, res) => {
  try {
    const categoria = normTexto(req.query.categoria);
    const q = normTexto(req.query.q);

    const limit = toInt(req.query.limit) ?? 100;   // límite por defecto
    const offset = toInt(req.query.offset) ?? 0;

    const orderByRaw = normTexto(req.query.orderBy).toLowerCase();
    const orderRaw = normTexto(req.query.order).toLowerCase();

    const orderWhitelist = { id: 'id', nombre: 'nombre', precio: 'precio' };
    const orderBy = orderWhitelist[orderByRaw] || 'id';
    const order = orderRaw === 'asc' ? 'ASC' : 'DESC';

    const where = [];
    const params = [];

    if (categoria && isCategoriaValida(categoria)) {
      params.push(categoria);
      where.push(`categoria = $${params.length}`);
    }

    if (q) {
      params.push(`%${q}%`);
      where.push(`nombre ILIKE $${params.length}`);
    }

    let sql = `SELECT id, nombre, categoria, precio FROM comidas`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY ${orderBy} ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;

    params.push(limit, offset);

    const result = await pool.query(sql, params);

    // Opcional: convertir precio a número para el frontend
    const rows = result.rows.map(r => ({
      ...r,
      precio: r.precio !== null ? Number(r.precio) : null
    }));

    res.json(rows);
  } catch (error) {
    console.error('GET /comidas error:', error);
    res.status(500).json({ mensaje: 'Error al obtener las comidas', error: error.message });
  }
});

/**
 * GET /api/comidas/:id
 */
router.get('/comidas/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ mensaje: 'ID inválido' });

  try {
    const result = await pool.query(
      'SELECT id, nombre, categoria, precio FROM comidas WHERE id = $1',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Comida no encontrada' });
    }

    const row = result.rows[0];
    row.precio = row.precio !== null ? Number(row.precio) : null;

    res.json(row);
  } catch (error) {
    console.error('GET /comidas/:id error:', error);
    res.status(500).json({ mensaje: 'Error al obtener la comida', error: error.message });
  }
});

/**
 * POST /api/comidas
 * Body: { nombre, categoria?, precio }
 */
router.post('/comidas', async (req, res) => {
  const nombre = normTexto(req.body?.nombre);
  const categoria = normTexto(req.body?.categoria);
  const precio = toPrecio(req.body?.precio);

  if (!nombre || precio === null) {
    return res.status(400).json({ mensaje: 'El nombre y el precio son requeridos' });
  }
  if (!isCategoriaValida(categoria)) {
    return res.status(400).json({ mensaje: 'Categoría inválida' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO comidas (nombre, categoria, precio) VALUES ($1, $2, $3) RETURNING id, nombre, categoria, precio',
      [nombre, categoria || null, precio]
    );

    const row = result.rows[0];
    row.precio = row.precio !== null ? Number(row.precio) : null;

    res.status(201).json(row);
  } catch (error) {
    console.error('POST /comidas error:', error);
    res.status(500).json({ mensaje: 'Error al crear la comida', error: error.message });
  }
});

/**
 * PUT /api/comidas/:id
 * Body: { nombre, categoria?, precio }
 */
router.put('/comidas/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ mensaje: 'ID inválido' });

  const nombre = normTexto(req.body?.nombre);
  const categoria = normTexto(req.body?.categoria);
  const precio = toPrecio(req.body?.precio);

  if (!nombre || precio === null) {
    return res.status(400).json({ mensaje: 'El nombre y el precio son requeridos' });
  }
  if (!isCategoriaValida(categoria)) {
    return res.status(400).json({ mensaje: 'Categoría inválida' });
  }

  try {
    const result = await pool.query(
      'UPDATE comidas SET nombre = $1, categoria = $2, precio = $3 WHERE id = $4 RETURNING id, nombre, categoria, precio',
      [nombre, categoria || null, precio, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Comida no encontrada' });
    }

    const row = result.rows[0];
    row.precio = row.precio !== null ? Number(row.precio) : null;

    res.json(row);
  } catch (error) {
    console.error('PUT /comidas/:id error:', error);
    res.status(500).json({ mensaje: 'Error al actualizar la comida', error: error.message });
  }
});

/**
 * DELETE /api/comidas/:id
 */
router.delete('/comidas/:id', async (req, res) => {
  const id = toInt(req.params.id);
  if (!id) return res.status(400).json({ mensaje: 'ID inválido' });

  try {
    const result = await pool.query(
      'DELETE FROM comidas WHERE id = $1 RETURNING id',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Comida no encontrada' });
    }
    // 204: No Content
    res.status(204).send();
  } catch (error) {
    console.error('DELETE /comidas/:id error:', error);
    res.status(500).json({ mensaje: 'Error al eliminar la comida', error: error.message });
  }
});

module.exports = router;
