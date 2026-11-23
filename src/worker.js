const tokenPattern = /^[a-f0-9]{64}$/;
const idPattern = /^[a-z0-9-]{1,64}$/;
const maximumStock = 999999;
const maximumColors = 12;
const imageLimit = 600_000;
const uploadLimit = 2_450_000;
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

function passcodeEnabled(env) {
  return /^\d{4}$/.test(env.ADMIN_PASSCODE ?? '');
}

async function adminSession(request, env) {
  const token = sessionToken(request);
  if (!token || (env.SITE_OWNER_EMAIL && (!siteOwner(request,env) || !passcodeEnabled(env)))) return false;
  const gate = env.SITE_OWNER_EMAIL ? 'owner-code' : passcodeEnabled(env) ? 'password-code' : 'password';
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
  const requiresPasscode = Boolean(env.SITE_OWNER_EMAIL) || passcodeEnabled(env);
  if (env.SITE_OWNER_EMAIL && !owner) fail(403, 'Админ хэсэгт эзэмшигчийн бүртгэлээр нэвтэрнэ үү.');
  if ((requiresPasscode && !passcodeEnabled(env)) || (!owner && (!env.ADMIN_PASSWORD || env.ADMIN_PASSWORD.length < 16))) {
    fail(503, 'Админ нэвтрэх тохиргоо дутуу байна.');
  }
  const { username, password, passcode } = await readJson(request);
  const db = env.DB;
  const now = Math.floor(Date.now()/1000);
  const slot = Math.floor(now/900);
  const key = hex(await digest(request.headers.get('CF-Connecting-IP') ?? 'local'));
  const [, attempt] = await db.batch([
    db.prepare('DELETE FROM login_attempts WHERE slot < ?').bind(slot - 1),
    db.prepare(`INSERT INTO login_attempts VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN slot = excluded.slot THEN attempts + 1 ELSE 1 END,
      slot = excluded.slot RETURNING attempts`).bind(key, slot),
  ]);
  if (attempt.results[0].attempts > 8) fail(429, 'Too many attempts. Try again in 15 minutes.');
  const validCode = !requiresPasscode || await sameSecret(typeof passcode === 'string' ? passcode : '', env.ADMIN_PASSCODE);
  const validPassword = owner || await sameSecret(typeof password === 'string' ? password : '', env.ADMIN_PASSWORD);
  const validUser = owner || (typeof username === 'string' && username.trim().toLowerCase() === (env.ADMIN_USERNAME || 'dorjster').toLowerCase());
  if (!validCode || !validPassword || !validUser) {
    fail(401, owner ? 'Админ PIN буруу байна.' : 'Нэвтрэх мэдээлэл буруу байна.');
  }
  const gate = owner ? 'owner-code' : requiresPasscode ? 'password-code' : 'password';
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires <= ?').bind(now),
    db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key),
    db.prepare('INSERT INTO sessions (token_hash,expires,gate) VALUES (?,?,?)').bind(hex(await digest(token)), now + sessionLifetime, gate),
  ]);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(request, token, sessionLifetime) });
}

async function products(db, admin) {
  const [{ results }, { results: photos }] = await db.batch([
    db.prepare(`SELECT id,name,category,description,price,sale_price,stock,cover,colors_json${admin ? ',active,version' : ''}
      FROM products ${admin ? '' : 'WHERE active = 1'} ORDER BY created_at DESC, id DESC`),
    db.prepare(`SELECT photos.id,product_id FROM photos JOIN products ON products.id = photos.product_id
      ${admin ? '' : 'WHERE products.active = 1'} ORDER BY position`),
  ]);
  const photosByProduct = new Map();
  for (const photo of photos) {
    if (!photosByProduct.has(photo.product_id)) photosByProduct.set(photo.product_id, []);
    photosByProduct.get(photo.product_id).push('/media/' + photo.id);
  }
  return results.map(({cover, colors_json, ...product}) => {
    const images = photosByProduct.get(product.id) ?? [];
    return { ...product, images: images.length ? images : cover ? [cover] : [], colors: JSON.parse(colors_json) };
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
    const photo = color.photo == null ? null : integer(color.photo, 0, 3, 'өнгөний зураг');
    ids.add(color.id);
    return {id:color.id, name:safeText(color.name,35,'өнгөний нэр',1), hex:color.hex, photo};
  });
}

async function saveProduct(request, db, id) {
  if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data;')) fail(415, 'Send product form data.');
  if (Number(request.headers.get('Content-Length')) > uploadLimit || !request.body) {
    fail(413, 'Choose up to four photos, each under 600 KB.');
  }
  let uploadedBytes = 0;
  const limitedBody = request.body.pipeThrough(new TransformStream({
    transform(chunk, controller) {
      uploadedBytes += chunk.byteLength;
      if (uploadedBytes > uploadLimit) fail(413, 'Choose up to four photos, each under 600 KB.');
      controller.enqueue(chunk);
    },
  }));
  const form = await new Response(limitedBody, {headers: {'Content-Type': request.headers.get('Content-Type')}})
    .formData().catch(error => {
      if (error instanceof RequestError) throw error;
      fail(400, 'Invalid product form data.');
    });
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
  if (photos.length > 4) fail(400, 'Choose up to four photos.');
  const uploads = [];
  for (const photo of photos) {
    if (!(photo instanceof File) || photo.size > imageLimit || photo.size < 12 || !Object.hasOwn(photoTypes, photo.type)) {
      fail(400, 'Photos must be JPEG, PNG, or WebP and up to 600 KB each.');
    }
    const bytes = await photo.arrayBuffer();
    if (!photoTypes[photo.type](new Uint8Array(bytes))) fail(400, 'One photo could not be read.');
    uploads.push({ id: crypto.randomUUID(), type: photo.type, bytes });
  }
  const productId = id || crypto.randomUUID();
  const version = id ? integer(form.get('version'), 1, Number.MAX_SAFE_INTEGER, 'product version') : null;
  const replace = uploads.length || form.get('clear_photos') === '1';
  // Old clients may omit the color field when editing an existing product.
  const previous = id ? await db.prepare(`SELECT colors_json, cover,
    (SELECT COUNT(*) FROM photos WHERE product_id=products.id) AS photo_count
    FROM products WHERE id=? AND version=?`).bind(id,version).first() : null;
  if (id && !previous) fail(409, 'Барааны мэдээлэл өөрчлөгдсөн байна. Жагсаалтыг шинэчилнэ үү.');
  const photoCount = replace ? uploads.length : previous?.photo_count || Number(Boolean(previous?.cover));
  const colors = readProductColors(form.get('colors') ?? previous?.colors_json ?? '[]');
  for (const color of colors) {
    if (color.photo !== null && color.photo >= photoCount) {
      if (form.has('colors')) fail(400, 'Өнгөтэй холбох зургаа эхлээд сонгоно уу.');
      color.photo = null;
    }
  }
  values.push(JSON.stringify(colors));
  const lock = crypto.randomUUID();
  const changes = id
    ? db.prepare(`UPDATE products SET name=?,category=?,description=?,price=?,sale_price=?,stock=?,active=?,colors_json=?,
        cover=CASE WHEN ? THEN NULL ELSE cover END, version=version+1, write_key=? WHERE id=? AND version=?`)
      .bind(...values, Number(Boolean(replace)), lock, id, version)
    : db.prepare('INSERT INTO products (name,category,description,price,sale_price,stock,active,colors_json,id,write_key) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(...values, productId, lock);
  const batch = [changes];
  if (replace) {
    batch.push(db.prepare('DELETE FROM photos WHERE product_id IN (SELECT id FROM products WHERE id=? AND write_key=?)')
      .bind(productId, lock));
    uploads.forEach((photo, position) => batch.push(db.prepare(`INSERT INTO photos (id,product_id,position,type,bytes)
      SELECT ?,id,?,?,? FROM products WHERE id=? AND write_key=?`).bind(photo.id, position, photo.type, photo.bytes, productId, lock)));
  }
  const [result] = await db.batch(batch);
  if (!result.meta.changes) fail(409, 'This product changed since you opened it. Refresh the inventory and try again.');
  return json({ id: productId }, id ? 200 : 201);
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
    items.set(item.id, {quantity, price:integer(item.price, 1, 999999999, 'price'), selected});
  }
  const orderRef = input.id.toLowerCase();
  const existing = () => db.prepare('SELECT id FROM orders WHERE id=?').bind(orderRef).first();
  if (await existing()) return json({ id: orderRef });
  const ids = [...items.keys()];
  const { results } = await db.prepare(`SELECT id,name,COALESCE(sale_price,price) AS price,stock,colors_json
    FROM products WHERE active=1 AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  if (results.length !== ids.length || results.some(p => items.get(p.id).price !== p.price || items.get(p.id).quantity > p.stock)) {
    fail(409, 'A price or stock level changed. Review your bag and try again.');
  }
  const orderColors = new Map();
  for (const product of results) {
    const available = new Map(JSON.parse(product.colors_json).map(color => [color.id,color]));
    const selected = items.get(product.id).selected;
    if (Boolean(available.size) !== Boolean(selected.size) || [...selected.keys()].some(id => !available.has(id))) {
      fail(409, 'Сонгосон өнгө өөрчлөгдсөн байна. Сагсаа шинэчлээрэй.');
    }
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
    ...results.map(p => db.prepare('INSERT INTO order_items (order_id,product_id,name,quantity,unit_price,colors_json) VALUES (?,?,?,?,?,?)')
      .bind(orderRef, p.id, p.name, items.get(p.id).quantity, p.price, JSON.stringify(orderColors.get(p.id)))),
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
    db.prepare(`SELECT order_id,name,quantity,unit_price,colors_json FROM order_items WHERE order_id IN
      (SELECT id FROM orders ORDER BY (status = 'placed') DESC, created_at DESC, id DESC LIMIT 100)`),
  ]);
  const grouped = new Map();
  for (const item of items) {
    if (!grouped.has(item.order_id)) grouped.set(item.order_id, []);
    const {colors_json, ...details} = item;
    grouped.get(item.order_id).push({...details, colors:JSON.parse(colors_json)});
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
  if (path === '/api/admin/sign-in' && method === 'GET') return json({
    owner:siteOwner(request,env), passcode:Boolean(env.SITE_OWNER_EMAIL) || passcodeEnabled(env),
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
    if (path === '/api/admin/products' && method === 'GET') return json(await products(db, true));
    if (path === '/api/admin/products' && method === 'POST') return saveProduct(request, db, null);
    const product = path.match(/^\/api\/admin\/products\/([a-z0-9-]{1,64})$/);
    if (product && method === 'POST') return saveProduct(request, db, product[1]);
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
