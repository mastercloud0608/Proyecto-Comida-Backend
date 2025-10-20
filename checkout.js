// checkout.js - Router para procesar pagos con Stripe, Efectivo y QR
const express = require('express');
const pool = require('./db');
const router = express.Router();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ===== Verificación de entorno Stripe =====
console.log('🔑 Verificando claves Stripe...');
if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY no está configurada en Render');
} else {
  console.log(
    '✅ STRIPE_SECRET_KEY cargada correctamente:',
    process.env.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'LIVE' : 'TEST'
  );
}
if (!process.env.STRIPE_PUBLISHABLE_KEY) {
  console.error('⚠️ STRIPE_PUBLISHABLE_KEY no configurada');
} else {
  console.log(
    '📣 STRIPE_PUBLISHABLE_KEY:',
    process.env.STRIPE_PUBLISHABLE_KEY.substring(0, 20) + '...'
  );
}

/* ============================================
 * UTILIDAD: obtener sessionId del header
 * ============================================ */
const getSessionId = (req) => req.headers['x-session-id'];

/* ============================================
 * UTILIDAD: crear pedidos desde carrito
 * ============================================ */
async function crearPedidosDesdeCarrito(client, carrito, metodoPago, estadoInicial = 'confirmado') {
  const itemsResult = await client.query(
    `SELECT ci.*, c.nombre
     FROM carrito_items ci
     JOIN comidas c ON c.id = ci.comida_id
     WHERE ci.carrito_id = $1`,
    [carrito.id]
  );

  const pedidosCreados = [];
  for (const item of itemsResult.rows) {
    const pedidoResult = await client.query(
      `INSERT INTO pedido (
        comida_id, nombre_cliente, email_cliente, telefono_cliente, direccion,
        cantidad, precio_total, estado, notas, metodo_pago
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id`,
      [
        item.comida_id,
        carrito.nombre_cliente,
        carrito.email_cliente,
        carrito.telefono_cliente,
        carrito.direccion,
        item.cantidad,
        parseFloat(item.precio_unitario) * parseInt(item.cantidad),
        estadoInicial,
        item.notas,
        metodoPago
      ]
    );
    pedidosCreados.push(pedidoResult.rows[0].id);
  }

  return pedidosCreados;
}

/* ============================================
 * GET /api/checkout/config
 * ============================================ */
router.get('/checkout/config', (req, res) => {
  try {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
    if (!publishableKey) {
      console.error('❌ STRIPE_PUBLISHABLE_KEY no configurada');
      return res.status(500).json({ mensaje: 'Configuración de Stripe no disponible' });
    }
    console.log('✅ Enviando publishable key:', publishableKey.substring(0, 20) + '...');
    res.json({ publishableKey });
  } catch (error) {
    console.error('❌ Error en /checkout/config:', error);
    res.status(500).json({ mensaje: 'Error al obtener configuración', error: error.message });
  }
});

/* ============================================
 * POST /api/checkout/create-payment-intent
 * ============================================ */
router.post('/checkout/create-payment-intent', async (req, res) => {
  const sessionId = getSessionId(req);
  console.log('📥 Recibida petición create-payment-intent');
  console.log('📍 Session ID:', sessionId);

  if (!sessionId)
    return res.status(400).json({ mensaje: 'Session ID requerido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Obtener carrito activo
    const carritoResult = await client.query(
      'SELECT * FROM carritos WHERE session_id = $1 AND estado = $2',
      [sessionId, 'activo']
    );

    if (carritoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.log('❌ Carrito no encontrado');
      return res.status(404).json({ mensaje: 'Carrito no encontrado' });
    }

    const carrito = carritoResult.rows[0];
    console.log('✅ Carrito encontrado:', carrito.id);

    if (!carrito.nombre_cliente || !carrito.email_cliente) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        mensaje: 'Debe proporcionar información del cliente antes de proceder al pago',
      });
    }

    // Obtener items
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

    // Calcular total correctamente
    const total = itemsResult.rows.reduce(
      (sum, item) => sum + parseFloat(item.precio || item.precio_unitario || 0) * parseInt(item.cantidad),
      0
    );
    console.log('🧮 Total calculado:', total);

    if (isNaN(total) || total <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ mensaje: 'El total debe ser mayor a 0' });
    }

    const amountInCents = Math.round(total * 100);
    console.log(`💳 Creando PaymentIntent por ${amountInCents} centavos`);

    // Crear PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      payment_method_types: ['card'],
      description: `Pedido de ${carrito.nombre_cliente}`,
      receipt_email: carrito.email_cliente,
      metadata: {
        carrito_id: carrito.id.toString(),
        session_id: sessionId,
        items_count: itemsResult.rows.length.toString(),
        customer_name: carrito.nombre_cliente,
      },
    });

    console.log('✅ PaymentIntent creado:', paymentIntent.id);

    // Registrar en la tabla PAGOS
    await client.query(
      `INSERT INTO pagos (
        carrito_id,
        stripe_payment_intent_id,
        monto_total,
        moneda,
        estado,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        carrito.id,
        paymentIntent.id,
        total,
        'usd',
        'pendiente',
        JSON.stringify({
          items: itemsResult.rows.map(i => ({
            comida_id: i.comida_id,
            nombre: i.nombre,
            cantidad: i.cantidad,
            precio_unitario: i.precio_unitario
          }))
        })
      ]
    );

    await client.query('COMMIT');

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error al crear PaymentIntent:', error);
    res.status(500).json({ mensaje: 'Error al crear el pago en Stripe', error: error.message });
  } finally {
    client.release();
  }
});

/* ============================================
 * POST /api/checkout/confirm
 * ============================================ */
router.post('/checkout/confirm', async (req, res) => {
  const { paymentIntentId } = req.body;
  const sessionId = getSessionId(req);

  if (!paymentIntentId)
    return res.status(400).json({ mensaje: 'paymentIntentId requerido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (paymentIntent.status !== 'succeeded') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        mensaje: 'El pago no ha sido completado',
        status: paymentIntent.status,
      });
    }

    const pagoResult = await client.query(
      'SELECT * FROM pagos WHERE stripe_payment_intent_id = $1',
      [paymentIntentId]
    );
    if (pagoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Pago no encontrado' });
    }

    const pago = pagoResult.rows[0];
    if (pago.pedido_id) {
      await client.query('ROLLBACK');
      return res.json({ mensaje: 'Pago ya procesado', pedido_id: pago.pedido_id });
    }

    const carritoResult = await client.query(
      'SELECT * FROM carritos WHERE id = $1',
      [pago.carrito_id]
    );
    const carrito = carritoResult.rows[0];

    const pedidosCreados = await crearPedidosDesdeCarrito(client, carrito, 'tarjeta');

    await client.query(
      `UPDATE pagos 
       SET estado = $1, pedido_id = $2, fecha_actualizacion = NOW()
       WHERE id = $3`,
      ['exitoso', pedidosCreados[0], pago.id]
    );

    await client.query(
      'UPDATE carritos SET estado = $1 WHERE id = $2',
      ['convertido', carrito.id]
    );

    await client.query('COMMIT');

    res.json({
      mensaje: 'Pago confirmado y pedido(s) creado(s)',
      pedidos: pedidosCreados,
      pago_id: pago.id,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error en confirm:', error);
    res.status(500).json({ mensaje: 'Error al confirmar el pago', error: error.message });
  } finally {
    client.release();
  }
});

/* ============================================
 * POST /api/checkout/confirm-efectivo
 * Confirma pedido con pago en efectivo
 * ============================================ */
router.post('/checkout/confirm-efectivo', async (req, res) => {
  const sessionId = getSessionId(req);
  console.log('💵 Recibida petición confirm-efectivo');
  console.log('📍 Session ID:', sessionId);

  if (!sessionId)
    return res.status(400).json({ mensaje: 'Session ID requerido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Obtener carrito activo
    const carritoResult = await client.query(
      'SELECT * FROM carritos WHERE session_id = $1 AND estado = $2',
      [sessionId, 'activo']
    );

    if (carritoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Carrito no encontrado' });
    }

    const carrito = carritoResult.rows[0];

    if (!carrito.nombre_cliente || !carrito.email_cliente) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        mensaje: 'Debe proporcionar información del cliente',
      });
    }

    // Verificar items
    const itemsResult = await client.query(
      `SELECT ci.*, c.precio
       FROM carrito_items ci
       JOIN comidas c ON c.id = ci.comida_id
       WHERE ci.carrito_id = $1`,
      [carrito.id]
    );

    if (itemsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ mensaje: 'El carrito está vacío' });
    }

    // Calcular total
    const total = itemsResult.rows.reduce(
      (sum, item) => sum + parseFloat(item.precio || item.precio_unitario || 0) * parseInt(item.cantidad),
      0
    );

    // Crear pedidos con estado 'pendiente_pago'
    const pedidosCreados = await crearPedidosDesdeCarrito(
      client, 
      carrito, 
      'efectivo', 
      'pendiente_pago'
    );

    // Registrar el pago como pendiente
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
        'bob', // Bolivianos
        'pendiente',
        pedidosCreados[0],
        JSON.stringify({
          metodo_pago: 'efectivo',
          items: itemsResult.rows.map(i => ({
            comida_id: i.comida_id,
            cantidad: i.cantidad,
            precio_unitario: i.precio_unitario
          }))
        })
      ]
    );

    await client.query(
      'UPDATE carritos SET estado = $1 WHERE id = $2',
      ['convertido', carrito.id]
    );

    await client.query('COMMIT');

    res.json({
      mensaje: 'Pedido confirmado. Paga en efectivo al recibir tu pedido.',
      pedidos: pedidosCreados,
      monto_total: total,
      metodo_pago: 'efectivo'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error en confirm-efectivo:', error);
    res.status(500).json({ mensaje: 'Error al confirmar pedido', error: error.message });
  } finally {
    client.release();
  }
});

/* ============================================
 * POST /api/checkout/confirm-qr
 * Confirma pedido con pago QR
 * ============================================ */
router.post('/checkout/confirm-qr', async (req, res) => {
  const sessionId = getSessionId(req);
  console.log('📱 Recibida petición confirm-qr');
  console.log('📍 Session ID:', sessionId);

  if (!sessionId)
    return res.status(400).json({ mensaje: 'Session ID requerido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Obtener carrito activo
    const carritoResult = await client.query(
      'SELECT * FROM carritos WHERE session_id = $1 AND estado = $2',
      [sessionId, 'activo']
    );

    if (carritoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Carrito no encontrado' });
    }

    const carrito = carritoResult.rows[0];

    if (!carrito.nombre_cliente || !carrito.email_cliente) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        mensaje: 'Debe proporcionar información del cliente',
      });
    }

    // Verificar items
    const itemsResult = await client.query(
      `SELECT ci.*, c.precio
       FROM carrito_items ci
       JOIN comidas c ON c.id = ci.comida_id
       WHERE ci.carrito_id = $1`,
      [carrito.id]
    );

    if (itemsResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ mensaje: 'El carrito está vacío' });
    }

    // Calcular total
    const total = itemsResult.rows.reduce(
      (sum, item) => sum + parseFloat(item.precio || item.precio_unitario || 0) * parseInt(item.cantidad),
      0
    );

    // Crear pedidos con estado 'pendiente_verificacion'
    const pedidosCreados = await crearPedidosDesdeCarrito(
      client, 
      carrito, 
      'qr', 
      'pendiente_verificacion'
    );

    // Registrar el pago como pendiente de verificación
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
        'bob', // Bolivianos
        'pendiente_verificacion',
        pedidosCreados[0],
        JSON.stringify({
          metodo_pago: 'qr',
          items: itemsResult.rows.map(i => ({
            comida_id: i.comida_id,
            cantidad: i.cantidad,
            precio_unitario: i.precio_unitario
          }))
        })
      ]
    );

    await client.query(
      'UPDATE carritos SET estado = $1 WHERE id = $2',
      ['convertido', carrito.id]
    );

    await client.query('COMMIT');

    res.json({
      mensaje: 'Pago QR registrado. Verificaremos tu transacción pronto.',
      pedidos: pedidosCreados,
      monto_total: total,
      metodo_pago: 'qr'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error en confirm-qr:', error);
    res.status(500).json({ mensaje: 'Error al confirmar pedido', error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;