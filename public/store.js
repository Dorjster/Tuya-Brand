import { $, action, api, closeButton, money, node, priceBlock } from './shared.js';

const all = 'all';
const sale = 'sale';
const favorite = 'favorite';
let favorites = new Set();
try { favorites = new Set(JSON.parse(localStorage.getItem('tuya_favorites') || '[]')); } catch {}
const productDialog = $('#product-dialog');
const bagDialog = $('#bag-dialog');
const grid = $('#product-grid');
const status = $('#catalog-status');
const bagContent = $('#bag-content');
let products = [];
let category = all;
let loaded = false;
let toastTimer;
let orderKey;
let bag = {};
try {
  const saved = JSON.parse(localStorage.getItem('tuya_bag') || '{}');
  bag = Object.fromEntries(Object.entries(saved).filter(([id,q]) => /^[a-z0-9-]{1,64}$/.test(id) && Number.isInteger(q) && q > 0 && q <= 999));
} catch {}

const quantityInBag = id => Object.hasOwn(bag,id) ? bag[id] : 0;
const currentPrice = product => product.sale_price ?? product.price;
const stockText = product => product.stock ? product.stock + ' ширхэг байна' : 'Дууссан';

function updateBag() {
  try { localStorage.setItem('tuya_bag', JSON.stringify(bag)); } catch {}
  $('#bag-count').textContent = Object.values(bag).reduce((sum, quantity) => sum + quantity, 0);
}

function toast(text) {
  const message = $('#toast');
  clearTimeout(toastTimer);
  message.textContent = text;
  message.hidden = false;
  toastTimer = setTimeout(() => { message.hidden = true; }, 2300);
}

function addProduct(product) {
  if (quantityInBag(product.id) >= Math.min(product.stock,999)) {
    toast('Боломжит бүх ширхэгийг сагсандаа нэмсэн байна.');
    return;
  }
  bag[product.id] = quantityInBag(product.id) + 1;
  orderKey = null;
  updateBag();
  toast(product.name + ' сагсанд нэмэгдлээ.');
}

function showDetail(product) {
  const panel = node('div', '', 'dialog-panel');
  const head = node('div', '', 'dialog-head');
  const title = node('h2', product.name);
  title.id = 'detail-title';
  head.append(title, closeButton(productDialog));
  const columns = node('div', '', 'detail-grid');
  const gallery = node('div');
  const imageFrame = node('div', '', 'detail-image');
  const image = node('img');
  image.alt = product.name;
  if (product.images.length) {
    image.src = product.images[0];
    imageFrame.append(image);
  } else {
    imageFrame.append(node('span', 'Зураг удахгүй нэмэгдэнэ', 'no-image'));
  }
  gallery.append(imageFrame);
  if (product.images.length > 1) {
    const thumbnails = node('div', '', 'photo-thumbs');
    product.images.forEach((source, index) => {
      const thumbnail = action('', '', event => {
        image.src = source;
        for (const button of thumbnails.children) button.setAttribute('aria-pressed', String(button === event.currentTarget));
      });
      thumbnail.setAttribute('aria-label', 'Зураг харуулах ' + (index + 1));
      thumbnail.setAttribute('aria-pressed', String(index === 0));
      const preview = node('img');
      preview.alt = '';
      preview.src = source;
      thumbnail.append(preview);
      thumbnails.append(thumbnail);
    });
    gallery.append(thumbnails);
  }
  const copy = node('div', '', 'detail-copy');
  const addButton = action('Сагсанд нэмэх', 'button primary', () => {
    addProduct(product);
    addButton.textContent = quantityInBag(product.id) >= Math.min(product.stock,999) ? 'Сагсанд байгаа' : 'Дахин нэмэх';
    addButton.disabled = quantityInBag(product.id) >= Math.min(product.stock,999);
  });
  addButton.disabled = !product.stock || quantityInBag(product.id) >= Math.min(product.stock,999);
  if (addButton.disabled && product.stock) addButton.textContent = 'Сагсанд байгаа';
  copy.append(node('p', product.category, 'product-category'), priceBlock(product), node('p', product.description),
    node('span', stockText(product), 'stock-label' + (product.stock ? '' : ' empty')), addButton);
  columns.append(gallery, copy);
  panel.append(head, columns);
  $('#detail-content').replaceChildren(panel);
  if (!productDialog.open) productDialog.showModal();
}

function renderCatalog() {
  const categories = Array.from(new Set(products.map(p => p.category))).sort((a,b) => a.localeCompare(b));
  const categoryOptions = [[all,'Бүх бараа'], [sale,'Хямдрал'], [favorite,'Хадгалсан'], ...categories.map(value => ['category:' + value,value])];
  if (!categoryOptions.some(([value]) => value === category)) category = all;
  $('#categories').replaceChildren(...categoryOptions.map(([value, title]) => {
    const button = action(title, 'category-button', () => {
      category = value;
      renderCatalog();
      [...$('#categories').children].find(element => element.getAttribute('aria-pressed') === 'true')?.focus();
    });
    button.setAttribute('aria-pressed', String(category === value));
    return button;
  }));
  const query = $('#search').value.trim().toLowerCase();
  const sort = $('#sort').value;
  const list = products.filter(p => (
    (category === all || (category === sale ? p.sale_price !== null : category === favorite ? favorites.has(p.id) : 'category:' + p.category === category))
    && [p.name,p.category,p.description].some(value => value.toLowerCase().includes(query))
  ));
  if (sort === 'low') list.sort((a,b) => currentPrice(a) - currentPrice(b));
  if (sort === 'high') list.sort((a,b) => currentPrice(b) - currentPrice(a));
  if (sort === 'name') list.sort((a,b) => a.name.localeCompare(b.name));
  status.textContent = loaded ? list.length + ' бараа' : 'Бараа ачаалж байна…';
  grid.replaceChildren();
  if (loaded && !list.length) grid.append(node('p', category === favorite ? 'Хадгалсан бараа байхгүй байна.' : 'Тохирох бараа олдсонгүй.', 'empty-state'));
  for (const product of list) {
    const fragment = $('#card-template').content.cloneNode(true);
    const media = fragment.querySelector('.product-media');
    media.setAttribute('aria-label', product.name + ' үзэх');
    media.addEventListener('click', () => showDetail(product));
    const heart = fragment.querySelector('.favorite-button');
    const syncFavorite = () => {
      const selected = favorites.has(product.id);
      heart.textContent = selected ? '♥' : '♡';
      heart.setAttribute('aria-pressed', String(selected));
      heart.setAttribute('aria-label', selected ? 'Хадгалснаас хасах' : 'Дуртай бараанд хадгалах');
    };
    heart.addEventListener('click', () => {
      if (favorites.has(product.id)) favorites.delete(product.id);
      else favorites.add(product.id);
      try { localStorage.setItem('tuya_favorites', JSON.stringify([...favorites])); } catch {}
      if (category === favorite) renderCatalog();
      else syncFavorite();
    });
    syncFavorite();
    const image = media.querySelector('img');
    if (product.images[0]) {
      image.src = product.images[0];
      image.addEventListener('error', () => {
        image.hidden = true;
        media.querySelector('.no-image').hidden = false;
      }, {once:true});
    } else {
      image.hidden = true;
      media.querySelector('.no-image').hidden = false;
    }
    media.querySelector('.sale-badge').hidden = !product.sale_price;
    fragment.querySelector('.product-category').textContent = product.category;
    const title = fragment.querySelector('h3 button');
    title.textContent = product.name;
    title.addEventListener('click', () => showDetail(product));
    fragment.querySelector('.prices').replaceWith(priceBlock(product));
    const stock = fragment.querySelector('.stock-label');
    stock.textContent = stockText(product);
    stock.classList.toggle('empty', !product.stock);
    const add = fragment.querySelector('.add-button');
    add.disabled = !product.stock;
    add.addEventListener('click', () => addProduct(product));
    grid.append(fragment);
  }
}

async function loadProducts() {
  products = await api('/api/products');
  loaded = true;
  renderCatalog();
}

function bagPanel(title) {
  const panel = node('div', '', 'dialog-panel');
  const head = node('div', '', 'dialog-head');
  const heading = node('h2', title);
  heading.id = 'bag-title';
  head.append(heading,closeButton(bagDialog));
  panel.append(head);
  bagContent.replaceChildren(panel);
  return panel;
}

function currentItems() {
  return Object.entries(bag).map(([id, quantity]) => ({id, quantity, product:products.find(product => product.id === id)}));
}

function renderBag(notice) {
  const panel = bagPanel('Таны сагс');
  if (notice) panel.append(node('p', notice, 'form-message'));
  const items = currentItems();
  if (!items.length) {
    panel.append(node('p', 'Таны сагс is empty.', 'empty-state'));
    return;
  }
  let total = 0;
  let canOrder = true;
  for (const {id,quantity,product} of items) {
    const row = node('div', '', 'bag-row');
    const label = node('div', '', 'bag-item');
    const valid = product && quantity <= product.stock;
    label.append(node('strong', product?.name || 'Боломжгүй бараа'), node('br'),
      node('small', valid ? money(currentPrice(product)) + ' / ш' : 'Боломжит тоо: ' + (product?.stock ?? 0)));
    if (!valid) canOrder = false;
    if (product) total += quantity * currentPrice(product);
    const buttons = node('div', '', 'quantity');
    const change = amount => {
      if (amount < 1) delete bag[id];
      else bag[id] = amount;
      orderKey = null;
      updateBag();
      renderBag();
    };
    const minus = action('−', '', () => change(quantity - 1));
    minus.setAttribute('aria-label', 'Тоо хасах');
    const plus = action('+', '', () => change(quantity + 1));
    plus.setAttribute('aria-label', 'Тоо нэмэх');
    plus.disabled = !product || quantity >= Math.min(product.stock,999);
    buttons.append(minus, node('span', String(quantity)), plus);
    row.append(label,buttons);
    panel.append(row);
  }
  const summary = node('div', '', 'summary-row');
  summary.append(node('span','Барааны дүн'),node('span',money(total)));
  const checkout = action('Захиалах', 'button primary wide-button', () => renderCheckout(items));
  checkout.disabled = !canOrder || items.length > 30;
  if (items.length > 30) panel.append(node('p', 'Нэг захиалгад 30 хүртэл төрлийн бараа оруулна уу.', 'form-message'));
  panel.append(summary,checkout);
}

function renderCheckout(items) {
  const panel = bagPanel('Захиалга өгөх');
  const form = node('form', '', 'fields');
  form.innerHTML = `
    <p class="muted">Төлбөр болон бараагаа хүлээн авах нөхцөлийг баталгаажуулахаар дэлгүүр тантай холбогдоно.</p>
    <label>Нэр<input name="name" autocomplete="name" required minlength="2" maxlength="100"></label>
    <label>Утасны дугаар<input name="phone" type="tel" autocomplete="tel" required minlength="6" maxlength="30"></label>
    <label>Хүлээн авах хэлбэр<select name="fulfillment"><option value="pickup">Өөрөө очиж авах</option><option value="delivery">Хүргэлтээр авах</option></select></label>
    <label id="delivery-address" hidden>Хүргэлтийн хаяг<textarea name="address" autocomplete="street-address" minlength="5" maxlength="350"></textarea></label>
    <label>Нэмэлт тайлбар<textarea name="notes" rows="2" maxlength="500"></textarea></label>
    <p class="form-message" role="alert" hidden></p>
    <button class="button primary" type="submit">Захиалга илгээх</button>`;
  const back = action('Сагс руу буцах', 'button secondary wide-button', () => renderBag());
  panel.append(form, back);
  back.classList.add('back-button');
  const fulfillment = form.elements.fulfillment;
  fulfillment.addEventListener('change', () => {
    form.querySelector('#delivery-address').hidden = fulfillment.value !== 'delivery';
    form.elements.address.required = fulfillment.value === 'delivery';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('[type=submit]');
    const message = form.querySelector('[role=alert]');
    message.hidden = true;
    submit.disabled = true;
    back.disabled = true;
    const close = panel.querySelector('.close-button');
    close.disabled = true;
    const preventClose = event => event.preventDefault();
    bagDialog.addEventListener('cancel',preventClose);
    orderKey ||= crypto.randomUUID();
    try {
      const data = Object.fromEntries(new FormData(form));
      const {id} = await api('/api/orders', {
        method:'POST',
        json:{...data, id:orderKey, items:items.map(item => ({id:item.id,quantity:item.quantity,price:currentPrice(item.product)}))},
      });
      bag = {};
      orderKey = null;
      updateBag();
      const confirmation = bagPanel('Захиалга бүртгэгдлээ');
      confirmation.append(node('p', 'Захиалгын дугаар: ' + id.slice(0,8).toUpperCase()),
        node('p', 'Дэлгүүр таны оруулсан дугаараар холбогдоно.', 'muted'));
      loadProducts().catch(() => {});
    } catch (error) {
      if (error.status === 409) {
        orderKey = null;
        try { await loadProducts(); } catch {}
        renderBag(error.message);
      } else {
        message.textContent = error.message;
        message.hidden = false;
        submit.disabled = false;
        back.disabled = false;
      }
    } finally {
      close.disabled = false;
      bagDialog.removeEventListener('cancel',preventClose);
    }
  });
}

$('#search').addEventListener('input', renderCatalog);
$('#sort').addEventListener('change', renderCatalog);
$('#sale-link').addEventListener('click', () => { category = sale; $('#search').value = ''; renderCatalog(); });
for (const link of ['#shop-link','#nav-shop']) $(link).addEventListener('click', () => { category = all; $('#search').value = ''; renderCatalog(); });
$('#bag-button').addEventListener('click', async () => {
  const opening = bagPanel('Таны сагс');
  opening.append(node('p','Үлдэгдэл шалгаж байна…','muted'));
  bagDialog.showModal();
  try {
    await loadProducts();
    if (bagDialog.open) renderBag();
  } catch (error) {
    if (bagDialog.open) bagPanel('Таны сагс').append(node('p',error.message,'form-message'));
  }
});
updateBag();
loadProducts().catch(error => { status.textContent = error.message; });
