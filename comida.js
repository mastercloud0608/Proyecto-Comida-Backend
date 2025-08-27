const express = require('express');
const pool = require('./db'); // Conexión a la base de datos
const router = express.Router();

// Ruta GET para obtener todas las comidas
router.get('/comidas', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM comidas');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al obtener las comidas', error: error.message });
  }
});

// Ruta GET para obtener una comida por su ID
router.get('/comidas/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM comidas WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Comida no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al obtener la comida', error: error.message });
  }
});

// Ruta POST para crear una nueva comida
router.post('/comidas', async (req, res) => {
  const { nombre, categoria, precio } = req.body;

  // Verificación de que todos los campos necesarios están presentes
  if (!nombre || !precio) {
    return res.status(400).json({ mensaje: 'El nombre y el precio son requeridos' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO comidas (nombre, categoria, precio) VALUES ($1, $2, $3) RETURNING *',
      [nombre, categoria, precio]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al crear la comida', error: error.message });
  }
});

// Ruta PUT para actualizar una comida
router.put('/comidas/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre, categoria, precio } = req.body;

  // Verificación de que los datos necesarios están presentes
  if (!nombre || !precio) {
    return res.status(400).json({ mensaje: 'El nombre y el precio son requeridos' });
  }

  try {
    const result = await pool.query(
      'UPDATE comidas SET nombre = $1, categoria = $2, precio = $3 WHERE id = $4 RETURNING *',
      [nombre, categoria, precio, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Comida no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al actualizar la comida', error: error.message });
  }
});

// Ruta DELETE para eliminar una comida
router.delete('/comidas/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM comidas WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Comida no encontrada' });
    }
    res.status(204).send(); // No hay contenido, pero la operación fue exitosa
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al eliminar la comida', error: error.message });
  }
});

module.exports = router;
