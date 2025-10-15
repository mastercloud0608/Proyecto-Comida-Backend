'use strict';
const express = require('express');
const pool = require('./db'); // pg Pool
const router = express.Router();

/* ============ Utils ============ */
const norm = (t) => (typeof t === 'string' ? t.trim() : '');
const toIntNonNeg = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const badRequest = (res, msg) => res.status(400).json({ mensaje: msg });

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

const parseSort = (orderByRaw, orderRaw, whitelist = { id: 'id', nombre: 'nombre' }) => {
  const key = whitelist[norm(orderByRaw).toLowerCase()] || 'id';
  const dir = norm(orderRaw).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return { key, dir };
};

/* ============ GET /categorias (listado con filtros) ============ */
/**
 * Query params:
 *  - q: texto (busca por nombre, case-insensitive)
 *  - limit, offset
 *  - orderBy: id|nombre   order: asc|desc
 * Respuesta: { items: [...], meta: { total, limit, offset, orderBy, order } }
 */
router.get('/categorias', asyncHandler(async (req, res) => {
  const q = norm(req.query.q);
  let limit = toIntNonNeg(req.query.limit);
  let offset = toIntNonNeg(req.query.offset);
  limit = limit === null ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT);
  offset = offset === null ? DEFAULT_OFFSET : offset;

  const { key: orderBy, dir: order } = parseSort(req.query.orderBy, req.query.order);

  const where = [];
  const params = [];

  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`LOWER(nombre) LIKE $${params.length}`);
  }

  let sql = `
    SELECT id, nombre, COUNT(*) OVER() AS total
    FROM categoria
  `;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;

  // LIMIT/OFFSET deben ir como parámetros
  params.push(limit, offset);
  sql += ` ORDER BY ${orderBy} ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { rows } = await pool.query(sql, params);
  const total = rows[0]?.total ? Number(rows[0].total) : 0;
  const items = rows.map(({ total: _t, ...r }) => r);

  res.json({ items, meta: { total, limit, offset, orderBy, order } });
}));

/* ============ GET /categorias/:id ============ */
router.get('/categorias/:id', asyncHandler(async (req, res) => {
  const id = toIntNonNeg(req.params.id);
  if (id === null) return badRequest(res, 'ID inválido');

  const { rows } = await pool.query('SELECT id, nombre FROM categoria WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ mensaje: 'Categoría no encontrada' });

  res.json(rows[0]);
}));

/* ============ POST /categorias ============ */
/**
 * Body: { nombre }
 */
router.post('/categorias', asyncHandler(async (req, res) => {
  const nombre = norm(req.body?.nombre);

  if (!nombre || nombre.length > 120) {
    return badRequest(res, 'El nombre es requerido y debe tener ≤ 120 caracteres');
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO categoria (nombre)
       VALUES ($1)
       RETURNING id, nombre`,
      [nombre]
    );
    const created = rows[0];
    return res.status(201).location(`/api/categorias/${created.id}`).json(created);
  } catch (err) {
    // 23505 = unique_violation
    if (err.code === '23505') {
      return res.status(409).json({ mensaje: 'Ya existe una categoría con ese nombre' });
    }
    throw err;
  }
}));

/* ============ PUT /categorias/:id (reemplazo) ============ */
/**
 * Body: { nombre }
 */
router.put('/categorias/:id', asyncHandler(async (req, res) => {
  const id = toIntNonNeg(req.params.id);
  if (id === null) return badRequest(res, 'ID inválido');

  const nombre = norm(req.body?.nombre);
  if (!nombre || nombre.length > 120) {
    return badRequest(res, 'El nombre es requerido y debe tener ≤ 120 caracteres');
  }

  try {
    const { rows } = await pool.query(
      `UPDATE categoria
         SET nombre = $1
       WHERE id = $2
       RETURNING id, nombre`,
      [nombre, id]
    );
    if (rows.length === 0) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ mensaje: 'Ya existe una categoría con ese nombre' });
    }
    throw err;
  }
}));

/* ============ PATCH /categorias/:id (parcial) ============ */
router.patch('/categorias/:id', asyncHandler(async (req, res) => {
  const id = toIntNonNeg(req.params.id);
  if (id === null) return badRequest(res, 'ID inválido');

  const nombreProvided = Object.prototype.hasOwnProperty.call(req.body || {}, 'nombre');
  if (!nombreProvided) return badRequest(res, 'No hay campos para actualizar');

  const nombre = nombreProvided ? norm(req.body.nombre) : undefined;
  if (nombreProvided && (!nombre || nombre.length > 120)) {
    return badRequest(res, 'Nombre inválido');
  }

  const sets = [];
  const params = [];

  if (nombreProvided) { params.push(nombre); sets.push(`nombre = $${params.length}`); }
  params.push(id);

  try {
    const { rows } = await pool.query(
      `UPDATE categoria SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, nombre`,
      params
    );
    if (rows.length === 0) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ mensaje: 'Ya existe una categoría con ese nombre' });
    }
    throw err;
  }
}));

/* ============ DELETE /categorias/:id (protegido si tiene comidas) ============ */
router.delete('/categorias/:id', asyncHandler(async (req, res) => {
  const id = toIntNonNeg(req.params.id);
  if (id === null) return badRequest(res, 'ID inválido');

  // Verifica si hay comidas que referencian la categoría
  const { rows: rel } = await pool.query(
    'SELECT COUNT(*)::int AS cnt FROM comidas WHERE categoria_id = $1',
    [id]
  );
  const cnt = rel[0]?.cnt ?? 0;
  if (cnt > 0) {
    return res.status(409).json({
      mensaje: 'No se puede eliminar la categoría: hay comidas asociadas',
      referencias: cnt
    });
  }

  const { rows } = await pool.query('DELETE FROM categoria WHERE id = $1 RETURNING id', [id]);
  if (rows.length === 0) return res.status(404).json({ mensaje: 'Categoría no encontrada' });
  res.status(204).send();
}));

/* ============ Error handler del router ============ */
router.use((err, _req, res, _next) => {
  console.error('Error categorías:', err);
  res.status(500).json({ mensaje: 'Error interno del servidor', error: err.message });
});

module.exports = router;
