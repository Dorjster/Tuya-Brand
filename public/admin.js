import { $, action, api, money, node } from './shared.js';

const editor = $('#editor');
const form = $('#product-form');
const photoInput = $('#photo-input');
const photoPreview = $('#photo-preview');
const maximumPhotos = 8;
const maximumColors = 12;
const inventoryStatus = $('#inventory-status');
const ordersStatus = $('#orders-status');
const colorList = $('#color-options');
const importInput = $('#product-import');
const importStatus = $('#import-status');
const storefrontForm = $('#storefront-form');
let storefront;
let storefrontPreviewUrl;
let storefrontLogoPreviewUrl;
const defaultHero = '/images/hero.webp';
const palette = [
  ['red','Улаан','#a71d40'], ['blue','Хөх','#264987'], ['black','Хар','#212127'], ['copper','Хүрэн','#945531'],
  ['white','Цагаан','#f4f1e8'], ['cream','Шаргал','#d8bc91'], ['green','Ногоон','#336446'], ['gray','Саарал','#7f8090'],
  ['pink','Ягаан','#e484a7'], ['purple','Нил ягаан','#714a93'], ['light-blue','Цэнхэр','#7faed9'], ['yellow','Шар','#d8a82d'],
].map(([id,name,hex]) => ({id,name,hex}));
let colorInputs = [];
let inventory = [];
let editing;
let gallery = [];

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
  fields.passcode.value = '';
  try {
    await api('/api/admin/sign-in');
    $('#login-panel').hidden = false;
    setMessage('#page-status', '');
    fields.passcode.focus();
  } catch (error) {
    setMessage('#page-status', error.message);
  }
  inventory = [];
  $('#inventory-list').replaceChildren();
  $('#order-list').replaceChildren();
  $('#category-list').replaceChildren();
  $('#archive-list').replaceChildren();
  storefrontForm.hidden = true;
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
    const [items,categories] = await Promise.all([api('/api/admin/products'),api('/api/admin/categories')]);
    inventory = items;
    const current = inventory.filter(p => !p.archived);
    const archived = inventory.filter(p => p.archived);
    inventoryStatus.textContent = notice || (current.length ? current.length + ' бараа' : 'Дэлгүүртээ эхний бараагаа нэмээрэй.');
    $('#archived-products').hidden = archived.length === 0;
    $('#admin-categories').replaceChildren(...categories.map(({name}) => {
      const option = node('option');
      option.value = name;
      return option;
    }));
    renderInventory();
    $('#archive-list').replaceChildren(...archived.map(inventoryRow));
  } catch (error) {
    report(error, inventoryStatus);
  }
}

function renderInventory() {
  const query = $('#inventory-search').value.trim().toLowerCase();
  const status = $('#inventory-state').value;
  const results = inventory.filter(product => !product.archived &&
    (status === 'all' || (status === 'sample' ? product.sample : Boolean(product.active) === (status === 'published'))) &&
    (!query || [product.name,product.category,product.sku].some(value=>String(value ?? '').toLowerCase().includes(query))));
  $('#inventory-list').replaceChildren(...results.map(inventoryRow));
  if (!results.length && (query || status!=='all')) $('#inventory-list').append(node('p','Тохирох бараа алга.','muted'));
}

function inventoryRow(product) {
  const row = node('div','','admin-row');
  const imageFrame = node('div','','mini');
  if (product.images[0]) {
    const image = node('img');
    image.src = product.images[0];
    image.alt = '';
    imageFrame.append(image);
  }
  const details = node('div','','inventory-label');
  details.append(node('strong',product.name),node('p',product.category + ' · ' +
    (product.sample ? 'Жишээ бараа' : product.stock + ' ширхэг үлдсэн') + ' · ' + (product.archived ? 'Архивт' : product.active ? 'Нийтэлсэн' : 'Ноорог'),'muted'));
  details.append(node('p',product.sale_price ? money(product.price) + ' → ' + money(product.sale_price) : money(product.price),'admin-row-price'));
  if (product.sku || product.sizes?.length) details.append(node('p',[product.sku,(product.sizes ?? []).join(', ')].filter(Boolean).join(' · '),'muted'));
  const buttons = node('div','','admin-actions');
  if (!product.archived) buttons.append(action('Засах','button secondary',() => openProduct(product)));
  const archive = action(product.archived ? 'Сэргээх' : 'Архивлах','button secondary',async () => {
    if (!product.archived && !confirm('Энэ барааг дэлгүүрээс хасаж, архивлах уу?')) return;
    archive.disabled = true;
    try {
      await api('/api/admin/products/' + product.id,{method:'PATCH',json:{archived:!product.archived,version:product.version}});
      await refreshProducts(product.archived ? 'Барааг ноорог болгон сэргээв.' : 'Барааг архивлав.');
    } catch (error) {
      if (error.status === 409) await refreshProducts(error.message);
      else report(error,inventoryStatus);
    } finally {
      archive.disabled = false;
    }
  });
  buttons.append(archive);
  if (product.archived) {
    const remove = action('Бүр мөсөн устгах','button danger',async () => {
      if (prompt('«' + product.name + '» барааг бүр мөсөн устгах бол УСТГАХ гэж бичнэ үү.') !== 'УСТГАХ') return;
      remove.disabled = true;
      try {
        await api('/api/admin/products/' + product.id,{method:'DELETE',json:{version:product.version}});
        await refreshProducts('Барааг бүр мөсөн устгалаа.');
      } catch (error) {
        report(error,inventoryStatus);
      } finally {
        remove.disabled = false;
      }
    });
    buttons.append(remove);
  }
  row.append(imageFrame,details,buttons);
  return row;
}

async function refreshCategories(notice = '') {
  const status = $('#categories-status');
  try {
    const categories = await api('/api/admin/categories');
    status.textContent = notice || '';
    $('#category-list').replaceChildren(...categories.map(category => {
      const row = node('div','','admin-row');
      const info = node('div','','inventory-label');
      info.append(node('strong',category.name),node('p',category.product_count + ' бараа','muted'));
      row.append(info);
      if (category.name !== 'Ангилалгүй') {
        const remove = action('Хасах','button secondary',async () => {
          const detail = category.product_count ? ' Бараанууд «Ангилалгүй» болно.' : '';
          if (!confirm('«' + category.name + '» ангиллыг хасах уу?' + detail)) return;
          remove.disabled = true;
          try {
            await api('/api/admin/categories',{method:'DELETE',json:{name:category.name}});
            await refreshCategories('Ангиллыг хаслаа.');
          } catch (error) {
            report(error,status);
          } finally {
            remove.disabled = false;
          }
        });
        row.append(remove);
      }
      return row;
    }));
  } catch (error) {
    report(error,status);
  }
}

function renderStorefrontPreview() {
  const fields = storefrontForm.elements;
  const photo = $('#storefront-image').files[0];
  if (storefrontPreviewUrl) URL.revokeObjectURL(storefrontPreviewUrl);
  storefrontPreviewUrl = photo ? URL.createObjectURL(photo) : null;
  const preview = $('#storefront-preview');
  preview.dataset.theme = fields.theme.value;
  preview.dataset.position = fields.position.value;
  preview.dataset.layout = fields.layout.value;
  if (storefrontLogoPreviewUrl) URL.revokeObjectURL(storefrontLogoPreviewUrl);
  const logoFile = $('#storefront-logo').files[0];
  storefrontLogoPreviewUrl = logoFile ? URL.createObjectURL(logoFile) : null;
  const logo = $('#storefront-preview-logo');
  const logoUrl = storefrontLogoPreviewUrl || (fields.remove_logo.checked ? null : storefront?.logo);
  logo.hidden = !logoUrl;
  if (logoUrl) logo.src = logoUrl;
  $('#storefront-preview-heading').textContent = fields.heading.value;
  $('#storefront-preview-action').textContent = fields.action.value;
  $('#storefront-preview-image').src = storefrontPreviewUrl || (fields.remove_image.checked ? null : storefront?.image) || defaultHero;
}

function fillStorefront(settings) {
  storefront = settings;
  storefrontForm.reset();
  for (const field of ['heading','description','action','alt','theme','position','brand_name','announcement','location','contact','delivery_note','layout','mobile_position']) storefrontForm.elements[field].value = settings[field];
  renderStorefrontPreview();
  storefrontForm.hidden = false;
}

async function refreshStorefront() {
  const status = $('#storefront-status');
  status.textContent = 'Нүүр хуудасны тохиргоо ачаалж байна…';
  try {
    fillStorefront(await api('/api/storefront'));
    status.textContent = '';
  } catch (error) {
    report(error,status);
  }
}

function changeGallery(next) {
  const material = form.elements.material_photo;
  const previousMaterial = material.value === '' ? null : gallery[Number(material.value)];
  for (const {color} of colorInputs) {
    if (color.photo == null || color.photo >= gallery.length) continue;
    const position = next.indexOf(gallery[color.photo]);
    color.photo = position < 0 ? null : position;
  }
  if (previousMaterial) {
    const position = next.indexOf(previousMaterial);
    material.dataset.pending = position < 0 ? '' : String(position);
    material.value = '';
  }
  gallery = next;
  refreshPreviews();
}

function refreshPreviews() {
  photoPreview.replaceChildren(...gallery.map((entry,index) => {
    const item = node('div', '', 'admin-photo');
    const image = node('img');
    image.src = entry.source;
    image.alt = 'Зураг ' + (index + 1);
    const buttons = node('div','','admin-gallery-actions');
    const move = (label,position) => {
      const button = action(label,'button secondary',() => {
        const next = [...gallery];
        next.splice(index,1);
        next.splice(position,0,entry);
        changeGallery(next);
        photoPreview.children[position]?.querySelector('button:not(:disabled)')?.focus();
      });
      button.disabled = position < 0 || position >= gallery.length;
      return button;
    };
    const remove = action('Хасах','button secondary',() => {
      if (entry.file) URL.revokeObjectURL(entry.source);
      changeGallery(gallery.filter(photo => photo !== entry));
      photoInput.focus();
    });
    const cover = move('Нүүр зураг болгох',0);
    cover.disabled = index === 0;
    buttons.append(cover,move('Өмнө',index - 1),move('Хойно',index + 1),remove);
    item.append(image,node('span',index === 0 ? '1 · Нүүр зураг' : String(index + 1)),buttons);
    return item;
  }));
  syncColorPhotos(gallery.length);
  const materialPhoto = form.elements.material_photo;
  const preferred = materialPhoto.dataset.pending ?? materialPhoto.value;
  materialPhoto.replaceChildren(new Option('Сонгоогүй',''),...gallery.map((_,i)=>new Option('Зураг ' + (i+1),String(i))));
  if (preferred !== '' && Number(preferred)<gallery.length) {
    materialPhoto.value = preferred;
    delete materialPhoto.dataset.pending;
  }
}

function syncColorPhotos(count) {
  for (const {check,select,color} of colorInputs) {
    select.replaceChildren(new Option('Зураг холбохгүй',''), ...Array.from({length:count},(_,i)=>new Option('Зураг ' + (i+1),String(i))));
    if (color.photo !== null && color.photo < count) select.value = String(color.photo);
    select.disabled = !check.checked || count === 0;
  }
}

function addColorRow(color, selected, custom) {
  const row = node('div', '', 'admin-color');
  const label = node('label');
  const check = node('input');
  check.type = 'checkbox';
  check.checked = selected;
  const title = node('span',color.name || 'Шинэ өнгө');
  const swatch = node('span', '', 'color-dot');
  swatch.style.backgroundColor = color.hex;
  label.append(check,swatch,title);
  const select = node('select');
  select.setAttribute('aria-label',(color.name || 'Шинэ өнгө') + ' өнгөний зураг');
  const entry = {color,check,select,row};
  check.addEventListener('change', () => syncColorPhotos(gallery.length));
  select.addEventListener('change', () => { color.photo = select.value === '' ? null : Number(select.value); });
  const details = node('details','','custom-color-fields');
  details.open = custom;
  details.append(node('summary','Нэр, өнгө засах'));
  const name = node('input');
  name.value = color.name;
  name.maxLength = 35;
  const hex = node('input');
  hex.type = 'color';
  hex.value = color.hex;
  const nameLabel = node('label','Өнгөний нэр');
  nameLabel.append(name);
  const hexLabel = node('label','Өнгөний код');
  hexLabel.append(hex);
  name.addEventListener('input', () => {
    color.name = name.value.trim();
    title.textContent = color.name || 'Шинэ өнгө';
    select.setAttribute('aria-label',title.textContent + ' өнгөний зураг');
  });
  hex.addEventListener('input', () => {
    color.hex = hex.value;
    swatch.style.backgroundColor = color.hex;
  });
  details.append(nameLabel,hexLabel);
  if (custom) details.append(action('Өнгө хасах','button secondary',() => {
    colorInputs = colorInputs.filter(item => item !== entry);
    row.remove();
    $('#add-custom-color').focus();
  }));
  row.append(label,select,details);
  colorInputs.push(entry);
  colorList.append(row);
  return name;
}

function renderColorOptions(existing = []) {
  const saved = new Map(existing.map(color => [color.id, color]));
  const options = [...palette, ...existing.filter(color => !palette.some(entry => entry.id === color.id))];
  colorInputs = [];
  colorList.replaceChildren();
  for (const entry of options) addColorRow(
    {...entry, ...saved.get(entry.id), photo:saved.get(entry.id)?.photo ?? null},
    saved.has(entry.id), !palette.some(color => color.id === entry.id));
  syncColorPhotos(gallery.length);
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
  if (!Array.isArray(choices) || choices.length > maximumColors) throw new Error('Markdown дахь өнгөний сонголтыг шалгана уу.');
  const ids = new Set();
  const colors = choices.map(choice => {
    const preset = palette.find(color=>color.id === choice?.id);
    const entry = {...preset,...choice};
    const index = choice?.photo;
    if (typeof entry.id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(entry.id) || ids.has(entry.id) ||
      typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 35 ||
      typeof entry.hex !== 'string' || !/^#[a-f0-9]{6}$/i.test(entry.hex) ||
      (index != null && (!Number.isInteger(index) || index < 1 || index > maximumPhotos))) {
      throw new Error('Markdown дахь өнгөний код болон зургийн дугаарыг шалгана уу.');
    }
    ids.add(entry.id);
    return {...entry, photo:index == null ? null : index - 1};
  });
  for (const field of ['sku','size_guide','material','care','subtitle','badge','design_notes']) {
    if (data[field] != null && typeof data[field]!=='string') throw new Error(field + ' талбарыг шалгана уу.');
  }
  if (data.sizes != null && (!Array.isArray(data.sizes) || data.sizes.length>16 ||
    data.sizes.some(size=>typeof size!=='string'||!size.trim()||size.includes(',')||size.length>24))) {
    throw new Error('Markdown дахь размерын мэдээллийг шалгана уу.');
  }
  const materialPhoto = data.material_photo;
  if (materialPhoto != null && (!Number.isInteger(materialPhoto)||materialPhoto<1||materialPhoto>maximumPhotos)) {
    throw new Error('Материалын зургийн дугаар 1–8 байна.');
  }
  if (data.display_priority != null && (!Number.isInteger(data.display_priority) || data.display_priority < 0 || data.display_priority > 9999)) {
    throw new Error('Эрэмбэ 0–9999 хооронд байна.');
  }
  if (data.sample != null && typeof data.sample !== 'boolean') throw new Error('sample талбар true эсвэл false байна.');
  if ('sample' in data) form.elements.sample.checked = data.sample === true;
  if ('display_priority' in data) form.elements.display_priority.value = data.display_priority ?? 0;
  for (const name of ['subtitle','badge','design_notes']) if (name in data) form.elements[name].value = data[name] ?? '';
  for (const name of [...fields,'sku','size_guide','material','care']) form.elements[name].value = data[name] ?? '';
  form.elements.sizes.value = (data.sizes ?? []).join(', ');
  form.elements.material_photo.dataset.pending = materialPhoto == null ? '' : String(materialPhoto-1);
  if (!editing) $('#product-active').checked = false;
  renderColorOptions(colors);
  refreshPreviews();
}

function openProduct(product) {
  editing = product;
  setMessage('#editor-error', '');
  form.reset();
  delete form.elements.material_photo.dataset.pending;
  gallery = (product?.images ?? []).map(source => ({source}));
  $('#import-guide').open = false;
  importStatus.textContent = 'Үүний дараа зургуудаа доороос нь сонгоно.';
  $('#editor-title').textContent = product ? 'Бараа засах' : 'Бараа нэмэх';
  if (product) {
    for (const name of ['name','category','description','price','sale_price','stock','sku','size_guide','material','care','subtitle','badge','design_notes','display_priority']) form.elements[name].value = product[name] ?? '';
    form.elements.sizes.value = (product.sizes ?? []).join(', ');
    if (product.material_photo != null) form.elements.material_photo.dataset.pending = String(product.material_photo);
  }
  $('#product-active').checked = Boolean(product?.active);
  form.elements.sample.checked = Boolean(product?.sample);
  renderColorOptions(product?.colors);
  refreshPreviews();
  editor.showModal();
}

async function compressPhoto(file,{transparent=false}={}) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 20_000_000) {
    throw new Error('20 МБ-аас бага JPEG, PNG эсвэл WebP зураг сонгоно уу.');
  }
  const image = await createImageBitmap(file).catch(() => { throw new Error('Сонгосон зургуудын нэгийг нээж чадсангүй.'); });
  try {
    const canvas = node('canvas');
    if (Math.max(image.width,image.height)<=2400 && file.size<=1_500_000) return file;
    const context = canvas.getContext('2d');
    for (const [maxSize,quality] of [[2400,.94],[2400,.87],[2000,.9],[1600,.86],[1200,.84],[900,.8]]) {
      const ratio = Math.min(1, maxSize / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));
      if (!transparent) {
        context.fillStyle = '#ffffff';
        context.fillRect(0,0,canvas.width,canvas.height);
      }
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve,transparent ? 'image/webp' : 'image/jpeg',quality));
      if (blob && blob.size <= 1_500_000) return blob;
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
        if (item.variants?.length) line.append(node('p',item.variants.map(v=>[v.size,v.color].filter(Boolean).join(' / ') + ' × ' + v.quantity).join(', '),'muted'));
        else if (item.colors?.length) line.append(node('p', item.colors.map(color => color.name + ' × ' + color.quantity).join(', '), 'muted'));
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
  const views = {
    products:['inventory',refreshProducts],
    categories:['categories',refreshCategories],
    storefront:['storefront',refreshStorefront],
    orders:['orders',refreshOrders],
  };
  for (const [key,[id]] of Object.entries(views)) {
    $('#' + key + '-tab').setAttribute('aria-pressed',String(key === tab));
    $('#' + id).hidden = key !== tab;
  }
  return views[tab][1]();
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
for (const tab of ['products','categories','storefront','orders']) {
  $('#' + tab + '-tab').addEventListener('click', () => showTab(tab));
}
for (const id of ['inventory-search','inventory-state']) $('#' + id).addEventListener('input',renderInventory);
$('#clear-sale').addEventListener('click',() => {
  form.elements.sale_price.value = '';
  form.elements.sale_price.focus();
});
$('#category-form').addEventListener('submit',async event => {
  event.preventDefault();
  const editor = event.currentTarget;
  const submit = editor.querySelector('button');
  submit.disabled = true;
  try {
    await api('/api/admin/categories',{method:'POST',json:{name:editor.elements.name.value}});
    editor.reset();
    await refreshCategories('Ангилал нэмэгдлээ.');
  } catch (error) {
    report(error,$('#categories-status'));
  } finally {
    submit.disabled = false;
  }
});
storefrontForm.addEventListener('input',event => {
  if (event.target === $('#storefront-image') && event.target.files.length) storefrontForm.elements.remove_image.checked = false;
  if (event.target === storefrontForm.elements.remove_image && event.target.checked) $('#storefront-image').value = '';
  if (event.target === $('#storefront-logo') && event.target.files.length) storefrontForm.elements.remove_logo.checked = false;
  if (event.target === storefrontForm.elements.remove_logo && event.target.checked) $('#storefront-logo').value = '';
  renderStorefrontPreview();
});
storefrontForm.addEventListener('submit',async event => {
  event.preventDefault();
  const submit = storefrontForm.querySelector('button');
  const status = $('#storefront-status');
  submit.disabled = true;
  status.textContent = 'Хадгалж байна…';
  try {
    const data = new FormData(storefrontForm);
    data.set('version',String(storefront.version));
    data.set('remove_image',storefrontForm.elements.remove_image.checked ? '1' : '0');
    const photo = $('#storefront-image').files[0];
    if (photo) data.set('image',await compressPhoto(photo),'hero');
    const logo = $('#storefront-logo').files[0];
    if (logo) data.set('logo',await compressPhoto(logo,{transparent:true}),'logo');
    data.set('remove_logo',storefrontForm.elements.remove_logo.checked ? '1' : '0');
    fillStorefront(await api('/api/admin/storefront',{method:'POST',body:data}));
    status.textContent = 'Нүүр хуудас шинэчлэгдлээ.';
  } catch (error) {
    report(error,status);
  } finally {
    submit.disabled = false;
  }
});
$('#refresh-orders').addEventListener('click', () => refreshOrders());
$('#new-product').addEventListener('click', () => openProduct(null));
$('#close-editor').addEventListener('click', () => editor.close());
editor.addEventListener('close', () => {
  for (const entry of gallery) if (entry.file) URL.revokeObjectURL(entry.source);
  gallery = [];
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
  const files = [...photoInput.files];
  photoInput.value = '';
  if (gallery.length + files.length > maximumPhotos) {
    setMessage('#editor-error','Нийт 8 хүртэл зураг ашиглана. Одоогийн зурагнаас хасаад дахин сонгоно уу.');
    return;
  }
  setMessage('#editor-error','');
  changeGallery([...gallery,...files.map(file => ({source:URL.createObjectURL(file),file}))]);
});
$('#add-custom-color').addEventListener('click', () => {
  if (colorInputs.filter(entry => entry.check.checked).length >= maximumColors) {
    setMessage('#editor-error','12 хүртэл өнгө сонгоно уу.');
    return;
  }
  addColorRow({id:crypto.randomUUID(),name:'',hex:'#804450',photo:null},true,true).focus();
  syncColorPhotos(gallery.length);
});
form.addEventListener('submit', async event => {
  event.preventDefault();
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
    data.set('sample',form.elements.sample.checked ? '1' : '0');
    const colors = colorInputs.filter(entry => entry.check.checked).map(({color,select}) => ({
      ...color, photo:select.value === '' ? null : Number(select.value),
    }));
    if (colors.length > maximumColors || colors.some(color => !color.name)) throw new Error('12 хүртэл өнгө сонгоно. Сонгосон өнгө бүр нэртэй байна.');
    data.set('colors',JSON.stringify(colors));
    data.set('sizes',JSON.stringify(form.elements.sizes.value.split(',').map(size=>size.trim()).filter(Boolean)));
    const order = [];
    let uploadIndex = 0;
    for (const entry of [...gallery]) {
      if (entry.file) {
        order.push(uploadIndex++);
        data.append('photos',await compressPhoto(entry.file),'product.jpg');
      } else order.push(entry.source);
    }
    data.set('gallery',JSON.stringify(order));
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
