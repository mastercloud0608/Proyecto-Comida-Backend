const express = require('express');
const pool = require('./db'); // Conexión a la base de datos
const router = express.Router();

// Ruta POST para crear un pedido
router.post('/pedidos', async (req, res) => {
  const { usuario_id, comidas } = req.body; // comidas es un array de objetos con comida_id y cantidad

  // Validación de entrada
  if (!usuario_id || !comidas || comidas.length === 0) {
    return res.status(400).json({ mensaje: 'El usuario y la lista de comidas son requeridos' });
  }

  try {
    // Crear el pedido
    const resultPedido = await pool.query(
      'INSERT INTO pedidos (usuario_id) VALUES ($1) RETURNING id, estado, fecha',
      [usuario_id]
    );
    const pedido = resultPedido.rows[0];

    // Agregar las comidas al pedido
    for (const comida of comidas) {
      const { comida_id, cantidad } = comida;

      // Obtener el precio de la comida
      const comidaResult = await pool.query('SELECT precio FROM comidas WHERE id = $1', [comida_id]);

      if (comidaResult.rows.length === 0) {
        return res.status(400).json({ mensaje: `Comida con id ${comida_id} no encontrada` });
      }

      const precio = comidaResult.rows[0].precio;

      // Insertar la comida en la tabla pedido_comida
      await pool.query(
        'INSERT INTO pedido_comida (pedido_id, comida_id, cantidad, precio) VALUES ($1, $2, $3, $4)',
        [pedido.id, comida_id, cantidad, precio]
      );
    }

    res.status(201).json({
      mensaje: 'Pedido creado exitosamente',
      pedido: {
        id: pedido.id,
        estado: pedido.estado,
        fecha: pedido.fecha,
        comidas: comidas,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al crear el pedido', error: error.message });
  }
});

// Ruta GET para obtener todos los pedidos de un usuario
router.get('/pedidos/:usuario_id', async (req, res) => {
  const { usuario_id } = req.params;

  try {
    // Obtener todos los pedidos del usuario
    const resultPedidos = await pool.query('SELECT * FROM pedidos WHERE usuario_id = $1', [usuario_id]);

    if (resultPedidos.rows.length === 0) {
      return res.status(404).json({ mensaje: 'No se encontraron pedidos para este usuario' });
    }

    // Obtener los detalles de cada pedido
    for (let i = 0; i < resultPedidos.rows.length; i++) {
      const pedido = resultPedidos.rows[i];
      const comidasResult = await pool.query(
        'SELECT c.nombre, c.precio, pc.cantidad FROM pedido_comida pc JOIN comidas c ON pc.comida_id = c.id WHERE pc.pedido_id = $1',
        [pedido.id]
      );
      pedido.comidas = comidasResult.rows;
    }

    res.json(resultPedidos.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al obtener los pedidos', error: error.message });
  }
});

// Ruta PUT para actualizar el estado de un pedido
router.put('/pedidos/:id', async (req, res) => {
  const { id } = req.params;
  const { estado } = req.body;

  // Validación de estado
  const estadosValidos = ['pendiente', 'en preparación', 'completado'];

  if (!estadosValidos.includes(estado)) {
    return res.status(400).json({ mensaje: 'Estado no válido. Los estados válidos son: pendiente, en preparación, completado' });
  }

  try {
    const result = await pool.query(
      'UPDATE pedidos SET estado = $1 WHERE id = $2 RETURNING *',
      [estado, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al actualizar el estado del pedido', error: error.message });
  }
});

// Ruta DELETE para cancelar un pedido
router.delete('/pedidos/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM pedidos WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Pedido no encontrado' });
    }

    res.status(204).send(); // No content, but the operation was successful
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al cancelar el pedido', error: error.message });
  }
});

module.exports = router;
