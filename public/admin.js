import { $, action, api, money, node } from './shared.js';

const editor = $('#editor');
const form = $('#product-form');
const photoInput = $('#photo-input');
const photoPreview = $('#photo-preview');
const clearPhotos = $('#clear-photos');
const inventoryStatus = $('#inventory-status');
const ordersStatus = $('#orders-status');
const colorList = $('#color-options');
const importInput = $('#product-import');
const importStatus = $('#import-status');
const palette = [
  ['red','Улаан','#a71d40'], ['blue','Хөх','#264987'], ['black','Хар','#212127'], ['copper','Хүрэн','#945531'],
  ['white','Цагаан','#f4f1e8'], ['cream','Шаргал','#d8bc91'], ['green','Ногоон','#336446'], ['gray','Саарал','#7f8090'],
  ['pink','Ягаан','#e484a7'], ['purple','Нил ягаан','#714a93'], ['light-blue','Цэнхэр','#7faed9'], ['yellow','Шар','#d8a82d'],
].map(([id,name,hex]) => ({id,name,hex}));
let colorInputs = [];
let inventory = [];
let editing;
let previewUrls = [];
let photoError = '';

function setMessage(selector, message) {
  const element = $(selector);
  element.textContent = message;
  element.hidden = !message;
}

async function signedOut(message = '') {
  if (editor.open) editor.close();
  $('#dashboard').hidden = true;
  $('#login-panel').hidden = true;
  setMessage('#page-status', 'Нэвтрэх эрх шалгаж байна…');
  setMessage('#login-error', message);
  const fields = $('#login').elements;
  fields.password.value = '';
  fields.passcode.value = '';
  try {
    const mode = await api('/api/admin/sign-in');
    fields.username.required = fields.password.required = !mode.owner;
    $('#username-field').hidden = $('#password-field').hidden = mode.owner;
    fields.passcode.required = mode.passcode;
    $('#passcode-field').hidden = !mode.passcode;
    $('#login-panel').hidden = false;
    setMessage('#page-status', '');
    if (mode.owner) fields.passcode.focus();
  } catch (error) {
    setMessage('#page-status', error.message);
  }
  inventory = [];
  $('#inventory-list').replaceChildren();
  $('#order-list').replaceChildren();
}

function report(error, destination) {
  if (error.status === 401) signedOut('Нэвтрэх хугацаа дууссан. Дахин нэвтэрнэ үү.');
  else destination.textContent = error.message;
}

async function signedIn(session) {
  $('#login-panel').hidden = true;
  $('#dashboard').hidden = false;
  setMessage('#page-status', '');
  $('#signed-in').textContent = 'Нэвтэрсэн хэрэглэгч · ' + session.username;
  await showTab('products');
}

async function refreshProducts(notice = '') {
  inventoryStatus.textContent = 'Барааны жагсаалт ачаалж байна…';
  try {
    inventory = await api('/api/admin/products');
    inventoryStatus.textContent = notice || (inventory.length ? inventory.length + ' бараа' : 'Дэлгүүртээ эхний бараагаа нэмээрэй.');
    $('#admin-categories').replaceChildren(...[...new Set(inventory.map(p => p.category))].map(category => {
      const option = node('option');
      option.value = category;
      return option;
    }));
    $('#inventory-list').replaceChildren(...inventory.map(product => {
      const row = node('div', '', 'admin-row');
      const imageFrame = node('div', '', 'mini');
      if (product.images[0]) {
        const image = node('img');
        image.src = product.images[0];
        image.alt = '';
        imageFrame.append(image);
      }
      const details = node('div', '', 'inventory-label');
      details.append(node('strong',product.name),node('p',
        money(product.sale_price ?? product.price) + ' · ' + product.stock + ' ширхэг үлдсэн · ' + (product.active ? 'Нийтэлсэн' : 'Ноорог'), 'muted'));
      row.append(imageFrame,details,action('Засах', 'button secondary', () => openProduct(product)));
      return row;
    }));
  } catch (error) {
    report(error, inventoryStatus);
  }
}

function refreshPreviews() {
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  previewUrls = [...photoInput.files].slice(0,4).map(file => URL.createObjectURL(file));
  const images = previewUrls.length ? previewUrls : clearPhotos.checked ? [] : editing?.images || [];
  photoPreview.replaceChildren(...images.map((source,index) => {
    const item = node('div', '', 'admin-photo');
    const image = node('img');
    image.src = source;
    image.alt = 'Барааны зургийн урьдчилсан харагдац';
    item.append(image,node('span',String(index + 1)));
    return item;
  }));
  syncColorPhotos(images.length);
}

function syncColorPhotos(count) {
  for (const {check,select,color} of colorInputs) {
    select.replaceChildren(new Option('Зураг холбохгүй',''), ...Array.from({length:count},(_,i)=>new Option('Зураг ' + (i+1),String(i))));
    if (color.photo !== null && color.photo < count) select.value = String(color.photo);
    select.disabled = !check.checked || count === 0;
  }
}

function renderColorOptions(existing = []) {
  const saved = new Map(existing.map(color => [color.id, color]));
  const options = [...palette, ...existing.filter(color => !palette.some(entry => entry.id === color.id))];
  colorInputs = options.map(entry => {
    const color = {...entry,...saved.get(entry.id),photo:saved.get(entry.id)?.photo ?? null};
    const row = node('div', '', 'admin-color');
    const label = node('label');
    const check = node('input');
    check.type = 'checkbox';
    check.checked = saved.has(color.id);
    const swatch = node('span', '', 'color-dot');
    swatch.style.backgroundColor = color.hex;
    swatch.setAttribute('aria-hidden','true');
    label.append(check,swatch,node('span',color.name));
    const select = node('select');
    select.setAttribute('aria-label',color.name + ' өнгөний зураг');
    check.addEventListener('change', () => { select.disabled = !check.checked || !photoPreview.children.length; });
    select.addEventListener('change', () => { color.photo = select.value === '' ? null : Number(select.value); });
    row.append(label,select);
    return {color,check,select,row};
  });
  colorList.replaceChildren(...colorInputs.map(entry=>entry.row));
  syncColorPhotos(photoPreview.children.length);
}

function importProduct(text) {
  const block = text.match(/^```tuya-product\s*\r?\n([\s\S]*?)^```\s*$/m);
  if (!block) throw new Error('Tuya Brand-ийн Markdown загвар ашиглана уу.');
  let data;
  try { data = JSON.parse(block[1]); } catch { throw new Error('Markdown дахь барааны мэдээллийг уншиж чадсангүй.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Markdown дахь барааны мэдээллийг шалгана уу.');
  const fields = ['name','category','description','price','sale_price','stock'];
  for (const name of fields) {
    const value = data[name];
    if (value == null) continue;
    if (['price','sale_price','stock'].includes(name) ? !Number.isSafeInteger(value) : typeof value !== 'string') {
      throw new Error('Markdown дахь ' + name + ' талбарыг шалгана уу.');
    }
  }
  if (typeof data.name !== 'string' || !data.name.trim() || typeof data.category !== 'string' || !data.category.trim() ||
    !Number.isSafeInteger(data.price) || data.price < 1 || data.price > 999999999 ||
    !Number.isSafeInteger(data.stock) || data.stock < 0 || data.stock > 999999 ||
    (data.sale_price != null && (data.sale_price < 1 || data.sale_price >= data.price))) {
    throw new Error('Нэр, ангилал, үнэ болон үлдэгдлийг шалгана уу.');
  }
  const choices = data.colors ?? [];
  if (!Array.isArray(choices) || choices.length > palette.length) throw new Error('Markdown дахь өнгөний сонголтыг шалгана уу.');
  const ids = new Set();
  const colors = choices.map(choice => {
    const entry = palette.find(color=>color.id === choice?.id);
    const index = choice?.photo;
    if (!entry || ids.has(entry.id) || (index != null && (!Number.isInteger(index) || index < 1 || index > 4))) {
      throw new Error('Markdown дахь өнгөний код болон зургийн дугаарыг шалгана уу.');
    }
    ids.add(entry.id);
    return {...entry, photo:index == null ? null : index - 1};
  });
  for (const name of fields) form.elements[name].value = data[name] ?? '';
  if (!editing) $('#product-active').checked = false;
  renderColorOptions(colors);
  refreshPreviews();
}

function openProduct(product) {
  editing = product;
  setMessage('#editor-error', '');
  form.reset();
  photoError = '';
  $('#import-guide').open = false;
  importStatus.textContent = 'Үүний дараа зургуудаа доороос нь сонгоно.';
  $('#editor-title').textContent = product ? 'Бараа засах' : 'Бараа нэмэх';
  if (product) {
    for (const name of ['name','category','description','price','sale_price','stock']) form.elements[name].value = product[name] ?? '';
  } else {
    form.elements.stock.value = '0';
  }
  $('#product-active').checked = Boolean(product?.active);
  $('#clear-photos-label').hidden = !product?.images.length;
  renderColorOptions(product?.colors);
  refreshPreviews();
  editor.showModal();
}

async function compressPhoto(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 20_000_000) {
    throw new Error('20 МБ-аас бага JPEG, PNG эсвэл WebP зураг сонгоно уу.');
  }
  const image = await createImageBitmap(file).catch(() => { throw new Error('Сонгосон зургуудын нэгийг нээж чадсангүй.'); });
  try {
    const canvas = node('canvas');
    const context = canvas.getContext('2d');
    for (const maxSize of [1440, 1080, 760, 520]) {
      const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      context.fillStyle = '#ffffff';
      context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .86));
      if (blob && blob.size <= 600000) return blob;
    }
    throw new Error('Зургийн хэмжээ хэт том байна. Жижиг зураг сонгоно уу.');
  } finally {
    image.close();
  }
}

async function refreshOrders(notice = '') {
  ordersStatus.textContent = 'Захиалга ачаалж байна…';
  try {
    const orders = await api('/api/admin/orders');
    ordersStatus.textContent = notice || (orders.length ? 'Сүүлийн захиалгууд. Шинэ захиалга эхэнд харагдана.' : 'Захиалга хараахан байхгүй байна.');
    $('#order-list').replaceChildren(...orders.map(order => {
      const card = node('article', '', 'order-card');
      const head = node('div','', 'order-head');
      const subtotal = order.items.reduce((total, item) => total + item.quantity * item.unit_price, 0);
      head.append(node('strong', order.id.slice(0,8).toUpperCase() + ' · ' + money(subtotal)),
        node('span', { placed:'Шинэ', fulfilled:'Биелсэн', cancelled:'Цуцалсан' }[order.status] || order.status,'order-state'));
      card.append(head,node('p', order.name + ' · ' + order.phone + ' · ' + (order.fulfillment === 'delivery' ? 'Хүргэлт' : 'Очиж авах')),node('p',
        new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Ulaanbaatar'})
          .format(new Date(order.created_at.replace(' ','T')+'Z')) + ' ULAT','muted'));
      if (order.address) card.append(node('p',order.address,'muted'));
      if (order.notes) card.append(node('p',order.notes,'muted'));
      const list = node('ul');
      for (const item of order.items) {
        const line = node('li', item.quantity + ' × ' + item.name + ' · ' + money(item.unit_price) + ' / ш');
        if (item.colors?.length) line.append(node('p', item.colors.map(color => color.name + ' × ' + color.quantity).join(', '), 'muted'));
        list.append(line);
      }
      card.append(list);
      if (order.status === 'placed') {
        const buttons = node('div','','admin-actions');
        const change = async (status, target) => {
          if (status === 'cancelled' && !confirm('Энэ захиалгыг цуцалж, барааг үлдэгдэлд буцаах уу?')) return;
          [...buttons.children].forEach(button => { button.disabled = true; });
          try {
            await api('/api/admin/orders/' + order.id,{method:'PATCH',json:{status}});
            await refreshOrders(status === 'cancelled' ? 'Захиалга цуцлагдаж, бараа үлдэгдэлд буцлаа.' : 'Захиалгыг биелсэн гэж тэмдэглэлээ.');
          } catch (error) {
            if (error.status === 409) await refreshOrders(error.message);
            else { report(error, ordersStatus); [...buttons.children].forEach(button => { button.disabled = false; }); target.focus(); }
          }
        };
        buttons.append(action('Биелсэн гэж тэмдэглэх','button primary',event => change('fulfilled',event.currentTarget)),
          action('Захиалга цуцлах','button danger',event => change('cancelled',event.currentTarget)));
        card.append(buttons);
      }
      return card;
    }));
  } catch (error) {
    report(error, ordersStatus);
  }
}

function showTab(tab) {
  const products = tab === 'products';
  $('#products-tab').setAttribute('aria-pressed',String(products));
  $('#orders-tab').setAttribute('aria-pressed',String(!products));
  $('#inventory').hidden = !products;
  $('#orders').hidden = products;
  return products ? refreshProducts() : refreshOrders();
}

$('#login').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  setMessage('#login-error','');
  try {
    await api('/api/admin/login',{method:'POST',json:Object.fromEntries(new FormData(form))});
    form.reset();
    await signedIn(await api('/api/admin/session'));
  } catch (error) {
    setMessage('#login-error',error.message);
  } finally {
    submit.disabled = false;
  }
});
$('#logout').addEventListener('click', async () => {
  try {
    await api('/api/admin/logout',{method:'POST'});
    signedOut();
  } catch (error) {
    report(error, $('#signed-in'));
  }
});
$('#products-tab').addEventListener('click', () => showTab('products'));
$('#orders-tab').addEventListener('click', () => showTab('orders'));
$('#refresh-orders').addEventListener('click', () => refreshOrders());
$('#new-product').addEventListener('click', () => openProduct(null));
$('#close-editor').addEventListener('click', () => editor.close());
editor.addEventListener('close', () => {
  previewUrls.forEach(url => URL.revokeObjectURL(url));
  previewUrls = [];
});
importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  if (!file) return;
  const current = editing;
  try {
    if (file.size > 20000) throw new Error('Markdown файл 20 КБ-аас бага байна.');
    const contents = await file.text();
    if (!editor.open || editing !== current || importInput.files[0] !== file) return;
    importProduct(contents);
    importStatus.textContent = 'Мэдээлэл орлоо. Зургуудаа сонгоод, үнэ болон үлдэгдлээ шалгаарай.';
  } catch (error) {
    importStatus.textContent = error.message;
  } finally {
    if (importInput.files[0] === file) importInput.value = '';
  }
});
photoInput.addEventListener('change', () => {
  photoError = photoInput.files.length > 4 ? '4 хүртэл зураг сонгоно уу.' : '';
  if (photoError) photoInput.value = '';
  else if (photoInput.files.length) clearPhotos.checked = false;
  setMessage('#editor-error',photoError);
  refreshPreviews();
});
clearPhotos.addEventListener('change', () => {
  if (clearPhotos.checked) photoInput.value = '';
  photoError = '';
  setMessage('#editor-error','');
  refreshPreviews();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (photoError) return setMessage('#editor-error',photoError);
  const submit = $('#save-product');
  const close = $('#close-editor');
  submit.disabled = close.disabled = true;
  const preventClose = event => event.preventDefault();
  editor.addEventListener('cancel',preventClose);
  setMessage('#editor-error','');
  try {
    const product = editing;
    const data = new FormData(form);
    data.set('active',$('#product-active').checked ? '1' : '0');
    if (product) data.set('version',String(product.version));
    if (clearPhotos.checked) data.set('clear_photos','1');
    const colors = colorInputs.filter(entry => entry.check.checked).map(({color,select}) => ({
      ...color, photo:select.value === '' ? null : Number(select.value),
    }));
    data.set('colors',JSON.stringify(colors));
    for (const photo of photoInput.files) data.append('photos',await compressPhoto(photo),'product.jpg');
    await api('/api/admin/products' + (product ? '/' + product.id : ''),{method:'POST',body:data});
    editor.close();
    await refreshProducts('Бараа хадгалагдлаа.');
  } catch (error) {
    if (error.status === 401) signedOut('Нэвтрэх хугацаа дууссан. Дахин нэвтэрнэ үү.');
    else setMessage('#editor-error',error.message);
  } finally {
    submit.disabled = close.disabled = false;
    editor.removeEventListener('cancel',preventClose);
  }
});

api('/api/admin/session').then(signedIn).catch(error => {
  if (error.status === 401) signedOut();
  else setMessage('#page-status',error.message);
});
