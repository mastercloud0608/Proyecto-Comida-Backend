const express = require('express');
const pool = require('./db'); // Conexión a la base de datos
const router = express.Router();

// Ruta GET para obtener todas las categorías
router.get('/categorias', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM categoria');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al obtener las categorías', error: error.message });
  }
});

// Ruta GET para obtener una categoría por su ID
router.get('/categorias/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('SELECT * FROM categoria WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Categoría no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al obtener la categoría', error: error.message });
  }
});

// Ruta POST para crear una nueva categoría
router.post('/categorias', async (req, res) => {
  const { nombre } = req.body;

  // Verificación de que el nombre esté presente
  if (!nombre) {
    return res.status(400).json({ mensaje: 'El nombre de la categoría es requerido' });
  }

  try {
    const result = await pool.query(
      'INSERT INTO categoria (nombre) VALUES ($1) RETURNING *',
      [nombre]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al crear la categoría', error: error.message });
  }
});

// Ruta PUT para actualizar una categoría
router.put('/categorias/:id', async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;

  // Verificación de que el nombre esté presente
  if (!nombre) {
    return res.status(400).json({ mensaje: 'El nombre de la categoría es requerido' });
  }

  try {
    const result = await pool.query(
      'UPDATE categoria SET nombre = $1 WHERE id = $2 RETURNING *',
      [nombre, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Categoría no encontrada' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al actualizar la categoría', error: error.message });
  }
});

// Ruta DELETE para eliminar una categoría
router.delete('/categorias/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM categoria WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ mensaje: 'Categoría no encontrada' });
    }
    res.status(204).send(); // No hay contenido, pero la operación fue exitosa
  } catch (error) {
    console.error(error);
    res.status(500).json({ mensaje: 'Error al eliminar la categoría', error: error.message });
  }
});

module.exports = router;
