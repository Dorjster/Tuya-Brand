ALTER TABLE products ADD COLUMN sku TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN sizes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE products ADD COLUMN size_guide TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN material TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN care TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN material_photo INTEGER;

CREATE UNIQUE INDEX products_sku_unique ON products(sku COLLATE NOCASE) WHERE sku <> '';

ALTER TABLE order_items ADD COLUMN variants_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE order_items ADD COLUMN inventory_version INTEGER;

DROP TRIGGER reserve_item;

CREATE TRIGGER reserve_item BEFORE INSERT ON order_items
BEGIN
  UPDATE products
    SET stock = stock - NEW.quantity, version = version + 1
    WHERE id = NEW.product_id AND active = 1 AND archived = 0 AND stock >= NEW.quantity
      AND (NEW.inventory_version IS NULL OR version = NEW.inventory_version)
      AND COALESCE(sale_price, price) = NEW.unit_price
      AND (json_array_length(colors_json) = 0) = (json_array_length(NEW.colors_json) = 0)
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.colors_json) AS selected
        WHERE NOT EXISTS (
          SELECT 1 FROM json_each(products.colors_json) AS available
          WHERE json_extract(available.value, '$.id') = json_extract(selected.value, '$.id')
        )
      )
      AND (json_array_length(sizes_json) = 0) = (json_array_length(NEW.variants_json) = 0)
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.variants_json) AS selected
        WHERE NOT EXISTS (
          SELECT 1 FROM json_each(products.sizes_json) AS available
          WHERE available.value = json_extract(selected.value, '$.size')
        )
      );
  SELECT CASE WHEN changes() <> 1 THEN RAISE(ABORT, 'inventory_changed') END;
END;
