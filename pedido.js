const express = require('express');
const pool = require('./db'); // Conexión a la base de datos
const router = express.Router();

// Ruta GET para obtener todos los pedidos
router.get('/pedidos', async (req, res) => {
  try {
    const { estado, cliente } = req.query;
    let query = 'SELECT * FROM vista_pedidos_completos';
    let params = [];
    let conditions = [];

    // Filtrar por estado si se proporciona
    if (estado) {
      conditions.push('estado = $' + (params.length + 1));
      params.push(estado);
    }

    // Filtrar por cliente si se proporciona
    if (cliente) {
      conditions.push('(nombre_cliente ILIKE $' + (params.length + 1) + ' OR email_cliente ILIKE $' + (params.length + 2) + ')');
      params.push(`%${cliente}%`);
      params.push(`%${cliente}%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY fecha_pedido DESC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error al obtener pedidos:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener los pedidos', 
      error: error.message 
    });
  }
});

// Ruta GET para obtener un pedido por su ID
router.get('/pedidos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM vista_pedidos_completos WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error al obtener pedido:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener el pedido', 
      error: error.message 
    });
  }
});

// Ruta POST para crear un nuevo pedido
router.post('/pedidos', async (req, res) => {
  const { 
    comida_id, 
    nombre_cliente, 
    email_cliente, 
    telefono_cliente, 
    direccion, 
    cantidad, 
    notas 
  } = req.body;

  // Validación de campos requeridos
  if (!comida_id || !nombre_cliente || !email_cliente || !cantidad) {
    return res.status(400).json({ 
      mensaje: 'Los campos comida_id, nombre_cliente, email_cliente y cantidad son requeridos' 
    });
  }

  if (cantidad <= 0) {
    return res.status(400).json({ 
      mensaje: 'La cantidad debe ser mayor a 0' 
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Verificar que la comida existe y obtener el precio
    const comidaResult = await client.query('SELECT id, precio FROM comida WHERE id = $1', [comida_id]);
    
    if (comidaResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'La comida especificada no existe' });
    }

    const precioUnitario = parseFloat(comidaResult.rows[0].precio);
    const precioTotal = precioUnitario * parseInt(cantidad);

    // Crear el pedido
    const result = await client.query(`
      INSERT INTO pedido (
        comida_id, 
        nombre_cliente, 
        email_cliente, 
        telefono_cliente, 
        direccion, 
        cantidad, 
        precio_total, 
        notas
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING *
    `, [
      comida_id, 
      nombre_cliente, 
      email_cliente, 
      telefono_cliente, 
      direccion, 
      cantidad, 
      precioTotal, 
      notas
    ]);

    await client.query('COMMIT');

    // Obtener el pedido completo con información de la comida
    const pedidoCompleto = await pool.query('SELECT * FROM vista_pedidos_completos WHERE id = $1', [result.rows[0].id]);

    res.status(201).json(pedidoCompleto.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al crear pedido:', error);
    res.status(500).json({ 
      mensaje: 'Error al crear el pedido', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// Ruta PUT para actualizar un pedido
router.put('/pedidos/:id', async (req, res) => {
  const { id } = req.params;
  const { 
    nombre_cliente, 
    email_cliente, 
    telefono_cliente, 
    direccion, 
    cantidad, 
    estado, 
    notas 
  } = req.body;

  // Validación de campos requeridos
  if (!nombre_cliente || !email_cliente || !cantidad) {
    return res.status(400).json({ 
      mensaje: 'Los campos nombre_cliente, email_cliente y cantidad son requeridos' 
    });
  }

  if (cantidad <= 0) {
    return res.status(400).json({ 
      mensaje: 'La cantidad debe ser mayor a 0' 
    });
  }

  // Validar estado si se proporciona
  const estadosValidos = ['pendiente', 'confirmado', 'en-preparacion', 'listo', 'entregado', 'cancelado'];
  if (estado && !estadosValidos.includes(estado)) {
    return res.status(400).json({ 
      mensaje: 'Estado no válido. Estados permitidos: ' + estadosValidos.join(', ')
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Obtener el pedido actual
    const pedidoActual = await client.query('SELECT * FROM pedido WHERE id = $1', [id]);
    
    if (pedidoActual.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    const pedido = pedidoActual.rows[0];

    // Si cambió la cantidad, recalcular el precio total
    let precioTotal = pedido.precio_total;
    if (parseInt(cantidad) !== parseInt(pedido.cantidad)) {
      const comidaResult = await client.query('SELECT precio FROM comida WHERE id = $1', [pedido.comida_id]);
      const precioUnitario = parseFloat(comidaResult.rows[0].precio);
      precioTotal = precioUnitario * parseInt(cantidad);
    }

    // Actualizar el pedido
    const result = await client.query(`
      UPDATE pedido 
      SET nombre_cliente = $1, 
          email_cliente = $2, 
          telefono_cliente = $3, 
          direccion = $4, 
          cantidad = $5, 
          precio_total = $6, 
          estado = $7, 
          notas = $8,
          fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = $9 
      RETURNING *
    `, [
      nombre_cliente, 
      email_cliente, 
      telefono_cliente, 
      direccion, 
      cantidad, 
      precioTotal, 
      estado || pedido.estado, 
      notas, 
      id
    ]);

    await client.query('COMMIT');

    // Obtener el pedido completo actualizado
    const pedidoCompleto = await pool.query('SELECT * FROM vista_pedidos_completos WHERE id = $1', [id]);

    res.json(pedidoCompleto.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error al actualizar pedido:', error);
    res.status(500).json({ 
      mensaje: 'Error al actualizar el pedido', 
      error: error.message 
    });
  } finally {
    client.release();
  }
});

// Ruta PATCH para actualizar solo el estado de un pedido
router.patch('/pedidos/:id/estado', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  // Validar estado
  const estadosValidos = ['pendiente', 'confirmado', 'en-preparacion', 'listo', 'entregado', 'cancelado'];
  if (!estado || !estadosValidos.includes(estado)) {
    return res.status(400).json({ 
      mensaje: 'Estado requerido. Estados permitidos: ' + estadosValidos.join(', ')
    });
  }

  try {
    const result = await pool.query(`
      UPDATE pedido 
      SET estado = $1, fecha_actualizacion = CURRENT_TIMESTAMP
      WHERE id = $2 
      RETURNING *
    `, [estado, id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    // Obtener el pedido completo actualizado
    const pedidoCompleto = await pool.query('SELECT * FROM vista_pedidos_completos WHERE id = $1', [id]);

    res.json(pedidoCompleto.rows[0]);
  } catch (error) {
    console.error('Error al actualizar estado del pedido:', error);
    res.status(500).json({ 
      mensaje: 'Error al actualizar el estado del pedido', 
      error: error.message 
    });
  }
});

// Ruta DELETE para eliminar un pedido
router.delete('/pedidos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM pedido WHERE id = $1 RETURNING *', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    res.status(204).send(); // No hay contenido, pero la operación fue exitosa
  } catch (error) {
    console.error('Error al eliminar pedido:', error);
    res.status(500).json({ 
      mensaje: 'Error al eliminar el pedido', 
      error: error.message 
    });
  }
});

// Ruta GET para obtener estadísticas de pedidos
router.get('/pedidos/estadisticas/resumen', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        estado,
        COUNT(*) as cantidad,
        SUM(precio_total) as total_ventas
      FROM pedido 
      GROUP BY estado
      ORDER BY cantidad DESC
    `);

    const totalPedidos = await pool.query('SELECT COUNT(*) as total FROM pedido');
    const ventasHoy = await pool.query(`
      SELECT 
        COUNT(*) as pedidos_hoy,
        COALESCE(SUM(precio_total), 0) as ventas_hoy
      FROM pedido 
      WHERE DATE(fecha_pedido) = CURRENT_DATE
    `);

    res.json({
      por_estado: result.rows,
      total_pedidos: parseInt(totalPedidos.rows[0].total),
      estadisticas_hoy: ventasHoy.rows[0]
    });
  } catch (error) {
    console.error('Error al obtener estadísticas:', error);
    res.status(500).json({ 
      mensaje: 'Error al obtener estadísticas', 
      error: error.message 
    });
  }
});

module.exports = router;