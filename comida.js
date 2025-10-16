'use strict';
// comida.js mejorado con soporte para imágenes
const express = require('express');
const pool = require('./db'); // pg Pool
const router = express.Router();

/* =================== Utilidades =================== */
const CATEGORIAS_PERMITIDAS = new Set([
  'Desayuno', 'Almuerzo', 'Cena', 'Postre', 'Bebida', 'Snack'
]);

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;
const DEFAULT_OFFSET = 0;

const norm = (t) => (typeof t === 'string' ? t.trim() : '');
const toIntPos = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
};
const toPrecio = (v) => {
  if (v === '' || v === null || typeof v === 'undefined') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const isCategoriaValida = (c) => !c || CATEGORIAS_PERMITIDAS.has(c);

// Validar URL de imagen (básico)
const isValidImageUrl = (url) => {
  if (!url) return true; // null/vacío es válido
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
};

const mapPrecioNumber = (row) =>
  row ? { ...row, precio: row.precio !== null ? Number(row.precio) : null } : row;

// Evita repetir try/catch
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Ordenamiento seguro
const parseSort = (orderByRaw, orderRaw) => {
  const whitelist = { id: 'id', nombre: 'nombre', precio: 'precio' };
  const key = whitelist[norm(orderByRaw).toLowerCase()] || 'id';
  const dir = norm(orderRaw).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return { key, dir };
};

// Respuesta de error consistente
const badRequest = (res, mensaje) => res.status(400).json({ mensaje });

/* =================== Rutas =================== */
/**
 * GET /api/comidas
 * Filtros:
 *  - ?categoria=Almuerzo
 *  - ?q=pollo
 *  - ?limit=10&offset=0
 *  - ?orderBy=precio|nombre|id  & order=asc|desc
 * Respuesta: { items: [...], meta: { total, limit, offset, orderBy, order } }
 */
router.get('/comidas', asyncHandler(async (req, res) => {
  const categoria = norm(req.query.categoria);
  const q = norm(req.query.q);

  let limit = toIntPos(req.query.limit);
  let offset = toIntPos(req.query.offset);
  limit = limit === null ? DEFAULT_LIMIT : Math.min(limit, MAX_LIMIT);
  offset = offset === null ? DEFAULT_OFFSET : offset;

  const { key: orderBy, dir: order } = parseSort(req.query.orderBy, req.query.order);

  if (categoria && !isCategoriaValida(categoria)) {
    return badRequest(res, 'Categoría inválida');
  }

  const where = [];
  const params = [];

  if (categoria) {
    params.push(categoria);
    where.push(`categoria = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    where.push(`nombre ILIKE $${params.length}`);
  }

  // Incluimos el campo imagen en el SELECT
  let sql = `
    SELECT id, nombre, categoria, precio, imagen,
           COUNT(*) OVER() AS total
    FROM comidas
  `;
  if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
  params.push(limit, offset);
  sql += ` ORDER BY ${orderBy} ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`;

  const { rows } = await pool.query(sql, params);
  const total = rows[0]?.total ? Number(rows[0].total) : 0;
  const items = rows.map(({ total: _t, ...r }) => mapPrecioNumber(r));

  res.json({
    items,
    meta: { total, limit, offset, orderBy, order }
  });
}));

/**
 * GET /api/comidas/:id
 */
router.get('/comidas/:id', asyncHandler(async (req, res) => {
  const id = toIntPos(req.params.id);
  if (id === null) return badRequest(res, 'ID inválido');

  const { rows } = await pool.query(
    'SELECT id, nombre, categoria, precio, imagen FROM comidas WHERE id = $1',
    [id]
  );
  if (rows.length === 0) return res.status(404).json({ mensaje: 'Comida no encontrada' });

  res.json(mapPrecioNumber(rows[0]));
}));

/**
 * POST /api/comidas
 * Body: { nombre, categoria?, precio, imagen? }
 */
router.post('/comidas', asyncHandler(async (req, res) => {
  const nombre = norm(req.body?.nombre);
  const categoria = norm(req.body?.categoria);
  const precio = toPrecio(req.body?.precio);
  const imagen = norm(req.body?.imagen);

  if (!nombre || nombre.length > 120) {
    return badRequest(res, 'El nombre es requerido y debe tener ≤ 120 caracteres');
  }
  if (precio === null) {
    return badRequest(res, 'El precio es requerido y debe ser un número ≥ 0');
  }
  if (!isCategoriaValida(categoria)) {
    return badRequest(res, 'Categoría inválida');
  }
  if (imagen && !isValidImageUrl(imagen)) {
    return badRequest(res, 'La URL de la imagen no es válida');
  }

  const { rows } = await pool.query(
    `INSERT INTO comidas (nombre, categoria, precio, imagen)
     VALUES ($1, $2, $3, $4)
     RETURNING id, nombre, categoria, precio, imagen`,
    [nombre, categoria || null, precio, imagen || null]
  );

  const created = mapPrecioNumber(rows[0]);
  res
    .status(201)
    .location(`/api/comidas/${created.id}`)
    .json(created);
}));

/**
 * PUT /api/comidas/:id   (reemplazo completo)
 * Body: { nombre, categoria?, precio, imagen? }
 */
router.put('/comidas/:id', asyncHandler(async (req, res) => {
  const id = toIntPos(req.params.id);
  if (id === null) return badRequest(res, 'ID inválido');

  const nombre = norm(req.body?.nombre);
  const categoria = norm(req.body?.categoria);
  const precio = toPrecio(req.body?.precio);
  const imagen = norm(req.body?.imagen);

  if (!nombre || nombre.length > 120) {
    return badRequest(res, 'El nombre es requerido y debe tener ≤ 120 caracteres');
  }
  if (precio === null) {
    return badRequest(res, 'El precio es requerido y debe ser un número ≥ 0');
  }
  if (!isCategoriaValida(categoria)) {
    return badRequest(res, 'Categoría inválida');
  }
  if (imagen && !isValidImageUrl(imagen)) {
    return badRequest(res, 'La URL de la imagen no es válida');
  }

  const { rows } = await pool.query(
    `UPDATE comidas
       SET nombre = $1, categoria = $2, precio = $3, imagen = $4
     WHERE id = $5
     RETURNING id, nombre, categoria, precio, imagen`,
    [nombre, categoria || null, precio, imagen || null, id]
  );

  if (rows.length === 0) return res.status(404).json({ mensaje: 'Comida no encontrada' });
  res.json(mapPrecioNumber(rows[0]));
}));

/**
 * PATCH /api/comidas/:id   (actualización parcial)
 * Body: { nombre?, categoria?, precio?, imagen? }
 */
router.patch('/comidas/:id', asyncHandler(async (req, res) => {
  const id = toIntPos(req.params.id);
  if (id === null) return badRequest(res, 'ID inválido');

  const nombre = req.body?.nombre !== undefined ? norm(req.body.nombre) : undefined;
  const categoria = req.body?.categoria !== undefined ? norm(req.body.categoria) : undefined;
  const precio = req.body?.precio !== undefined ? toPrecio(req.body.precio) : undefined;
  const imagen = req.body?.imagen !== undefined ? norm(req.body.imagen) : undefined;

  const sets = [];
  const params = [];
  if (nombre !== undefined) {
    if (!nombre || nombre.length > 120) return badRequest(res, 'Nombre inválido');
    params.push(nombre); sets.push(`nombre = $${params.length}`);
  }
  if (categoria !== undefined) {
    if (!isCategoriaValida(categoria)) return badRequest(res, 'Categoría inválida');
    params.push(categoria || null); sets.push(`categoria = $${params.length}`);
  }
  if (precio !== undefined) {
    if (precio === null) return badRequest(res, 'Precio inválido');
    params.push(precio); sets.push(`precio = $${params.length}`);
  }
  if (imagen !== undefined) {
    if (imagen && !isValidImageUrl(imagen)) return badRequest(res, 'URL de imagen inválida');
    params.push(imagen || null); sets.push(`imagen = $${params.length}`);
  }

  if (sets.length === 0) return badRequest(res, 'No hay campos para actualizar');

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE comidas SET ${sets.join(', ')} WHERE id = $${params.length}
     RETURNING id, nombre, categoria, precio, imagen`,
    params
  );
  if (rows.length === 0) return res.status(404).json({ mensaje: 'Comida no encontrada' });

  res.json(mapPrecioNumber(rows[0]));
}));

/**
 * DELETE /api/comidas/:id
 */
router.delete('/comidas/:id', asyncHandler(async (req, res) => {
  const id = toIntPos(req.params.id);
  if (id === null) return badRequest(res, 'ID inválido');

  const { rows } = await pool.query(
    'DELETE FROM comidas WHERE id = $1 RETURNING id',
    [id]
  );
  if (rows.length === 0) return res.status(404).json({ mensaje: 'Comida no encontrada' });
  res.status(204).send();
}));

/* =================== Manejador de errores =================== */
router.use((err, req, res, _next) => {
  console.error('Error:', err);
  res.status(500).json({ mensaje: 'Error interno del servidor', error: err.message });
});

module.exports = router;