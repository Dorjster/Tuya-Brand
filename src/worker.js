const tokenPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9-]{1,64}$/;
const maximumStock = 999999;
const maximumColors = 12;
const uncategorized = 'Ангилалгүй';
const themes = ['wine','ink','forest'];
const positions = ['left','center','right'];
const imageLimit = 1_500_000;
const maximumPhotos = 8;
const uploadLimit = maximumPhotos * imageLimit + 100_000;
const sessionLifetime = 8 * 3600;
const photoTypes = {
  'image/jpeg': b => b[0] === 255 && b[1] === 216 && b[2] === 255,
  'image/png': b => [137,80,78,71,13,10,26,10].every((byte,i) => b[i] === byte),
  'image/webp': b => String.fromCharCode(...b.subarray(0,4)) === 'RIFF'
    && String.fromCharCode(...b.subarray(8,12)) === 'WEBP',
};

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function fail(status, message) {
  throw new RequestError(status, message);
}

function json(value, status = 200, headers = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

function safeText(value, max, label, min = 0) {
  const clean = typeof value === 'string' ? value.trim() : '';
  if (clean.length < min || clean.length > max) fail(400, 'Check the ' + label + ' field.');
  return clean;
}

function integer(value, min, max, label) {
  if (typeof value === 'string' && /^\d+$/.test(value)) value = Number(value);
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(400, 'Check the ' + label + ' field.');
  return value;
}

async function digest(value) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return new Uint8Array(hash);
}

function hex(bytes) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sameSecret(a, b) {
  const [left, right] = await Promise.all([digest(a), digest(b)]);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function sessionToken(request) {
  const value = request.headers.get('Cookie')?.match(/(?:^|;\s*)store_session=([^;]+)/)?.[1];
  return tokenPattern.test(value ?? '') ? value : null;
}

function cookie(request, token, age) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return 'store_session=' + token + '; Max-Age=' + age + '; Path=/; HttpOnly; SameSite=Strict' + secure;
}

function adminCode(env) {
  const code = env.ADMIN_PASSCODE;
  return typeof code === 'string' && /^\d{4}$/.test(code) ? code : null;
}

async function adminSession(request, env) {
  const token = sessionToken(request);
  if (!token || !adminCode(env) || (env.SITE_OWNER_EMAIL && !siteOwner(request,env))) return false;
  const gate = env.SITE_OWNER_EMAIL ? 'owner-code' : 'public-pin';
  return Boolean(await env.DB.prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires > ? AND gate = ?')
    .bind(hex(await digest(token)), Math.floor(Date.now()/1000), gate).first());
}

async function readJson(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) fail(415, 'Send JSON data.');
  if (Number(request.headers.get('Content-Length')) > 32768) fail(413, 'Request is too large.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Invalid request data.');
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32768) {
      await reader.cancel();
      fail(413, 'Request is too large.');
    }
    text += decoder.decode(value, {stream: true});
  }
  try {
    const data = JSON.parse(text + decoder.decode());
    if (!data || Array.isArray(data) || typeof data !== 'object') fail(400, 'Invalid request data.');
    return data;
  } catch {
    fail(400, 'Invalid request data.');
  }
}

async function login(request, env) {
  const owner = siteOwner(request,env);
  if (env.SITE_OWNER_EMAIL && !owner) fail(403, 'Админ хэсэгт эзэмшигчийн бүртгэлээр нэвтэрнэ үү.');
  const code = adminCode(env);
  if (!code) fail(503, 'Админ нэвтрэх тохиргоо дутуу байна.');
  const { passcode } = await readJson(request);
  const db = env.DB;
  const now = Math.floor(Date.now()/1000);
  const slot = Math.floor(now/900);
  const key = hex(await digest(request.headers.get('CF-Connecting-IP') ?? 'local'));
  if (typeof passcode !== 'string' || !/^\d{4}$/.test(passcode)) fail(400,'4 оронтой PIN оруулна уу.');
  const attempt = db.prepare(`INSERT INTO login_attempts VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN slot=excluded.slot THEN attempts+1 ELSE 1 END,
    slot=excluded.slot
    WHERE login_attempts.slot<>excluded.slot OR login_attempts.attempts < ?
    RETURNING attempts`);
  const [, perAddress, allAddresses] = await db.batch([
    db.prepare('DELETE FROM login_attempts WHERE slot < ?').bind(slot - 1),
    attempt.bind(key,slot,5),
    attempt.bind('admin-pin-global',slot,12),
  ]);
  if (!perAddress.results.length || !allAddresses.results.length) fail(429,'Оролдлогын хязгаарт хүрсэн байна. Түр хүлээгээд дахин оролдоно уу.');
  if (!await sameSecret(passcode, code)) fail(401, 'Админ код буруу байна.');
  const gate = owner ? 'owner-code' : 'public-pin';
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires <= ?').bind(now),
    db.prepare('DELETE FROM login_attempts WHERE key IN (?, ?)').bind(key,'admin-pin-global'),
    db.prepare('INSERT INTO sessions (token_hash,expires,gate) VALUES (?,?,?)').bind(hex(await digest(token)), now + sessionLifetime, gate),
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, token, sessionLifetime) });
}

async function products(db, admin) {
  const [{ results }, { results: photos }] = await db.batch([
    db.prepare(`SELECT id,name,category,description,price,sale_price,stock,cover,colors_json,sku,sizes_json,size_guide,material,care,material_photo,sample,gallery_json,subtitle,badge,design_notes,display_priority${admin ? ',active,version,archived' : ''}
      FROM products ${admin ? '' : 'WHERE active = 1 AND archived = 0'} ORDER BY display_priority DESC, created_at DESC, id DESC`),
    db.prepare(`SELECT photos.id,product_id FROM photos JOIN products ON products.id = photos.product_id
      ${admin ? '' : 'WHERE products.active = 1 AND products.archived = 0'} ORDER BY position`),
  ]);
  const photosByProduct = new Map();
  for (const photo of photos) {
    if (!photosByProduct.has(photo.product_id)) photosByProduct.set(photo.product_id, []);
    photosByProduct.get(photo.product_id).push('/media/' + photo.id);
  }
  return results.map(({cover, colors_json, sizes_json, gallery_json, ...product}) => {
    const images = photosByProduct.get(product.id) ?? [];
    return { ...product, images: gallery_json ? JSON.parse(gallery_json) : images.length ? images : cover ? [cover] : [], colors: JSON.parse(colors_json), sizes: JSON.parse(sizes_json) };
  });
}

function readProductColors(raw) {
  let entries;
  try { entries = JSON.parse(raw); } catch { fail(400, 'Өнгөний мэдээллийг шалгана уу.'); }
  if (!Array.isArray(entries) || entries.length > maximumColors) fail(400, 'Өнгөний мэдээллийг шалгана уу.');
  const ids = new Set();
  return entries.map(color => {
    if (!color || typeof color.id !== 'string' || !idPattern.test(color.id) || ids.has(color.id) ||
      typeof color.hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(color.hex)) {
      fail(400, 'Өнгөний мэдээллийг шалгана уу.');
    }
    const photo = color.photo == null ? null : integer(color.photo, 0, maximumPhotos - 1, 'өнгөний зураг');
    ids.add(color.id);
    return {id:color.id, name:safeText(color.name,35,'өнгөний нэр',1), hex:color.hex, photo};
  });
}

async function readMultipart(request, limit, sizeMessage) {
  if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data;')) fail(415, 'Send product form data.');
  if (Number(request.headers.get('Content-Length')) > limit || !request.body) {
    fail(413,sizeMessage);
  }
  let uploadedBytes = 0;
  const limitedBody = request.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      uploadedBytes += chunk.byteLength;
      if (uploadedBytes > limit) fail(413,sizeMessage);
      controller.enqueue(chunk);
    },
  }));
  return new Response(limitedBody, {headers: {'Content-Type': request.headers.get('Content-Type')}})
    .formData().catch(error => {
      if (error instanceof RequestError) throw error;
      fail(400, 'Invalid product form data.');
    });
}

async function validatedPhoto(photo) {
  if (!(photo instanceof File) || photo.size > imageLimit || photo.size < 12 || !Object.hasOwn(photoTypes,photo.type)) {
    fail(400,'Зураг JPEG, PNG эсвэл WebP форматтай, 1.5 МБ хүртэл хэмжээтэй байна.');
  }
  const bytes = await photo.arrayBuffer();
  if (!photoTypes[photo.type](new Uint8Array(bytes))) fail(400,'Зураг уншигдсангүй.');
  return {type:photo.type,bytes};
}

async function saveProduct(request, db, id) {
  const form = await readMultipart(request,uploadLimit,'Тус бүр 1.5 МБ хүртэл хэмжээтэй 8 зураг сонгоно уу.');
  const price = integer(form.get('price'), 1, 999999999, 'price');
  const sale = form.get('sale_price');
  const values = [
    safeText(form.get('name'), 100, 'product name', 1),
    safeText(form.get('category'), 45, 'category', 1),
    safeText(form.get('description'), 2000, 'description'),
    price,
    sale ? integer(sale, 1, price - 1, 'sale price') : null,
    integer(form.get('stock'), 0, maximumStock, 'stock count'),
    form.get('active') === '1' ? 1 : 0,
  ];
  const photos = form.getAll('photos');
  if (photos.length > maximumPhotos) fail(400, '8 хүртэл зураг оруулна уу.');
  const uploads = [];
  for (const photo of photos) uploads.push({id:crypto.randomUUID(), ...await validatedPhoto(photo)});
  const productId = id || crypto.randomUUID();
  const version = id ? integer(form.get('version'), 1, Number.MAX_SAFE_INTEGER, 'product version') : null;
  // Version guards the photo order and image ownership throughout the edit.
  const previous = id ? await db.prepare(`SELECT colors_json,sizes_json,sku,size_guide,material,care,material_photo,cover,
    sample,gallery_json,subtitle,badge,design_notes,display_priority
    FROM products WHERE id=? AND version=? AND archived=0`).bind(id,version).first() : null;
  if (id && !previous) fail(409, 'Барааны мэдээлэл өөрчлөгдсөн байна. Жагсаалтыг шинэчилнэ үү.');
  const existingPhotos = id ? (await db.prepare('SELECT id FROM photos WHERE product_id=? ORDER BY position')
    .bind(id).all()).results.map(photo => '/media/' + photo.id) : [];
  const previousGallery = previous?.gallery_json ? JSON.parse(previous.gallery_json) :
    existingPhotos.length ? existingPhotos : previous?.cover ? [previous.cover] : [];
  const uploadedPaths = uploads.map(photo => '/media/' + photo.id);
  let gallery = previousGallery;
  if (form.has('gallery')) {
    let order;
    try { order = JSON.parse(form.get('gallery')); } catch { fail(400,'Зургийн дарааллыг шалгана уу.'); }
    if (!Array.isArray(order) || order.length > maximumPhotos) fail(400,'8 хүртэл зураг оруулна уу.');
    gallery = order.map(entry => Number.isInteger(entry) ? uploadedPaths[entry] : previousGallery.find(path => path === entry));
    if (gallery.some(path => !path) || new Set(gallery).size !== gallery.length ||
      uploadedPaths.some(path => !gallery.includes(path))) fail(400,'Зургийн дарааллыг шалгана уу.');
  } else if (uploads.length || form.get('clear_photos') === '1') {
    gallery = uploadedPaths;
  }
  const photoCount = gallery.length;
  const colors = readProductColors(form.get('colors') ?? previous?.colors_json ?? '[]');
  for (const color of colors) {
    if (color.photo === null) continue;
    if (form.has('colors')) {
      if (color.photo >= photoCount) fail(400, 'Өнгөтэй холбох зургаа эхлээд сонгоно уу.');
    } else if (form.has('gallery') || gallery === previousGallery) {
      const position = gallery.indexOf(previousGallery[color.photo]);
      color.photo = position < 0 ? null : position;
    } else if (color.photo >= photoCount) color.photo = null;
  }
  let sizes;
  try { sizes = JSON.parse(form.get('sizes') ?? previous?.sizes_json ?? '[]'); }
  catch { fail(400,'Размерын мэдээллийг шалгана уу.'); }
  if (!Array.isArray(sizes) || sizes.length > 16 || sizes.some(size=>typeof size!=='string'||!size.trim()||size.trim().length>24)) {
    fail(400,'16 хүртэл размер оруулж болно. Размер бүр 24 хүртэл тэмдэгт байна.');
  }
  sizes = sizes.map(size=>size.trim());
  if (new Set(sizes.map(size=>size.toLowerCase())).size!==sizes.length) fail(400,'Размер давхардаж байна.');
  const photoInput = form.get('material_photo');
  const retainedPhoto = previous?.material_photo != null ? gallery.indexOf(previousGallery[previous.material_photo]) : -1;
  const materialPhoto = photoInput === '' ? null : photoInput == null ? (retainedPhoto < 0 ? null : retainedPhoto) : integer(photoInput,0,maximumPhotos - 1,'материалын зургийн дугаар');
  if (materialPhoto !== null && materialPhoto >= photoCount) fail(400,'Материалын ойрын зургийг сонгоно уу.');
  const sku = safeText(form.get('sku') ?? previous?.sku,64,'SKU');
  values.push(JSON.stringify(colors),sku,JSON.stringify(sizes),
    safeText(form.get('size_guide') ?? previous?.size_guide,1600,'размерын заавар'),
    safeText(form.get('material') ?? previous?.material,280,'материал'),
    safeText(form.get('care') ?? previous?.care,650,'арчилгаа'),materialPhoto,
    form.has('sample') ? Number(form.get('sample') === '1') : previous?.sample ?? 0, JSON.stringify(gallery),
    safeText(form.get('subtitle') ?? previous?.subtitle,140,'товч танилцуулга'),
    safeText(form.get('badge') ?? previous?.badge,28,'шошго'),
    safeText(form.get('design_notes') ?? previous?.design_notes,1200,'хийцийн мэдээлэл'),
    integer(form.get('display_priority') ?? previous?.display_priority ?? 0,0,9999,'эрэмбэ'));
  if (sku && await db.prepare('SELECT 1 FROM products WHERE sku=? COLLATE NOCASE AND id<>?').bind(sku,productId).first()) {
    fail(409,'SKU код өөр бараанд бүртгэлтэй байна.');
  }
  const lock = crypto.randomUUID();
  const changes = id
    ? db.prepare(`UPDATE products SET name=?,category=?,description=?,price=?,sale_price=?,stock=?,active=?,colors_json=?,sku=?,sizes_json=?,size_guide=?,material=?,care=?,material_photo=?,
        sample=?,gallery_json=?,subtitle=?,badge=?,design_notes=?,display_priority=?,cover=NULL, version=version+1, write_key=? WHERE id=? AND version=? AND archived=0`)
      .bind(...values, lock, id, version)
    : db.prepare('INSERT INTO products (name,category,description,price,sale_price,stock,active,colors_json,sku,sizes_json,size_guide,material,care,material_photo,sample,gallery_json,subtitle,badge,design_notes,display_priority,id,write_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(...values, productId, lock);
  const batch = [changes, db.prepare(`INSERT OR IGNORE INTO product_categories (name)
    SELECT category FROM products WHERE id=? AND write_key=?`).bind(productId,lock)];
  for (const path of existingPhotos.filter(path => !gallery.includes(path))) {
    batch.push(db.prepare('DELETE FROM photos WHERE id=? AND product_id IN (SELECT id FROM products WHERE id=? AND write_key=?)')
      .bind(path.slice(7), productId, lock));
  }
  if (JSON.stringify(gallery) !== JSON.stringify(previousGallery)) {
    // Free the position range before inserting or moving photos within the same transaction.
    if (existingPhotos.length) batch.push(db.prepare('UPDATE photos SET position=position+100 WHERE product_id IN (SELECT id FROM products WHERE id=? AND write_key=?)')
      .bind(productId,lock));
    uploads.forEach(photo => batch.push(db.prepare(`INSERT INTO photos (id,product_id,position,type,bytes)
      SELECT ?,id,?,?,? FROM products WHERE id=? AND write_key=?`).bind(photo.id, gallery.indexOf('/media/' + photo.id), photo.type, photo.bytes, productId, lock)));
    for (const path of existingPhotos.filter(path => gallery.includes(path))) {
      batch.push(db.prepare('UPDATE photos SET position=? WHERE id=? AND product_id IN (SELECT id FROM products WHERE id=? AND write_key=?)')
        .bind(gallery.indexOf(path),path.slice(7),productId,lock));
    }
  }
  let result;
  try { [result] = await db.batch(batch); }
  catch(error) {
    if (String(error).includes('products.sku')) fail(409,'SKU код өөр бараанд бүртгэлтэй байна.');
    throw error;
  }
  if (!result.meta.changes) fail(409, 'This product changed since you opened it. Refresh the inventory and try again.');
  return json({ id: productId }, id ? 200 : 201);
}

async function categoryList(db) {
  const {results} = await db.prepare(`SELECT c.name,COUNT(p.id) AS product_count FROM product_categories AS c
    LEFT JOIN products AS p ON p.category=c.name AND p.archived=0 GROUP BY c.name ORDER BY c.name`).all();
  return results;
}

async function addCategory(request,db) {
  const {name} = await readJson(request);
  const category = safeText(name,45,'ангилал',1);
  const result = await db.prepare('INSERT OR IGNORE INTO product_categories (name) VALUES (?)').bind(category).run();
  if (!result.meta.changes) fail(409,'Энэ ангилал бүртгэлтэй байна.');
  return json({name:category},201);
}

async function removeCategory(request,db) {
  const {name} = await readJson(request);
  const category = safeText(name,45,'ангилал',1);
  if (category === uncategorized) fail(400,'Үндсэн ангиллыг хасах боломжгүй.');
  await db.batch([
    db.prepare('UPDATE products SET category=?,version=version+1 WHERE category=?').bind(uncategorized,category),
    db.prepare('DELETE FROM product_categories WHERE name=?').bind(category),
  ]);
  return json({ok:true});
}

async function setProductArchive(request,db,id) {
  const {archived,version} = await readJson(request);
  if (typeof archived !== 'boolean') fail(400,'Барааны төлөвийг шалгана уу.');
  const result = await db.prepare(`UPDATE products SET archived=?,active=0,version=version+1
    WHERE id=? AND version=? AND archived<>?`)
    .bind(Number(archived),id,integer(version,1,Number.MAX_SAFE_INTEGER,'хувилбар'),Number(archived)).run();
  if (!result.meta.changes) fail(409,'Барааны мэдээлэл өөрчлөгдсөн байна. Жагсаалтыг шинэчилнэ үү.');
  return json({ok:true});
}

async function deleteProduct(request,db,id) {
  const {version} = await readJson(request);
  const result = await db.prepare(`DELETE FROM products WHERE id=? AND archived=1 AND version=?
    AND NOT EXISTS (SELECT 1 FROM order_items WHERE product_id=products.id)`)
    .bind(id,integer(version,1,Number.MAX_SAFE_INTEGER,'хувилбар')).run();
  if (!result.meta.changes) fail(409,'Захиалгын түүхтэй эсвэл мэдээлэл нь өөрчлөгдсөн барааг устгах боломжгүй.');
  return json({ok:true});
}

async function storefrontSettings(db) {
  const {custom_hero,custom_logo,...settings} = await db.prepare(`SELECT s.heading,s.description,s.action,s.alt,s.theme,s.position,s.version,
    s.brand_name,s.announcement,s.location,s.contact,s.delivery_note,s.layout,s.mobile_position,
    s.hero_bytes IS NOT NULL AS custom_hero,l.bytes IS NOT NULL AS custom_logo
    FROM storefront_settings s JOIN storefront_logo l ON l.id=s.id WHERE s.id=1`).first();
  return {...settings,image:custom_hero ? '/storefront/hero?v=' + settings.version : null,
    logo:custom_logo ? '/storefront/logo?v=' + settings.version : null};
}

async function saveStorefront(request,db) {
  const form = await readMultipart(request,3_050_000,'Нүүр зураг, лого тус бүр 1.5 МБ хүртэл байна.');
  const current = await storefrontSettings(db);
  const theme = form.get('theme');
  const position = form.get('position');
  const layout = form.get('layout') ?? current.layout;
  const mobile = form.get('mobile_position') ?? current.mobile_position;
  if (!themes.includes(theme) || !positions.includes(position) || !positions.includes(mobile) || !['overlay','split'].includes(layout)) {
    fail(400,'Нүүр хуудасны загвар, зургийн байрлалыг шалгана уу.');
  }
  const version = integer(form.get('version'),1,Number.MAX_SAFE_INTEGER,'хувилбар');
  const image = form.get('image');
  const logoFile = form.get('logo');
  const photo = image == null ? null : await validatedPhoto(image);
  const logo = logoFile == null ? null : await validatedPhoto(logoFile);
  const clear = Number(Boolean(photo) || form.get('remove_image') === '1');
  const lock = crypto.randomUUID();
  const writes = [db.prepare(`UPDATE storefront_settings SET heading=?,description=?,action=?,alt=?,theme=?,position=?,
    brand_name=?,announcement=?,location=?,contact=?,delivery_note=?,layout=?,mobile_position=?,
    hero_type=CASE WHEN ? THEN ? ELSE hero_type END,hero_bytes=CASE WHEN ? THEN ? ELSE hero_bytes END,
    version=version+1,write_key=? WHERE id=1 AND version=?`)
    .bind(safeText(form.get('heading'),90,'гарчиг',1),safeText(form.get('description'),240,'тайлбар'),
      safeText(form.get('action'),40,'товчны бичвэр',1),safeText(form.get('alt'),140,'зургийн тайлбар',1),theme,position,
      safeText(form.get('brand_name') ?? current.brand_name,65,'дэлгүүрийн нэр',1),
      safeText(form.get('announcement') ?? current.announcement,160,'мэдэгдэл'),
      safeText(form.get('location') ?? current.location,120,'байршил'),
      safeText(form.get('contact') ?? current.contact,100,'холбоо барих'),
      safeText(form.get('delivery_note') ?? current.delivery_note,500,'хүргэлтийн нөхцөл'), layout,mobile,
      clear,photo?.type ?? null,clear,photo?.bytes ?? null,lock,version)];
  if (logo || form.get('remove_logo') === '1') {
    writes.push(db.prepare(`UPDATE storefront_logo SET type=?,bytes=? WHERE id=1
      AND EXISTS(SELECT 1 FROM storefront_settings WHERE id=1 AND write_key=?)`)
      .bind(logo?.type ?? null,logo?.bytes ?? null,lock));
  }
  const [result] = await db.batch(writes);
  if (!result.meta.changes) fail(409,'Нүүр хуудасны мэдээлэл өөрчлөгдсөн байна. Шинэчлээд дахин оролдоно уу.');
  return json(await storefrontSettings(db));
}

async function placeOrder(request, db) {
  const input = await readJson(request);
  if (typeof input.id !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.id)) fail(400, 'Invalid order reference.');
  const name = safeText(input.name, 100, 'name', 2);
  const phone = safeText(input.phone, 30, 'phone number', 6);
  if (!/^\+?[0-9 ()-]+$/.test(phone)) fail(400, 'Enter a valid phone number.');
  if (!['pickup', 'delivery'].includes(input.fulfillment)) fail(400, 'Choose delivery or pickup.');
  const address = input.fulfillment === 'delivery' ? safeText(input.address, 350, 'delivery address', 5) : '';
  const notes = safeText(input.notes, 500, 'notes');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 30) fail(400, 'Add between 1 and 30 products.');
  const items = new Map();
  for (const item of input.items) {
    if (!item || typeof item.id !== 'string' || !idPattern.test(item.id) || items.has(item.id)) fail(400, 'Invalid cart item.');
    const quantity = integer(item.quantity, 1, 999, 'quantity');
    const choices = item.colors ?? [];
    if (!Array.isArray(choices) || choices.length > maximumColors) fail(400, 'Захиалгын өнгөө шалгана уу.');
    const selected = new Map();
    for (const choice of choices) {
      if (!choice || typeof choice.id !== 'string' || !idPattern.test(choice.id) || selected.has(choice.id)) {
        fail(400, 'Захиалгын өнгөө шалгана уу.');
      }
      selected.set(choice.id, integer(choice.quantity, 1, 999, 'өнгөний тоо'));
    }
    if (selected.size && [...selected.values()].reduce((a,b) => a + b, 0) !== quantity) {
      fail(400, 'Захиалгын өнгө болон тоог шалгана уу.');
    }
    const rawVariants = item.variants ?? [];
    if (!Array.isArray(rawVariants) || rawVariants.length > 192) fail(400,'Размерын мэдээллийг шалгана уу.');
    const pairs = new Set();
    const variants = rawVariants.map(variant => {
      const size = safeText(variant?.size,24,'размер',1);
      const color = variant?.color ?? '';
      const key = JSON.stringify([size,color]);
      if (typeof color !== 'string' || (color && !idPattern.test(color)) || pairs.has(key)) fail(400,'Сонголтоо дахин шалгана уу.');
      pairs.add(key);
      return {size,color,quantity:integer(variant?.quantity,1,999,'тоо')};
    });
    if (variants.length && variants.reduce((n,variant)=>n+variant.quantity,0)!==quantity) fail(400,'Размерын тоог шалгана уу.');
    items.set(item.id, {quantity, price:integer(item.price, 1, 999999999, 'price'), selected,variants});
  }
  const orderRef = input.id.toLowerCase();
  const existing = () => db.prepare('SELECT id FROM orders WHERE id=?').bind(orderRef).first();
  if (await existing()) return json({ id: orderRef });
  const ids = [...items.keys()];
  const { results } = await db.prepare(`SELECT id,name,COALESCE(sale_price,price) AS price,stock,colors_json,sizes_json,version
    FROM products WHERE active=1 AND archived=0 AND sample=0 AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  if (results.length !== ids.length || results.some(p => items.get(p.id).price !== p.price || items.get(p.id).quantity > p.stock)) {
    fail(409, 'A price or stock level changed. Review your bag and try again.');
  }
  const orderColors = new Map();
  const orderVariants = new Map();
  for (const product of results) {
    const available = new Map(JSON.parse(product.colors_json).map(color => [color.id,color]));
    const selected = items.get(product.id).selected;
    if (Boolean(available.size) !== Boolean(selected.size) || [...selected.keys()].some(id => !available.has(id))) {
      fail(409, 'Сонгосон өнгө өөрчлөгдсөн байна. Сагсаа шинэчлээрэй.');
    }
    const sizes = new Set(JSON.parse(product.sizes_json));
    const {variants} = items.get(product.id);
    if (Boolean(sizes.size) !== Boolean(variants.length) || variants.some(v=>!sizes.has(v.size) ||
        (available.size ? !available.has(v.color) : v.color !== ''))) {
      fail(409,'Сонгосон размер эсвэл өнгө өөрчлөгдсөн байна. Сагсаа шинэчлээрэй.');
    }
    if (variants.length && available.size) {
      const counts = new Map();
      for (const v of variants) counts.set(v.color,(counts.get(v.color) ?? 0)+v.quantity);
      if (counts.size!==selected.size || [...counts].some(([id,count])=>selected.get(id)!==count)) {
        fail(400,'Хэмжээ болон өнгөний тоог шалгана уу.');
      }
    }
    orderVariants.set(product.id,variants.map(v=>({size:v.size,color:available.get(v.color)?.name ?? '',quantity:v.quantity})));
    orderColors.set(product.id, [...selected].map(([id,quantity]) => ({id, name:available.get(id).name, quantity})));
  }
  const slot = Math.floor(Date.now() / 900_000);
  const key = hex(await digest(request.headers.get('CF-Connecting-IP') ?? 'local'));
  const [, attempt] = await db.batch([
    db.prepare('DELETE FROM order_attempts WHERE slot < ?').bind(slot - 1),
    db.prepare(`INSERT INTO order_attempts VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN slot = excluded.slot THEN attempts + 1 ELSE 1 END,
      slot = excluded.slot RETURNING attempts`).bind(key, slot),
  ]);
  if (attempt.results[0].attempts > 6) fail(429, 'Too many orders from this connection. Try again in 15 minutes.');
  const writes = [
    db.prepare('INSERT INTO orders (id,name,phone,fulfillment,address,notes) VALUES (?,?,?,?,?,?)')
      .bind(orderRef, name, phone, input.fulfillment, address, notes),
    ...results.map(p => db.prepare('INSERT INTO order_items (order_id,product_id,name,quantity,unit_price,colors_json,variants_json,inventory_version) VALUES (?,?,?,?,?,?,?,?)')
      .bind(orderRef, p.id, p.name, items.get(p.id).quantity, p.price, JSON.stringify(orderColors.get(p.id)),JSON.stringify(orderVariants.get(p.id)),p.version)),
  ];
  try {
    await db.batch(writes);
  } catch (error) {
    if (await existing()) return json({ id: orderRef });
    if (String(error).includes('inventory_changed')) fail(409, 'Stock changed while placing your order. Review your bag and try again.');
    throw error;
  }
  return json({ id: orderRef }, 201);
}

async function getOrders(db) {
  const [{results: orders}, {results: items}] = await db.batch([
    db.prepare("SELECT * FROM orders ORDER BY (status = 'placed') DESC, created_at DESC, id DESC LIMIT 100"),
    db.prepare(`SELECT order_id,name,quantity,unit_price,colors_json,variants_json FROM order_items WHERE order_id IN
      (SELECT id FROM orders ORDER BY (status = 'placed') DESC, created_at DESC, id DESC LIMIT 100)`),
  ]);
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.order_id)) grouped.set(item.order_id, []);
    const {colors_json,variants_json,...details} = item;
    grouped.get(item.order_id).push({...details, colors:JSON.parse(colors_json),variants:JSON.parse(variants_json)});
  }
  return orders.map(order => ({...order, items: grouped.get(order.id) ?? []}));
}

function siteOwner(request, env) {
  const identity = request.headers.get('OAI-Authenticated-User-Email')?.toLowerCase();
  return !!env.SITE_OWNER_EMAIL && !!identity && identity === env.SITE_OWNER_EMAIL.toLowerCase();
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = request.method;
  const db = env.DB;
  if (!['GET','HEAD'].includes(method) && request.headers.get('Origin') !== url.origin) fail(403, 'Invalid request origin.');
  if (path === '/api/products' && method === 'GET') return json(await products(db, false));
  if (path === '/api/orders' && method === 'POST') return placeOrder(request, db);
  if (path === '/api/storefront' && method === 'GET') return json(await storefrontSettings(db));
  if (['/storefront/hero','/storefront/logo'].includes(path) && ['GET','HEAD'].includes(method)) {
    const picture = await db.prepare(path === '/storefront/logo'
      ? 'SELECT type,bytes FROM storefront_logo WHERE id=1'
      : 'SELECT hero_type AS type,hero_bytes AS bytes FROM storefront_settings WHERE id=1').first();
    if (!picture?.bytes) fail(404,'Зураг олдсонгүй.');
    return new Response(method === 'HEAD' ? null : new Uint8Array(picture.bytes), {
      headers:{'Content-Type':picture.type,'Cache-Control':'no-cache'},
    });
  }
  if (path === '/api/admin/sign-in' && method === 'GET') return json({
    owner:siteOwner(request,env), passcode:true,
  });
  if (path === '/api/admin/login' && method === 'POST') return login(request, env);
  if (path.startsWith('/api/admin/')) {
    const owner = siteOwner(request, env);
    if (!await adminSession(request, env)) fail(401, 'Sign in to manage the store.');
    if (path === '/api/admin/session' && method === 'GET') return json({ username: env.ADMIN_USERNAME || 'dorjster', platformSession: owner });
    if (path === '/api/admin/logout' && method === 'POST') {
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hex(await digest(sessionToken(request)))).run();
      return json({ok: true}, 200, {'Set-Cookie': cookie(request, '', 0)});
    }
    if (path === '/api/admin/storefront' && method === 'POST') return saveStorefront(request,db);
    if (path === '/api/admin/categories' && method === 'GET') return json(await categoryList(db));
    if (path === '/api/admin/categories' && method === 'POST') return addCategory(request,db);
    if (path === '/api/admin/categories' && method === 'DELETE') return removeCategory(request,db);
    if (path === '/api/admin/products' && method === 'GET') return json(await products(db, true));
    if (path === '/api/admin/products' && method === 'POST') return saveProduct(request, db, null);
    const product = path.match(/^\/api\/admin\/products\/([a-z0-9-]{1,64})$/);
    if (product && method === 'POST') return saveProduct(request, db, product[1]);
    if (product && method === 'PATCH') return setProductArchive(request,db,product[1]);
    if (product && method === 'DELETE') return deleteProduct(request,db,product[1]);
    if (path === '/api/admin/orders' && method === 'GET') return json(await getOrders(db));
    const order = path.match(/^\/api\/admin\/orders\/([a-f0-9-]{36})$/);
    if (order && method === 'PATCH') {
      const {status} = await readJson(request);
      if (!['fulfilled','cancelled'].includes(status)) fail(400, 'Choose a valid order status.');
      const result = await db.prepare("UPDATE orders SET status=? WHERE id=? AND status='placed'").bind(status, order[1]).run();
      if (!result.meta.changes) fail(409, 'This order has already been updated.');
      return json({ok: true});
    }
  }
  const media = path.match(/^\/media\/([a-f0-9-]{36})$/);
  if (media && ['GET','HEAD'].includes(method)) {
    const photo = await db.prepare('SELECT photos.type,photos.bytes,products.active FROM photos JOIN products ON products.id=photos.product_id WHERE photos.id=?')
      .bind(media[1]).first();
    if (!photo || (!photo.active && !await adminSession(request, env))) fail(404, 'Photo unavailable.');
    return new Response(method === 'HEAD' ? null : new Uint8Array(photo.bytes), {
      headers: {'Content-Type': photo.type, 'Cache-Control': 'private, no-cache'},
    });
  }
  if (path.startsWith('/api/') || path.startsWith('/media/')) fail(404, 'Page unavailable.');
  if (path === '/' || path === '/admin') {
    url.pathname = path === '/' ? '/index.html' : '/admin.html';
    return env.ASSETS.fetch(new Request(url, request));
  }
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    let response;
    try {
      response = await route(request, env);
    } catch (error) {
      if (!(error instanceof RequestError)) console.error(error);
      response = json({error: error instanceof RequestError ? error.message : 'Something went wrong. Please try again.'}, error.status || 500);
    }
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Referrer-Policy', 'same-origin');
    headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (new URL(request.url).pathname.startsWith('/admin')) {
      headers.set('X-Robots-Tag','noindex, nofollow');
      headers.set('Cache-Control','no-store');
    }
    return new Response(response.body, {status: response.status, headers});
  },
};
