// checkout.js - Router para procesar pagos con Stripe
const express = require('express');
const pool = require('./db');
const router = express.Router();

// Inicializar Stripe con la clave secreta
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/* ============================================
 * UTILIDADES
 * ============================================ */
const getSessionId = (req) => {
  return req.headers['x-session-id'];
};

/* ============================================
 * GET /api/checkout/config
 * Obtener la publishable key de Stripe
 * ============================================ */
router.get('/checkout/config', (req, res) => {
  try {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY;
    
    if (!publishableKey) {
      console.error('❌ STRIPE_PUBLISHABLE_KEY no está configurada');
      return res.status(500).json({ 
        mensaje: 'Configuración de Stripe no disponible' 
      });
    }
    
    console.log('✅ Enviando publishable key:', publishableKey.substring(0, 20) + '...');
    res.json({ publishableKey });
  } catch (error) {
    console.error('Error en /checkout/config:', error);
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
// Crear Payment Intent (Stripe Elements)
router.post('/checkout/create-payment-intent', async (req, res) => {
  const sessionId = getSessionId(req);

  console.log('📥 Recibida petición create-payment-intent');
  console.log('📍 Session ID:', sessionId);

  if (!sessionId) {
    return res.status(400).json({ mensaje: 'Session ID requerido' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Buscar carrito activo
    const carritoResult = await client.query(
      'SELECT * FROM carritos WHERE session_id = $1 AND estado = $2',
      [sessionId, 'activo']
    );

    if (carritoResult.rows.length === 0) {
      await client.query('ROLLBACK');
      console.log('❌ Carrito no encontrado para session:', sessionId);
      return res.status(404).json({ mensaje: 'Carrito no encontrado' });
    }

    const carrito = carritoResult.rows[0];
    console.log('✅ Carrito encontrado:', carrito.id);

    // Validar info del cliente
    if (!carrito.nombre_cliente || !carrito.email_cliente) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        mensaje: 'Debe proporcionar información del cliente antes de proceder al pago',
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

    console.log('📦 Items en el carrito:', itemsResult.rows.length);

    // Calcular total
    const total = itemsResult.rows.reduce((sum, item) => {
      return sum + parseFloat(item.precio_unitario) * parseInt(item.cantidad);
    }, 0);

    console.log('💰 Total calculado:', total);

    if (total <= 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ mensaje: 'El total debe ser mayor a 0' });
    }

    // Convertir a centavos
    const amountInCents = Math.round(total * 100);

    if (amountInCents < 50) {
      await client.query('ROLLBACK');
      return res.status(400).json({ mensaje: 'El monto mínimo es 0.50 USD' });
    }

    console.log('💳 Creando Payment Intent en Stripe...');
    console.log('   - Monto en centavos:', amountInCents);
    console.log('   - Moneda: usd');

    // ✅ Crear PaymentIntent SOLO con tarjeta (sin métodos automáticos)
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInCents,
      currency: 'usd',
      payment_method_types: ['card'], // evita error 400
      description: `Pedido de ${carrito.nombre_cliente}`,
      receipt_email: carrito.email_cliente,
      metadata: {
        carrito_id: carrito.id.toString(),
        session_id: sessionId,
        items_count: itemsResult.rows.length.toString(),
        customer_name: carrito.nombre_cliente,
      },
    });

    console.log('✅ Payment Intent creado:', paymentIntent.id);

    // Registrar el pago en la BD (opcional)
    await client.query(
      `INSERT INTO pagos (carrito_id, payment_intent_id, monto, estado)
       VALUES ($1, $2, $3, $4)`,
      [carrito.id, paymentIntent.id, total, 'pendiente']
    );

    await client.query('COMMIT');

    // 🔁 Responder al frontend
    return res.json({
      clientSecret: paymentIntent.client_secret,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
    });
  } catch (error) {
    console.error('❌ Error al crear Payment Intent:', error);
    await client.query('ROLLBACK');
    return res.status(500).json({
      mensaje: 'Error al crear el pago en Stripe',
      error: error.message,
    });
  } finally {
    client.release();
  }
});

    console.log('✅ Payment Intent creado:', paymentIntent.id);
    
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
    
    console.log('✅ Pago registrado en BD:', pagoResult.rows[0].id);
    
    await client.query('COMMIT');
    
    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      pagoId: pagoResult.rows[0].id,
      amount: total
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error en create-payment-intent:', error);
    console.error('   Stack:', error.stack);
    
    res.status(500).json({ 
      mensaje: 'Error al crear payment intent', 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
  const sessionId = getSessionId(req);
  
  console.log('📥 Recibida petición confirm');
  console.log('📍 Payment Intent ID:', paymentIntentId);
  console.log('📍 Session ID:', sessionId);
  
  if (!paymentIntentId) {
    return res.status(400).json({ mensaje: 'paymentIntentId requerido' });
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Verificar el Payment Intent en Stripe
    console.log('🔍 Verificando Payment Intent en Stripe...');
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    console.log('   Estado:', paymentIntent.status);
    
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
      return res.status(404).json({ mensaje: 'Pago no encontrado en la base de datos' });
    }
    
    const pago = pagoResult.rows[0];
    console.log('✅ Pago encontrado en BD:', pago.id);
    
    // Si ya se procesó, devolver el pedido existente
    if (pago.pedido_id) {
      await client.query('ROLLBACK');
      console.log('ℹ️ Pago ya procesado anteriormente');
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
    
    console.log('📦 Creando pedidos para', itemsResult.rows.length, 'items...');
    
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
      console.log('   ✅ Pedido creado:', pedidoResult.rows[0].id);
    }
    
    // Actualizar pago con el primer pedido_id
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
    
    console.log('✅ Proceso completado exitosamente');
    
    await client.query('COMMIT');
    res.json({
      mensaje: 'Pago confirmado y pedido(s) creado(s)',
      pedidos: pedidosCreados,
      pago_id: pago.id
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error en confirm:', error);
    console.error('   Stack:', error.stack);
    
    res.status(500).json({ 
      mensaje: 'Error al confirmar el pago', 
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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
    console.log('🔍 Verificando estado de pago:', paymentIntentId);
    
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
    console.error('❌ Error en payment-status:', error);
    res.status(500).json({ 
      mensaje: 'Error al verificar estado del pago', 
      error: error.message 
    });
  }
});

module.exports = router;