// checkout.js - Router para procesar pagos con Stripe
const express = require('express');
const pool = require('./db');
const router = express.Router();

// Importar helpers de Stripe
const {
  createPaymentIntentDirect,
  getPublishableKey
} = require('./pago');

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/* ============================================
 * UTILIDADES
 * ============================================ */
const toInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

const getSessionId = (req) => {
  return req.headers['x-session-id'];
};

/* ============================================
 * GET /api/checkout/config
 * Obtener la publishable key de Stripe
 * ============================================ */
router.get('/checkout/config', (req, res) => {
  try {
    const publishableKey = getPublishableKey();
    res.json({ publishableKey });
  } catch (error) {
    res.status(500).json({ 
      mensaje: 'Error al obtener configuración', 
      error: error.message 
    });
  }
});

/* ============================================
 * POST /api/checkout/create-payment-intent
 * Crear un Payment Intent para el carrito actual
 * ============================================ */
router.post('/checkout/create-payment-intent', async (req, res) => {
  const sessionId = getSessionId(req);
  
  if (!sessionId) {
    return res.status(400).json({ mensaje: 'Session ID requerido' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Obtener carrito
    const carritoResult = await client.query(
      'SELECT * FROM carritos WHERE session_id = $1 AND estado = $2',
      [sessionId, 'activo']
    );
    
    if (carritoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Carrito no encontrado' });
    }
    
    const carrito = carritoResult.rows[0];
    
    // Validar que el carrito tiene información del cliente
    if (!carrito.nombre_cliente || !carrito.email_cliente) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        mensaje: 'Debe proporcionar información del cliente antes de proceder al pago' 
      });
    }
    
    // Obtener items del carrito
    const itemsResult = await client.query(
      `SELECT ci.*, c.nombre, c.precio
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
    const total = itemsResult.rows.reduce((sum, item) => {
      return sum + (parseFloat(item.precio_unitario) * parseInt(item.cantidad));
    }, 0);
    
    if (total <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ mensaje: 'El total debe ser mayor a 0' });
    }
    
    // Crear Payment Intent en Stripe
    const paymentIntentData = await createPaymentIntentDirect(
      total,
      'usd', // Puedes cambiar a 'bob' si tu cuenta lo soporta
      {
        description: `Pedido de ${carrito.nombre_cliente}`,
        receipt_email: carrito.email_cliente,
        metadata: {
          carrito_id: carrito.id.toString(),
          session_id: sessionId,
          items_count: itemsResult.rows.length.toString()
        }
      }
    );
    
    // Registrar el pago en la BD
    const pagoResult = await client.query(
      `INSERT INTO pagos (
        carrito_id, 
        stripe_payment_intent_id, 
        monto_total, 
        moneda, 
        estado,
        metadata
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id`,
      [
        carrito.id,
        paymentIntentData.id,
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
      clientSecret: paymentIntentData.clientSecret,
      paymentIntentId: paymentIntentData.id,
      pagoId: pagoResult.rows[0].id,
      amount: total
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('POST /create-payment-intent error:', error);
    res.status(500).json({ 
      mensaje: 'Error al crear payment intent', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

/* ============================================
 * POST /api/checkout/confirm
 * Confirmar el pago y crear el pedido
 * Body: { paymentIntentId }
 * ============================================ */
router.post('/checkout/confirm', async (req, res) => {
  const { paymentIntentId } = req.body;
  
  if (!paymentIntentId) {
    return res.status(400).json({ mensaje: 'paymentIntentId requerido' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Verificar el Payment Intent en Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    if (paymentIntent.status !== 'succeeded') {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        mensaje: 'El pago no ha sido completado',
        status: paymentIntent.status
      });
    }
    
    // Obtener el pago de la BD
    const pagoResult = await client.query(
      'SELECT * FROM pagos WHERE stripe_payment_intent_id = $1',
      [paymentIntentId]
    );
    
    if (pagoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Pago no encontrado' });
    }
    
    const pago = pagoResult.rows[0];
    
    // Si ya se procesó, devolver el pedido existente
    if (pago.pedido_id) {
      await client.query('ROLLBACK');
      return res.json({ 
        mensaje: 'Pago ya procesado',
        pedido_id: pago.pedido_id
      });
    }
    
    // Obtener carrito e items
    const carritoResult = await client.query(
      'SELECT * FROM carritos WHERE id = $1',
      [pago.carrito_id]
    );
    
    const carrito = carritoResult.rows[0];
    
    const itemsResult = await client.query(
      `SELECT ci.*, c.nombre
       FROM carrito_items ci
       JOIN comidas c ON c.id = ci.comida_id
       WHERE ci.carrito_id = $1`,
      [carrito.id]
    );
    
    // Crear pedidos individuales por cada item
    const pedidosCreados = [];
    
    for (const item of itemsResult.rows) {
      const pedidoResult = await client.query(
        `INSERT INTO pedido (
          comida_id,
          nombre_cliente,
          email_cliente,
          telefono_cliente,
          direccion,
          cantidad,
          precio_total,
          estado,
          notas
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id`,
        [
          item.comida_id,
          carrito.nombre_cliente,
          carrito.email_cliente,
          carrito.telefono_cliente,
          carrito.direccion,
          item.cantidad,
          parseFloat(item.precio_unitario) * parseInt(item.cantidad),
          'confirmado',
          item.notas
        ]
      );
      
      pedidosCreados.push(pedidoResult.rows[0].id);
    }
    
    // Actualizar pago con el primer pedido_id (o crear una relación multiple si prefieres)
    await client.query(
      `UPDATE pagos 
       SET estado = $1, 
           pedido_id = $2,
           fecha_actualizacion = NOW()
       WHERE id = $3`,
      ['exitoso', pedidosCreados[0], pago.id]
    );
    
    // Marcar carrito como convertido
    await client.query(
      'UPDATE carritos SET estado = $1 WHERE id = $2',
      ['convertido', carrito.id]
    );
    
    await client.query('COMMIT');
    res.json({
      mensaje: 'Pago confirmado y pedido(s) creado(s)',
      pedidos: pedidosCreados,
      pago_id: pago.id
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('POST /checkout/confirm error:', error);
    res.status(500).json({ 
      mensaje: 'Error al confirmar el pago', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

/* ============================================
 * GET /api/checkout/payment-status/:paymentIntentId
 * Verificar el estado de un pago
 * ============================================ */
router.get('/checkout/payment-status/:paymentIntentId', async (req, res) => {
  const { paymentIntentId } = req.params;
  
  try {
    // Verificar en Stripe
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    
    // Buscar en la BD
    const pagoResult = await pool.query(
      'SELECT * FROM pagos WHERE stripe_payment_intent_id = $1',
      [paymentIntentId]
    );
    
    if (pagoResult.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Pago no encontrado' });
    }
    
    const pago = pagoResult.rows[0];
    
    res.json({
      stripe_status: paymentIntent.status,
      pago_estado: pago.estado,
      pedido_id: pago.pedido_id,
      monto: pago.monto_total,
      moneda: pago.moneda
    });
  } catch (error) {
    console.error('GET /payment-status error:', error);
    res.status(500).json({ 
      mensaje: 'Error al verificar estado del pago', 
      error: error.message 
    });
  }
});

module.exports = router;