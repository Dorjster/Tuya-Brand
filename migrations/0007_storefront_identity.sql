ALTER TABLE storefront_settings ADD COLUMN brand_name TEXT NOT NULL DEFAULT 'Tuya Brand';
ALTER TABLE storefront_settings ADD COLUMN announcement TEXT NOT NULL DEFAULT '';
ALTER TABLE storefront_settings ADD COLUMN location TEXT NOT NULL DEFAULT 'Улаанбаатар, Монгол';
ALTER TABLE storefront_settings ADD COLUMN contact TEXT NOT NULL DEFAULT '';
ALTER TABLE storefront_settings ADD COLUMN delivery_note TEXT NOT NULL DEFAULT '';
ALTER TABLE storefront_settings ADD COLUMN layout TEXT NOT NULL DEFAULT 'overlay' CHECK (layout IN ('overlay','split'));
ALTER TABLE storefront_settings ADD COLUMN mobile_position TEXT NOT NULL DEFAULT 'center' CHECK (mobile_position IN ('left','center','right'));
ALTER TABLE storefront_settings ADD COLUMN write_key TEXT;

CREATE TABLE storefront_logo (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  type TEXT,
  bytes BLOB
);

INSERT INTO storefront_logo (id) VALUES (1);
