// pago.js
// Utilidades de pago con Stripe (Payment Intents)
// Mantiene compatibilidad con el flujo actual basado en token (createPaymentMethod + confirm en backend)
// y añade helpers para el flujo moderno con Stripe Elements (confirm en frontend).

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ===== Helpers =====

// Monedas típicas con 2 decimales (USD/BOB/etc.). Si usas otra moneda "cero-decimales", ajusta aquí.
const DECIMALS_BY_CURRENCY = {
  usd: 2,
  bob: 2, // Si tu cuenta Stripe soporta BOB
  eur: 2,
  mxn: 2,
  clp: 0, // ejemplo de moneda sin decimales (ajusta si la usas)
};

/**
 * Convierte un monto en unidades "grandes" (ej: 12.5 USD) a unidades mínimas (centavos).
 * Si ya recibes centavos, puedes pasar {assumeMinorUnits: true}
 */
function toMinorUnits(amount, currency = 'usd', { assumeMinorUnits = false } = {}) {
  const cur = String(currency || 'usd').toLowerCase();
  const decimals = DECIMALS_BY_CURRENCY[cur] ?? 2;

  const num = Number(amount);
  if (!isFinite(num) || num <= 0) {
    throw new Error('Monto inválido');
  }

  if (assumeMinorUnits) {
    // Se asume que amount ya viene en unidades mínimas (centavos)
    return Math.round(num);
  }

  // Regla práctica: si el número es entero grande (>= 1000) y no tiene decimales,
  // puede que ya venga en centavos. Si quieres evitar heurística, usa assumeMinorUnits.
  const hasDecimals = String(amount).includes('.') || String(amount).includes(',');
  if (!hasDecimals && num >= 1000) {
    return Math.round(num); // ya está en centavos
  }

  const factor = Math.pow(10, decimals);
  return Math.round(num * factor);
}

// ===== API clásica (compatibilidad con tu /realizar-pago) =====

/**
 * Crea un cliente de Stripe
 */
const createUser = async (name, email) => {
  try {
    const customer = await stripe.customers.create({ name, email });
    return customer.id;
  } catch (error) {
    console.error('Error al crear el cliente:', error);
    throw error;
  }
};

/**
 * Crea un PaymentMethod a partir de un token de tarjeta (flujo "token", p.ej. card.createToken)
 * Nota: Stripe recomienda hoy usar "Elements + Payment Intents" en lugar de tokens.
 */
const createPaymentMethod = async (cardToken) => {
  try {
    const pm = await stripe.paymentMethods.create({
      type: 'card',
      card: { token: cardToken },
    });
    return pm.id;
  } catch (error) {
    console.error('Error al crear el método de pago:', error);
    throw error;
  }
};

/**
 * Asocia un método de pago al cliente y lo deja opcionalmente como default
 */
const addPaymentMethodToUser = async (customerId, paymentMethodId, { setAsDefault = true } = {}) => {
  try {
    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });

    if (setAsDefault) {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    }
    return true;
  } catch (error) {
    console.error('Error al asociar el método de pago al cliente:', error);
    throw error;
  }
};

/**
 * Crea y CONFIRMA un Payment Intent en el backend (flujo "server-side confirmation").
 * Útil si sigues usando token + payment_method en el servidor.
 * Si quieres confirmar en el FRONT con Elements, usa createPaymentIntentDirect() y confirma allí.
 */
/**
 * Crea y CONFIRMA un Payment Intent en el backend (flujo "server-side confirmation").
 * Útil si sigues usando token + payment_method en el servidor.
 * Si quieres confirmar en el FRONT con Elements, usa createPaymentIntentDirect().
 */
const createPayment = async (
  customerId,
  paymentMethodId,
  productId,
  amount,
  currency = 'usd',
  options = {}
) => {
  try {
    const {
      assumeMinorUnits = false,           // si true, "amount" ya viene en centavos
      description = productId
        ? `Pago de producto ${productId}`
        : 'Pago Proyecto Comida',
      metadata = {},
      receipt_email,
    } = options;

    // Validar y convertir el monto
    const amountMinor = toMinorUnits(amount, currency, { assumeMinorUnits });

    console.log(`💳 Creando y confirmando PaymentIntent para ${amountMinor} ${currency}`);

    // Crear PaymentIntent en Stripe
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountMinor,
      currency: currency.toLowerCase(),
      customer: customerId,
      payment_method: paymentMethodId,
      confirm: true, // confirmación inmediata en backend
      payment_method_types: ['card'], // ✅ solo tarjetas, evita errores 400
      description,
      receipt_email,
      metadata: {
        fuente: 'proyecto-comida',
        ...(productId ? { product_id: String(productId) } : {}),
        ...metadata,
      },
    });

    console.log(`✅ PaymentIntent creado y confirmado: ${paymentIntent.id} (${paymentIntent.status})`);
    return paymentIntent;
  } catch (error) {
    // Errores de tarjeta o validación de Stripe
    console.error('❌ Error al crear/confirmar PaymentIntent:', error);
    throw error;
  }
};

// ===== Consultas de catálogo (opcionales, si usas productos/precios de Stripe) =====

const getProduct = async () => {
  try {
    const products = await stripe.products.list({ limit: 1 });
    return products.data[0]?.id || null;
  } catch (error) {
    console.error('Error al obtener el producto:', error);
    throw error;
  }
};

const getProductPrice = async (productId) => {
  try {
    const prices = await stripe.prices.list({ product: productId, limit: 1 });
    const price = prices.data[0];
    if (!price) return null;
    return {
      priceId: price.id,
      amount: price.unit_amount,
      currency: price.currency,
    };
  } catch (error) {
    console.error('Error al obtener el precio del producto:', error);
    throw error;
  }
};

// ===== Flujo moderno recomendado (Elements + confirm en frontend) =====

/**
 * Devuelve la publishable key para inicializar Stripe.js en el frontend
 */
const getPublishableKey = () => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    console.warn('⚠️ STRIPE_PUBLISHABLE_KEY no está configurada');
    // En desarrollo, puedes retornar una key de prueba hardcodeada
    // return 'pk_test_...'; // Solo para desarrollo
    throw new Error('Falta STRIPE_PUBLISHABLE_KEY en variables de entorno');
  }
  return key;
};

/**
 * Crea un PaymentIntent SIN confirmar, para que el frontend lo confirme con Stripe Elements.
 * amount: en unidades grandes (ej: 12.5) por defecto; usa options.assumeMinorUnits si ya viene en centavos.
 */
const createPaymentIntentDirect = async (amount, currency = 'usd', options = {}) => {
  try {
    const {
      assumeMinorUnits = false,
      customerId,                // opcional
      description = 'Pago Proyecto Comida',
      metadata = {},
      receipt_email,             // opcional
    } = options;

    // Validación de monto
    if (!amount || amount <= 0) {
      throw new Error('El monto debe ser mayor a 0');
    }

    const amountMinor = toMinorUnits(amount, currency, { assumeMinorUnits });

    // Log para debugging
    console.log(`💳 Creando PaymentIntent: ${amountMinor} ${currency} (${amount} original)`);

    const paymentIntentParams = {
      amount: amountMinor,
      currency: currency.toLowerCase(),
      description,
      metadata: {
        fuente: 'proyecto-comida',
        ...metadata,
      },
      automatic_payment_methods: { 
        enabled: true,
        allow_redirects: 'never' // Opcional: evitar métodos que requieran redirección
      },
    };

    // Agregar customer si existe
    if (customerId) {
      paymentIntentParams.customer = customerId;
    }

    // Agregar receipt_email si existe
    if (receipt_email) {
      paymentIntentParams.receipt_email = receipt_email;
    }

    const paymentIntent = await stripe.paymentIntents.create(paymentIntentParams);

    console.log(`✅ PaymentIntent creado: ${paymentIntent.id}`);

    return {
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: paymentIntent.amount,
      currency: paymentIntent.currency,
      status: paymentIntent.status,
    };
  } catch (error) {
    console.error('❌ Error al crear PaymentIntent (direct):', error);
    throw error;
  }
};

/**
 * Recupera un PaymentIntent por su ID
 */
const retrievePaymentIntent = async (paymentIntentId) => {
  try {
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    return paymentIntent;
  } catch (error) {
    console.error('Error al recuperar PaymentIntent:', error);
    throw error;
  }
};

/**
 * Cancela un PaymentIntent
 */
const cancelPaymentIntent = async (paymentIntentId) => {
  try {
    const paymentIntent = await stripe.paymentIntents.cancel(paymentIntentId);
    return paymentIntent;
  } catch (error) {
    console.error('Error al cancelar PaymentIntent:', error);
    throw error;
  }
};

module.exports = {
  // Compatibilidad actual
  createUser,
  createPaymentMethod,
  addPaymentMethodToUser,
  createPayment,
  getProduct,
  getProductPrice,
  // Nuevos helpers recomendados
  getPublishableKey,
  createPaymentIntentDirect,
  retrievePaymentIntent,
  cancelPaymentIntent,
  // Exportar helper para uso externo si es necesario
  toMinorUnits,
};