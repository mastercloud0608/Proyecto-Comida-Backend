const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);  // Cargar la clave secreta de Stripe desde el archivo .env

// Crear un cliente (usuario) en Stripe
const createUser = async (name, email) => {
  try {
    const customer = await stripe.customers.create({
      name: name,
      email: email
    });

    console.log(`Cliente creado correctamente: ${customer.id}`);
    return customer.id;
  } catch (error) {
    console.error('Error al crear el cliente:', error.message);
  }
};

// Crear un método de pago (tarjeta)
const createPaymentMethod = async (cardToken) => {
  try {
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: { token: cardToken }
    });

    console.log(`Método de pago creado con ID: ${paymentMethod.id}`);
    return paymentMethod.id;
  } catch (error) {
    console.error('Error al crear el método de pago:', error.message);
  }
};

// Asociar un método de pago a un cliente (usuario)
const addPaymentMethodToUser = async (customerId, paymentMethodId) => {
  try {
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId
    });

    console.log('Método de pago asociado correctamente al cliente.');
  } catch (error) {
    console.error('Error al asociar el método de pago al cliente:', error.message);
  }
};

// Crear un pago (Payment Intent)
const createPayment = async (customerId, paymentMethodId, productId, amount, currency) => {
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: currency,
      customer: customerId,
      payment_method: paymentMethodId,
      payment_method_types: ['card'],
      confirm: true,
      metadata: { product_id: productId }
    });

    console.log(`Pago realizado correctamente con ID: ${paymentIntent.id}`);
    return paymentIntent;
  } catch (error) {
    if (error.type === 'StripeCardError') {
      console.error('Error de tarjeta:', error.message);
    } else {
      console.error('Error en Stripe:', error.message);
    }
  }
};

// Obtener el ID del producto
const getProduct = async () => {
  try {
    const products = await stripe.products.list({ limit: 1 });
    return products.data[0].id;
  } catch (error) {
    console.error('Error al obtener el producto:', error.message);
  }
};

// Obtener el precio de un producto
const getProductPrice = async (productId) => {
  try {
    const prices = await stripe.prices.list({ product: productId, limit: 1 });
    const price = prices.data[0];
    return { priceId: price.id, amount: price.unit_amount, currency: price.currency };
  } catch (error) {
    console.error('Error al obtener el precio del producto:', error.message);
  }
};

module.exports = {
  createUser,
  createPaymentMethod,
  addPaymentMethodToUser,
  createPayment,
  getProduct,
  getProductPrice
};
