CREATE TABLE products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL CHECK (price BETWEEN 1 AND 999999999),
  sale_price INTEGER CHECK (sale_price BETWEEN 1 AND price - 1),
  stock INTEGER NOT NULL CHECK (stock BETWEEN 0 AND 999999),
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  cover TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  write_key TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE photos (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,
  bytes BLOB NOT NULL,
  UNIQUE (product_id, position)
);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  fulfillment TEXT NOT NULL CHECK (fulfillment IN ('pickup','delivery')),
  address TEXT NOT NULL,
  notes TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'placed' CHECK (status IN ('placed','fulfilled','cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  unit_price INTEGER NOT NULL,
  PRIMARY KEY (order_id, product_id)
);

CREATE TRIGGER reserve_item BEFORE INSERT ON order_items
BEGIN
  UPDATE products
    SET stock = stock - NEW.quantity, version = version + 1
    WHERE id = NEW.product_id AND active = 1 AND stock >= NEW.quantity
      AND COALESCE(sale_price, price) = NEW.unit_price;
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'inventory_changed') END;
END;

CREATE TRIGGER release_order AFTER UPDATE OF status ON orders
WHEN OLD.status = 'placed' AND NEW.status = 'cancelled'
BEGIN
  UPDATE products
    SET stock = stock + (SELECT quantity FROM order_items WHERE order_id = NEW.id AND product_id = products.id),
        version = version + 1
    WHERE id IN (SELECT product_id FROM order_items WHERE order_id = NEW.id);
END;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  slot INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
