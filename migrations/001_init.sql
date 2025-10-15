-- =========================================================
-- ROLES / USERS (opcional si ya existen)
-- =========================================================
CREATE TABLE IF NOT EXISTS roles (
  id   SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  name TEXT NOT NULL
);

INSERT INTO roles (code, name) VALUES
('ADMIN', 'Administrador'),
('USER',  'Usuario')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  id         SERIAL PRIMARY KEY,
  name       TEXT    NOT NULL,
  email      TEXT    NOT NULL UNIQUE,
  password   TEXT    NOT NULL,
  role_id    INTEGER NOT NULL REFERENCES roles(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- =========================================================
-- CATEGORÍAS
-- =========================================================
CREATE TABLE IF NOT EXISTS categoria (
  id      SERIAL PRIMARY KEY,
  nombre  VARCHAR(120) NOT NULL UNIQUE
);

-- Índice por si haces búsquedas por LIKE en minúsculas
CREATE INDEX IF NOT EXISTS idx_categoria_nombre_lower ON categoria (LOWER(nombre));

-- =========================================================
-- COMIDAS (compatible con comida.js y con categorias router)
-- =========================================================
CREATE TABLE IF NOT EXISTS comidas (
  id         SERIAL PRIMARY KEY,
  nombre     VARCHAR(120) NOT NULL,
  categoria  VARCHAR(20),                 -- usado por comida.js (texto)
  categoria_id INTEGER REFERENCES categoria(id), -- usado por categorias.js
  precio     NUMERIC(10,2) NOT NULL CHECK (precio >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT comidas_categoria_chk CHECK (
    categoria IS NULL OR categoria IN ('Desayuno','Almuerzo','Cena','Postre','Bebida','Snack')
  )
);

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_comidas_updated_at ON comidas;
CREATE TRIGGER trg_comidas_updated_at
BEFORE UPDATE ON comidas
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_comidas_categoria_txt ON comidas (categoria);
CREATE INDEX IF NOT EXISTS idx_comidas_categoria_id  ON comidas (categoria_id);

-- =========================================================
-- USUARIOS (plural), requerido por pedidos.js (si no existe)
-- Nota: si ya usas la tabla "users", puedes crear una vista
-- "usuarios" que apunte a "users". Aquí creo una tabla liviana.
-- =========================================================
CREATE TABLE IF NOT EXISTS usuarios (
  id       SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  email    TEXT UNIQUE
);

-- Si prefieres aliasar a "users", comenta el CREATE TABLE de arriba
-- y usa esta vista (ajusta nombres de columnas si difieren):
-- CREATE OR REPLACE VIEW usuarios AS
-- SELECT id, name AS username, password, email FROM users;

-- =========================================================
-- MODELO DE PEDIDOS “COMPLETO”
-- pedidos (encabezado) + pedido_comida (items)
-- =========================================================
CREATE TABLE IF NOT EXISTS pedidos (
  id         SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  estado     VARCHAR(20) NOT NULL DEFAULT 'pendiente'
             CHECK (estado IN ('pendiente','confirmado','en-preparacion','listo','entregado','cancelado')),
  fecha      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pedido_comida (
  id         SERIAL PRIMARY KEY,
  pedido_id  INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  comida_id  INTEGER NOT NULL REFERENCES comidas(id),
  cantidad   INTEGER NOT NULL CHECK (cantidad > 0),
  precio     NUMERIC(10,2) NOT NULL CHECK (precio >= 0) -- precio unitario al momento del pedido
);

CREATE INDEX IF NOT EXISTS idx_pedido_items_pedido_id ON pedido_comida (pedido_id);

-- =========================================================
-- MODELO DE PEDIDOS “SIMPLE” (usado por tus endpoints actuales)
-- Tabla: pedido (singular) con datos del cliente y un solo item
-- =========================================================
CREATE TABLE IF NOT EXISTS pedido (
  id                SERIAL PRIMARY KEY,
  comida_id         INTEGER NOT NULL REFERENCES comidas(id),
  nombre_cliente    TEXT    NOT NULL,
  email_cliente     TEXT    NOT NULL,
  telefono_cliente  TEXT,
  direccion         TEXT,
  cantidad          INTEGER NOT NULL CHECK (cantidad > 0),
  precio_total      NUMERIC(12,2) NOT NULL CHECK (precio_total >= 0),
  estado            VARCHAR(20) NOT NULL DEFAULT 'pendiente'
                    CHECK (estado IN ('pendiente','confirmado','en-preparacion','listo','entregado','cancelado')),
  notas             TEXT,
  fecha_pedido      TIMESTAMP NOT NULL DEFAULT NOW(),
  fecha_actualizacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION set_fecha_actualizacion() RETURNS TRIGGER AS $$
BEGIN
  NEW.fecha_actualizacion := NOW();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pedido_upd ON pedido;
CREATE TRIGGER trg_pedido_upd
BEFORE UPDATE ON pedido
FOR EACH ROW EXECUTE FUNCTION set_fecha_actualizacion();

CREATE INDEX IF NOT EXISTS idx_pedido_estado     ON pedido (estado);
CREATE INDEX IF NOT EXISTS idx_pedido_fecha      ON pedido (fecha_pedido);
CREATE INDEX IF NOT EXISTS idx_pedido_email      ON pedido (LOWER(email_cliente));

-- =========================================================
-- VISTA usada por tus rutas: vista_pedidos_completos
-- Une "pedido" con "comidas" para devolver info enriquecida
-- =========================================================
CREATE OR REPLACE VIEW vista_pedidos_completos AS
SELECT 
  p.id,
  p.comida_id,
  c.nombre      AS nombre_comida,
  c.categoria   AS categoria_comida,
  p.nombre_cliente,
  p.email_cliente,
  p.telefono_cliente,
  p.direccion,
  p.cantidad,
  p.precio_total,
  p.estado,
  p.notas,
  p.fecha_pedido,
  p.fecha_actualizacion
FROM pedido p
JOIN comidas c ON c.id = p.comida_id;

-- =========================================================
-- Datos de ejemplo mínimos (opcional)
-- =========================================================
INSERT INTO categoria (nombre)
VALUES ('Desayuno'),('Almuerzo'),('Cena'),('Postre'),('Bebida'),('Snack')
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO comidas (nombre, categoria, precio)
VALUES
('Sándwich de pollo','Almuerzo',15.50),
('Ensalada fresca','Cena',12.00),
('Jugo de naranja','Bebida',6.00)
ON CONFLICT DO NOTHING;
