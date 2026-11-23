ALTER TABLE products ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1));

CREATE TABLE product_categories (
  name TEXT PRIMARY KEY
);

INSERT OR IGNORE INTO product_categories (name)
SELECT DISTINCT category FROM products WHERE category <> '';

INSERT OR IGNORE INTO product_categories (name) VALUES ('Ангилалгүй');

CREATE TABLE storefront_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  heading TEXT NOT NULL,
  description TEXT NOT NULL,
  action TEXT NOT NULL,
  alt TEXT NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN ('wine','ink','forest')),
  position TEXT NOT NULL CHECK (position IN ('left','center','right')),
  hero_type TEXT,
  hero_bytes BLOB,
  version INTEGER NOT NULL DEFAULT 1
);

INSERT INTO storefront_settings (id,heading,description,action,alt,theme,position)
VALUES (1,'Монгол үндэсний хувцас','Уламжлалт хийц, хээ угалзтай үндэсний хувцасны цуглуулга.',
  'Цуглуулга үзэх','Цагаан хээтэй улаан монгол хантаазны загвар зураг','wine','center');
