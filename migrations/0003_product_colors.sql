ALTER TABLE products ADD COLUMN colors_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE order_items ADD COLUMN colors_json TEXT NOT NULL DEFAULT '[]';

DROP TRIGGER reserve_item;

CREATE TRIGGER reserve_item BEFORE INSERT ON order_items
BEGIN
  UPDATE products
    SET stock = stock - NEW.quantity, version = version + 1
    WHERE id = NEW.product_id AND active = 1 AND stock >= NEW.quantity
      AND COALESCE(sale_price, price) = NEW.unit_price
      AND (json_array_length(colors_json) = 0) = (json_array_length(NEW.colors_json) = 0)
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.colors_json) AS selected
        WHERE NOT EXISTS (
          SELECT 1 FROM json_each(products.colors_json) AS available
          WHERE json_extract(available.value, '$.id') = json_extract(selected.value, '$.id')
        )
      );
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'inventory_changed') END;
END;
