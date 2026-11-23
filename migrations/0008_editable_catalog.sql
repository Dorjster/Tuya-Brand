ALTER TABLE products ADD COLUMN sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0,1));
ALTER TABLE products ADD COLUMN gallery_json TEXT;
ALTER TABLE products ADD COLUMN subtitle TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN badge TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN design_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN display_priority INTEGER NOT NULL DEFAULT 0 CHECK (display_priority BETWEEN 0 AND 9999);

-- Preserve the existing example IDs so saved favorites still work.
INSERT INTO products (id,name,category,description,price,sale_price,stock,active,sample,colors_json,material_photo,gallery_json,created_at) VALUES
  ('sample-khantaaz-studded','Шигтгээтэй хар хантааз','Хантааз','Цэгэн шигтгээ, ялгарах эмжээртэй, зөрүү энгэртэй хар хантаазны жишээ загвар.',159000,NULL,0,1,1,'[{"id":"black","name":"Хар","hex":"#212127","photo":0}]',1,'["/images/khantaaz-studded.webp","/images/detail-studded.webp"]','2000-01-01 00:00:59'),
  ('sample-set-crimson-ivory','Улаан хантаазтай цайвар иж бүрдэл','Иж бүрдэл','Цагаан хээтэй улаан хантаазыг цайвар урт дээлтэй хослуулсан жишээ иж бүрдэл.',359000,NULL,0,1,1,'[{"id":"red","name":"Улаан, цайвар","hex":"#a71d40","photo":0}]',NULL,'["/images/set-crimson-ivory.webp"]','2000-01-01 00:00:58'),
  ('sample-deel-ivory','Сүүн цагаан урт дээл','Дээл','Босоо зах, урт ханцуй, цайвар бүс бүхий бүрэн урт дээлийн жишээ загвар.',269000,NULL,0,1,1,'[{"id":"cream","name":"Цайвар","hex":"#efdfbf","photo":0}]',NULL,'["/images/deel-ivory.webp"]','2000-01-01 00:00:57'),
  ('sample-jacket-magenta','Хээтэй ягаан богино хүрэм','Хүрэм','Босоо зах, урд товчлолтой, энгэр болон ханцуйн хэсэгт цайвар хээтэй ягаан хүрэм.',249000,NULL,0,1,1,'[{"id":"pink","name":"Ягаан","hex":"#a02771","photo":0}]',1,'["/images/jacket-magenta.webp","/images/detail-magenta.webp"]','2000-01-01 00:00:56'),
  ('sample-crimson-khantaaz','Цагаан хээтэй улаан хантааз','Хантааз','Улаан өнгийн, энгэр болон хормойн хэсэгт цагаан хээтэй монгол хантааз. Энгэр нь зөрүүлж товчлогдох хийцтэй.',169000,149000,0,1,1,'[{"id":"red","name":"Улаан","hex":"#a71d40","photo":0},{"id":"copper","name":"Хүрэн","hex":"#945531","photo":1}]',2,'["/images/khantaaz-crimson.webp","/images/khantaaz-copper.webp","/images/detail-crimson.webp"]','2000-01-01 00:00:55'),
  ('sample-blue-khantaaz','Дугуй хээтэй хөх хантааз','Хантааз','Тод хөх суурин дээр дугуй хээтэй, энгэр эмжээрийг бараан хөх өнгөөр тодруулсан монгол хантааз.',159000,NULL,0,1,1,'[{"id":"blue","name":"Хөх","hex":"#264987","photo":0}]',1,'["/images/khantaaz-blue.webp","/images/detail-cobalt.webp"]','2000-01-01 00:00:54'),
  ('sample-black-khantaaz','Цэцгэн хээтэй хар хантааз','Хантааз','Хар суурин дээр өнгө дагасан цэцгэн хээтэй, алтан өнгийн товчоор тодруулсан монгол хантааз.',159000,NULL,0,1,1,'[{"id":"black","name":"Хар","hex":"#212127","photo":0}]',NULL,'["/images/khantaaz-black.webp"]','2000-01-01 00:00:53'),
  ('sample-copper-khantaaz','Алтан хээтэй хүрэн хантааз','Хантааз','Зэсэрхэг хүрэн өнгийн, энгэр болон хормойн хэсэгт алтлаг хээтэй, зөрүү энгэртэй монгол хантааз.',169000,NULL,0,1,1,'[{"id":"copper","name":"Хүрэн","hex":"#945531","photo":0},{"id":"red","name":"Улаан","hex":"#a71d40","photo":1}]',NULL,'["/images/khantaaz-copper.webp","/images/khantaaz-crimson.webp"]','2000-01-01 00:00:52');

INSERT OR IGNORE INTO product_categories (name) SELECT DISTINCT category FROM products WHERE sample=1;
