// pedidos.js - Versión con Pagos Simulados
const express = require('express');
const pool = require('./db');
const router = express.Router();

// ============================================
// CONSTANTES Y UTILIDADES
// ============================================
const ESTADOS_VALIDOS = [
  'pendiente', 
  'confirmado', 
  'en-preparacion', 
  'listo', 
  'entregado', 
  'cancelado',
  'pendiente_pago',
  'pendiente_verificacion'
];

const METODOS_PAGO_VALIDOS = ['tarjeta', 'efectivo', 'qr', 'simulado'];

const toInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const norm = (v) => (typeof v === 'string' ? v.trim() : '');

const getSessionId = (req) => req.headers['x-session-id'];

// Middleware de validación de session
const requireSession = (req, res, next) => {
  const sessionId = getSessionId(req);
  if (!sessionId) {
    return res.status(400).json({ mensaje: 'Session ID requerido en el header x-session-id' });
  }
  req.sessionId = sessionId;
  next();
};

// ============================================
// GET /api/pedidos - Listar todos los pedidos
// ============================================
router.get('/pedidos', async (req, res) => {
  try {
    const estado = norm(req.query.estado);
    const email = norm(req.query.email);
    const limit = Math.min(toInt(req.query.limit) || 100, 500);
    const offset = toInt(req.query.offset) || 0;

    const where = [];
    const params = [];

    if (estado && ESTADOS_VALIDOS.includes(estado)) {
      params.push(estado);
      where.push(`estado = $${params.length}`);
    }

    if (email) {
      params.push(email.toLowerCase());
      where.push(`LOWER(email_cliente) = $${params.length}`);
    }

    let sql = 'SELECT * FROM vista_pedidos_completos';
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    
    params.push(limit, offset);
    sql += ` ORDER BY fecha_pedido DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { rows } = await pool.query(sql, params);
    
    let countSql = 'SELECT COUNT(*) as total FROM pedido';
    if (where.length) {
      countSql += ` WHERE ${where.join(' AND ')}`;
    }
    const countResult = await pool.query(countSql, params.slice(0, params.length - 2));
    
    res.json({
      pedidos: rows,
      paginacion: {
        total: parseInt(countResult.rows[0].total),
        limit,
        offset,
        tiene_mas: (offset + limit) < parseInt(countResult.rows[0].total)
      }
    });
  } catch (error) {
    console.error('❌ GET /pedidos error:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener los pedidos', 
      error: error.message 
    });
  }
});

// ============================================
// GET /api/pedidos/:id - Obtener un pedido
// ============================================
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
    console.error('❌ GET /pedidos/:id error:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener el pedido', 
      error: error.message 
    });
  }
});

// ============================================
// POST /api/pedidos - Crear nuevo pedido individual
// ============================================
router.post('/pedidos', async (req, res) => {
  const { 
    comida_id, 
    nombre_cliente, 
    email_cliente, 
    telefono_cliente, 
    direccion, 
    cantidad, 
    notas,
    metodo_pago
  } = req.body;

  if (!comida_id || !nombre_cliente || !email_cliente || !cantidad) {
    return res.status(400).json({ 
      mensaje: 'Los campos comida_id, nombre_cliente, email_cliente y cantidad son requeridos' 
    });
  }

  const cantidadInt = toInt(cantidad);
  if (!cantidadInt) {
    return res.status(400).json({ 
      mensaje: 'La cantidad debe ser un número entero positivo' 
    });
  }

  if (metodo_pago && !METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
    return res.status(400).json({ 
      mensaje: `Método de pago no válido. Permitidos: ${METODOS_PAGO_VALIDOS.join(', ')}` 
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const comidaResult = await client.query(
      'SELECT id, precio, nombre, empresa FROM comidas WHERE id = $1',
      [comida_id]
    );

    if (comidaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Comida no encontrada' });
    }

    const comida = comidaResult.rows[0];
    const precioUnitario = parseFloat(comida.precio);
    const precioTotal = precioUnitario * cantidadInt;

    const result = await client.query(`
      INSERT INTO pedido (
        comida_id, 
        nombre_cliente, 
        email_cliente, 
        telefono_cliente, 
        direccion, 
        cantidad, 
        precio_total, 
        notas,
        metodo_pago,
        estado
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
      RETURNING id
    `, [
      comida_id, 
      nombre_cliente.trim(), 
      email_cliente.trim().toLowerCase(), 
      telefono_cliente || null, 
      direccion || null, 
      cantidadInt, 
      precioTotal, 
      notas || `Pedido de ${comida.nombre} - ${comida.empresa || 'Restaurante'}`,
      metodo_pago || 'efectivo',
      'confirmado'
    ]);

    await client.query('COMMIT');

    const pedidoId = result.rows[0].id;

    const pedidoCompleto = await pool.query(
      'SELECT * FROM vista_pedidos_completos WHERE id = $1',
      [pedidoId]
    );

    console.log(`✅ Pedido creado: ID ${pedidoId}, Total: Bs ${precioTotal}`);
    res.status(201).json(pedidoCompleto.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ POST /pedidos error:', error);
    res.status(500).json({ 
      mensaje: 'Error al crear el pedido', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// ============================================
// POST /api/pedidos/crear-desde-carrito
// Crea pedidos desde el carrito (MODO SIMULADO)
// ============================================
router.post('/pedidos/crear-desde-carrito', requireSession, async (req, res) => {
  const { metodo_pago } = req.body;
  const sessionId = req.sessionId;

  console.log('📦 [SIMULADO] Creando pedidos desde carrito');
  console.log('   Session ID:', sessionId);
  console.log('   Método de pago:', metodo_pago);

  if (metodo_pago && !METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
    return res.status(400).json({ 
      mensaje: `Método de pago no válido. Permitidos: ${METODOS_PAGO_VALIDOS.join(', ')}` 
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const carritoResult = await client.query(
      'SELECT * FROM carritos WHERE session_id = $1 AND estado = $2',
      [sessionId, 'activo']
    );

    if (carritoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Carrito no encontrado o ya procesado' });
    }

    const carrito = carritoResult.rows[0];

    if (!carrito.nombre_cliente || !carrito.email_cliente) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        mensaje: 'Debe proporcionar información del cliente antes de crear el pedido',
      });
    }

    const itemsResult = await client.query(
      `SELECT ci.*, c.nombre, c.precio, c.precio_original, 
              c.descuento_porcentaje, c.empresa, c.categoria
       FROM carrito_items ci
       JOIN comidas c ON c.id = ci.comida_id
       WHERE ci.carrito_id = $1`,
      [carrito.id]
    );

    if (itemsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ mensaje: 'El carrito está vacío' });
    }

    let total = 0;
    for (const item of itemsResult.rows) {
      const precio = parseFloat(item.precio || item.precio_unitario || 0);
      const cantidad = parseInt(item.cantidad || 1);
      if (precio <= 0 || cantidad <= 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          mensaje: `Item inválido: ${item.nombre}. Precio o cantidad incorrectos.` 
        });
      }
      total += precio * cantidad;
    }

    if (total <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ mensaje: 'El total del pedido debe ser mayor a 0' });
    }

    // MODO SIMULADO: Todos los pagos se confirman automáticamente
    const estadoPedido = 'confirmado';

    const pedidosCreados = [];
    for (const item of itemsResult.rows) {
      const precioUnitario = parseFloat(item.precio || item.precio_unitario);
      const cantidad = parseInt(item.cantidad);
      const subtotal = precioUnitario * cantidad;
      
      const notasPedido = [
        item.notas,
        item.empresa ? `Restaurante: ${item.empresa}` : null,
        item.descuento_porcentaje > 0 ? `Descuento: ${item.descuento_porcentaje}%` : null,
        `Pago ${metodo_pago || 'simulado'} - SIMULADO`
      ].filter(Boolean).join(' | ');

      const pedidoResult = await client.query(
        `INSERT INTO pedido (
          comida_id, nombre_cliente, email_cliente, telefono_cliente, direccion,
          cantidad, precio_total, estado, notas, metodo_pago
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING id`,
        [
          item.comida_id,
          carrito.nombre_cliente,
          carrito.email_cliente.toLowerCase(),
          carrito.telefono_cliente,
          carrito.direccion,
          cantidad,
          subtotal,
          estadoPedido,
          notasPedido || `Pedido de ${item.nombre}`,
          metodo_pago || 'simulado'
        ]
      );
      
      pedidosCreados.push({
        id: pedidoResult.rows[0].id,
        comida: item.nombre,
        empresa: item.empresa,
        categoria: item.categoria,
        cantidad: cantidad,
        precio_unitario: precioUnitario,
        subtotal: subtotal
      });
    }

    // Registrar el pago simulado
    const metadataPago = {
      metodo_pago: metodo_pago || 'simulado',
      modo: 'simulado',
      pago_automatico: true,
      items: pedidosCreados.length,
      total_items: pedidosCreados.reduce((sum, p) => sum + p.cantidad, 0),
      cliente: carrito.nombre_cliente,
      email: carrito.email_cliente,
      fecha_simulacion: new Date().toISOString()
    };

    await client.query(
      `INSERT INTO pagos (
        carrito_id,
        monto_total,
        moneda,
        estado,
        pedido_id,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        carrito.id,
        total,
        'bob',
        'exitoso',
        pedidosCreados[0].id,
        JSON.stringify(metadataPago)
      ]
    );

    await client.query(
      `UPDATE carritos 
       SET estado = $1, fecha_actualizacion = NOW() 
       WHERE id = $2`,
      ['convertido', carrito.id]
    );

    await client.query('COMMIT');

    console.log(`✅ [SIMULADO] ${pedidosCreados.length} pedido(s) confirmado(s) automáticamente`);
    console.log(`   Total: Bs ${total.toFixed(2)}`);

    res.status(201).json({
      mensaje: '¡Pago simulado exitoso! Pedidos confirmados automáticamente',
      modo: 'simulado',
      pedidos: pedidosCreados,
      resumen: {
        cantidad_pedidos: pedidosCreados.length,
        total_items: pedidosCreados.reduce((sum, p) => sum + p.cantidad, 0),
        total: total,
        metodo_pago: metodo_pago || 'simulado',
        estado: estadoPedido,
        pago_automatico: true
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error al crear pedidos desde carrito:', error);
    res.status(500).json({ 
      mensaje: 'Error al crear pedidos', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// ============================================
// PUT /api/pedidos/:id - Actualizar pedido completo
// ============================================
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

  if (!nombre_cliente || !email_cliente || !cantidad) {
    return res.status(400).json({ 
      mensaje: 'Los campos nombre_cliente, email_cliente y cantidad son requeridos' 
    });
  }

  const cantidadInt = toInt(cantidad);
  if (!cantidadInt) {
    return res.status(400).json({ 
      mensaje: 'La cantidad debe ser un número entero positivo' 
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

    const pedidoActual = await client.query(
      'SELECT * FROM pedido WHERE id = $1', 
      [id]
    );
    
    if (pedidoActual.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    const pedido = pedidoActual.rows[0];

    let precioTotal = pedido.precio_total;
    if (cantidadInt !== parseInt(pedido.cantidad)) {
      const comidaResult = await client.query(
        'SELECT precio FROM comidas WHERE id = $1', 
        [pedido.comida_id]
      );
      
      if (comidaResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ mensaje: 'Comida asociada no encontrada' });
      }
      
      const precioUnitario = parseFloat(comidaResult.rows[0].precio);
      precioTotal = precioUnitario * cantidadInt;
    }

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
          fecha_actualizacion = NOW()
      WHERE id = $9
    `, [
      nombre_cliente.trim(), 
      email_cliente.trim().toLowerCase(), 
      telefono_cliente || null, 
      direccion || null, 
      cantidadInt, 
      precioTotal, 
      estado || pedido.estado, 
      notas, 
      id
    ]);

    await client.query('COMMIT');

    const pedidoCompleto = await pool.query(
      'SELECT * FROM vista_pedidos_completos WHERE id = $1',
      [id]
    );

    console.log(`✅ Pedido ${id} actualizado`);
    res.json(pedidoCompleto.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ PUT /pedidos/:id error:', error);
    res.status(500).json({ 
      mensaje: 'Error al actualizar el pedido', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// ============================================
// PATCH /api/pedidos/:id/estado - Solo cambiar estado
// ============================================
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
      SET estado = $1, fecha_actualizacion = NOW()
      WHERE id = $2 
      RETURNING id
    `, [estado, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    const pedidoCompleto = await pool.query(
      'SELECT * FROM vista_pedidos_completos WHERE id = $1',
      [id]
    );

    console.log(`✅ Estado del pedido ${id} cambiado a: ${estado}`);
    res.json(pedidoCompleto.rows[0]);
  } catch (error) {
    console.error('❌ PATCH /pedidos/:id/estado error:', error);
    res.status(500).json({ 
      mensaje: 'Error al actualizar el estado del pedido', 
      error: error.message 
    });
  }
});

// ============================================
// DELETE /api/pedidos/:id - Eliminar pedido
// ============================================
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

    console.log(`✅ Pedido ${id} eliminado`);
    res.status(204).send();
  } catch (error) {
    console.error('❌ DELETE /pedidos/:id error:', error);
    res.status(500).json({ 
      mensaje: 'Error al eliminar el pedido', 
      error: error.message 
    });
  }
});

// ============================================
// GET /api/pedidos/estadisticas/resumen
// ============================================
router.get('/pedidos/estadisticas/resumen', async (req, res) => {
  try {
    const [porEstado, totalPedidos, ventasHoy, ventasSemana] = await Promise.all([
      pool.query(`
        SELECT 
          estado,
          COUNT(*) as cantidad,
          COALESCE(SUM(precio_total), 0) as total_ventas
        FROM pedido 
        GROUP BY estado
        ORDER BY cantidad DESC
      `),
      pool.query('SELECT COUNT(*) as total FROM pedido'),
      pool.query(`
        SELECT 
          COUNT(*) as pedidos_hoy,
          COALESCE(SUM(precio_total), 0) as ventas_hoy
        FROM pedido 
        WHERE DATE(fecha_pedido) = CURRENT_DATE
      `),
      pool.query(`
        SELECT 
          COUNT(*) as pedidos_semana,
          COALESCE(SUM(precio_total), 0) as ventas_semana
        FROM pedido 
        WHERE fecha_pedido >= CURRENT_DATE - INTERVAL '7 days'
      `)
    ]);

    res.json({
      por_estado: porEstado.rows,
      total_pedidos: parseInt(totalPedidos.rows[0].total),
      estadisticas_hoy: ventasHoy.rows[0],
      estadisticas_semana: ventasSemana.rows[0]
    });
  } catch (error) {
    console.error('❌ GET /estadisticas error:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener estadísticas', 
      error: error.message 
    });
  }
});

module.exports = router;