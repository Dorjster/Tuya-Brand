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
const categoryList = $('#categories');
const bagContent = $('#bag-content');
let products = [];
let category = all;
const filterDialog = $('#filter-dialog');
const filterForm = $('#filter-form');
let filters = {type:'',minPrice:null,maxPrice:null};
let loaded = false;
let toastTimer;
let orderKey;
let deliveryNote = '';
let bag = {};
try {
  const saved = JSON.parse(localStorage.getItem('tuya_bag') || '{}');
  bag = Object.fromEntries(Object.entries(saved).filter(([id,q]) => /^[a-z0-9-]{1,64}(?:~[a-z0-9-]{0,64})?(?:~[^~]{1,300})?$/.test(id) && Number.isInteger(q) && q > 0 && q <= 999));
} catch {}

const quantityInBag = id => Object.entries(bag)
  .reduce((total,[key,quantity]) => total + (key === id || key.startsWith(id + '~') ? quantity : 0),0);
const currentPrice = product => product.sale_price ?? product.price;
const stockText = product => product.sample ? 'Жишээ бараа' : product.stock ? product.stock + ' ширхэг байна' : 'Дууссан';
const motion = window.matchMedia('(prefers-reduced-motion: reduce)');

function displayedVariant(product, color) {
  if (!product.sample || color?.photo == null) return product;
  return products.find(entry => entry.sample && entry.images[0] === product.images[color.photo]) ?? product;
}

function updateBag() {
  try { localStorage.setItem('tuya_bag', JSON.stringify(bag)); } catch {}
  const count = Object.values(bag).reduce((sum, quantity) => sum + quantity, 0);
  $('#bag-count').textContent = count;
  $('#mobile-bag-count').textContent = count;
}

function toast(text) {
  const message = $('#toast');
  clearTimeout(toastTimer);
  message.textContent = text;
  message.hidden = false;
  toastTimer = setTimeout(() => { message.hidden = true; }, 2300);
}

function addProduct(product, color, size) {
  if (product.sample || (product.colors?.length && !color) || (product.sizes?.length && !size)) return;
  if (quantityInBag(product.id) >= Math.min(product.stock,999)) {
    toast('Боломжит бүх ширхэгийг сагсандаа нэмсэн байна.');
    return;
  }
  const key = size ? product.id + '~' + (color?.id ?? '') + '~' + encodeURIComponent(size).replaceAll('~','%7E') : color ? product.id + '~' + color.id : product.id;
  bag[key] = (Object.hasOwn(bag,key) ? bag[key] : 0) + 1;
  orderKey = null;
  updateBag();
  toast([product.name,color?.name,size].filter(Boolean).join(' · ') + ' сагсанд нэмэгдлээ.');
}

function createProductGallery(product) {
  const gallery = node('div', '', 'detail-gallery');
  const stage = node('div', '', 'detail-stage');
  const frame = node('div', '', 'detail-image');
  const photos = product.images;
  const images = photos.map((source, index) => {
    const image = node('img');
    image.src = source;
    image.alt = product.name + ' · зураг ' + (index + 1);
    if (index) image.loading = 'lazy';
    const slide = node('div', '', 'detail-slide');
    slide.append(image);
    return slide;
  });
  let active = 0;
  frame.append(...images);
  stage.append(frame);
  gallery.append(stage);
  if (!photos.length) {
    frame.append(node('span', 'Зураг удахгүй нэмэгдэнэ', 'no-image'));
    return { gallery, showPhoto: () => {} };
  }

  const count = node('span', '', 'gallery-count');
  const detailPhoto = Number.isInteger(product.material_photo) && Boolean(photos[product.material_photo]);
  const material = detailPhoto ? action('Материал', 'gallery-control', () => showPhoto(product.material_photo)) : null;
  let panX = 50;
  let panY = 50;
  function positionZoom(x,y) {
    panX = Math.max(0,Math.min(100,x));
    panY = Math.max(0,Math.min(100,y));
    frame.style.setProperty('--zoom-center',panX+'% '+panY+'%');
  }
  const controls = node('div', '', 'gallery-tools');
  const zoom = action('Томруулах', 'gallery-control', () => {
    const expanded = gallery.classList.toggle('is-zoomed');
    zoom.setAttribute('aria-pressed', String(expanded));
    zoom.textContent = expanded ? 'Багасгах' : 'Томруулах';
    positionZoom(50,50);
    if (expanded) frame.focus({preventScroll:true});
  });
  zoom.setAttribute('aria-pressed','false');
  if (material) controls.append(material);
  controls.append(zoom);
  stage.append(count,controls);

  const thumbs = node('div', '', 'photo-thumbs');
  const previous = action('‹', 'gallery-control gallery-prev', () => showPhoto(active - 1));
  previous.setAttribute('aria-label','Өмнөх зураг');
  const next = action('›', 'gallery-control gallery-next', () => showPhoto(active + 1));
  next.setAttribute('aria-label','Дараагийн зураг');
  const thumbnails = photos.length > 1 ? photos.map((source, index) => {
    const button = action('', '', () => showPhoto(index));
    button.setAttribute('aria-label','Зураг харуулах ' + (index + 1));
    const image = node('img');
    image.src = source;
    image.alt = '';
    button.append(image);
    return button;
  }) : [];

  function update(index) {
    if (index !== active) {
      gallery.classList.remove('is-zoomed');
      zoom.setAttribute('aria-pressed','false');
      zoom.textContent = 'Томруулах';
    }
    active = index;
    count.textContent = (index + 1) + ' / ' + photos.length;
    if (material) material.setAttribute('aria-pressed',String(index === product.material_photo));
    previous.disabled = index === 0;
    next.disabled = index === photos.length - 1;
    thumbnails.forEach((button,i) => button.setAttribute('aria-pressed',String(i === index)));
  }

  function showPhoto(index, animate = true) {
    const safeIndex = Math.max(0,Math.min(index,photos.length - 1));
    frame.scrollTo({
      left:safeIndex * frame.clientWidth,
      behavior:animate && !motion.matches ? 'smooth' : 'auto',
    });
  }

  frame.tabIndex = 0;
  frame.setAttribute('role','region');
  frame.setAttribute('aria-label','Барааны зургийн цомог');
  frame.addEventListener('pointermove', event => {
    if (!gallery.classList.contains('is-zoomed') || (event.pointerType === 'touch' && !event.buttons)) return;
    const box = frame.getBoundingClientRect();
    positionZoom((event.clientX-box.left)*100/box.width,(event.clientY-box.top)*100/box.height);
  });
  frame.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    if (gallery.classList.contains('is-zoomed')) {
      event.preventDefault();
      positionZoom(panX + (event.key==='ArrowRight'?12:event.key==='ArrowLeft'?-12:0),
        panY + (event.key==='ArrowDown'?12:event.key==='ArrowUp'?-12:0));
    } else if (photos.length > 1 && (event.key==='ArrowLeft'||event.key==='ArrowRight')) {
      event.preventDefault();
      showPhoto(active+(event.key==='ArrowRight'?1:-1));
    }
  });
  if (photos.length > 1) {
    stage.append(previous,next);
    thumbs.append(...thumbnails);
    gallery.append(thumbs);
    frame.addEventListener('scroll', () => {
      if (frame.clientWidth) update(Math.max(0,Math.min(photos.length - 1,Math.round(frame.scrollLeft / frame.clientWidth))));
    }, {passive:true});

  }
  update(0);
  return { gallery, showPhoto };
}

function showDetail(product, initialColor) {
  const panel = node('div', '', 'product-view');
  const close = closeButton(productDialog);
  close.classList.add('detail-close');
  close.autofocus = true;
  const columns = node('div', '', 'detail-grid');
  const { gallery, showPhoto } = createProductGallery(product);
  const copy = node('div', '', 'detail-copy');
  const colors = product.colors ?? [];
  const sizes = product.sizes ?? [];
  let selectedSize = sizes.length === 1 ? sizes[0] : null;
  let selectedColor = initialColor ?? (product.sample || colors.length === 1 ? colors[0] : null);
  const shown = displayedVariant(product,selectedColor);
  const title = node('h2',shown.name);
  title.id = 'detail-title';
  const fullQuantity = () => quantityInBag(product.id) >= Math.min(product.stock,999);
  const productPrice = priceBlock(shown);
  const description = node('p',shown.description,'detail-description');
  const feedback = node('p', '', 'detail-feedback');
  feedback.setAttribute('role','status');
  const viewBag = action('Сагс харах', 'button detail-view-bag', () => {
    productDialog.close();
    openBag();
  });
  viewBag.hidden = true;
  const addButton = action('Сагсанд нэмэх', 'button detail-add', () => {
    addProduct(product,selectedColor,selectedSize);
    const options = [selectedColor?.name,selectedSize].filter(Boolean).join(' / ');
    feedback.textContent = options ? options + ' · Сагсанд нэмлээ.' : 'Сагсанд нэмлээ.';
    viewBag.hidden = false;
    updateAddButton(true);
  });

  function updateAddButton(added = false) {
    addButton.disabled = !product.stock || fullQuantity() || (colors.length > 0 && !selectedColor) || (sizes.length > 0 && !selectedSize);
    addButton.textContent = !product.stock ? 'Дууссан' : fullQuantity() ? 'Сагсанд байгаа' :
      added ? 'Дахин нэмэх' : 'Сагсанд нэмэх';
  }

  const stock = node('span',stockText(product),'detail-status' + (product.stock ? ' is-available' : ''));
  copy.append(node('p',product.category,'detail-category'),title,productPrice,stock);
  if (colors.length) {
    const choices = node('fieldset', '', 'store-color-options');
    const label = node('legend',selectedColor ? 'Өнгө · ' + selectedColor.name : 'Өнгө сонгох');
    const swatches = node('div', '', 'swatch-list');
    for (const color of colors) {
      const button = action('', 'swatch-choice', () => {
        selectedColor = color;
        label.textContent = 'Өнгө · ' + color.name;
        for (const [i,choice] of [...swatches.children].entries()) {
          choice.setAttribute('aria-pressed',String(colors[i].id === color.id));
        }
        if (product.images.length) showPhoto(color.photo ?? 0);
        if (product.sample) {
          const variant = displayedVariant(product,color);
          title.textContent = variant.name;
          description.textContent = variant.description;
          productPrice.replaceChildren(...priceBlock(variant).childNodes);
        }
        if (!product.sample) updateAddButton();
      });
      const swatch = node('span', '', 'color-dot');
      swatch.style.backgroundColor = color.hex;
      swatch.setAttribute('aria-hidden','true');
      button.setAttribute('aria-pressed', String(selectedColor?.id === color.id));
      button.append(swatch,node('span',color.name));
      swatches.append(button);
    }
    choices.append(label,swatches);
    copy.append(choices);
  }
  if (sizes.length) {
    const group = node('fieldset','','store-color-options size-choices');
    const legend = node('legend',selectedSize ? 'Размер · ' + selectedSize : 'Размер сонгох');
    const buttons = node('div','','swatch-list');
    for (const size of sizes) {
      const button = action(size,'swatch-choice',() => {
        selectedSize = size;
        legend.textContent = 'Размер · ' + size;
        for (const option of buttons.children) option.setAttribute('aria-pressed',String(option === button));
        if (!product.sample) updateAddButton();
      });
      button.setAttribute('aria-pressed',String(size===selectedSize));
      buttons.append(button);
    }
    group.append(legend,buttons);
    copy.append(group);
  }
  if (product.description) copy.append(description);
  for (const [title,text] of [['Размерын заавар',product.size_guide],['Материал',product.material],['Арчилгаа',product.care]]) {
    if (!text) continue;
    const details = node('details','','product-fact');
    details.append(node('summary',title),node('p',text));
    copy.append(details);
  }
  if (product.sku) copy.append(node('p','SKU · ' + product.sku,'detail-note'));
  columns.append(gallery,copy);
  panel.append(close,columns);
  if (product.sample) {
    copy.append(node('p','Жишээ үнэ','detail-note'));
  } else {
    updateAddButton();
    const actions = node('div','','detail-actions');
    actions.append(feedback,addButton,viewBag);
    panel.append(actions);
  }
  $('#detail-content').replaceChildren(panel);
  if (!productDialog.open) productDialog.showModal();
  if (selectedColor?.photo > 0) showPhoto(selectedColor.photo,false);
}

function renderCatalog() {
  const categoryOptions = [[all,'Бүх бараа'], [sale,'Хямдрал'], [favorite,'Хадгалсан']];
  if (!categoryOptions.some(([value]) => value === category)) category = all;
  const scrollOffset = categoryList.scrollLeft;
  categoryList.replaceChildren(...categoryOptions.map(([value, title]) => {
    const button = action(title, 'category-button', () => {
      category = value;
      renderCatalog();
      const active = categoryList.querySelector('[aria-pressed=true]');
      active?.focus({ preventScroll: true });
    });
    button.setAttribute('aria-pressed', String(category === value));
    return button;
  }));
  categoryList.scrollLeft = scrollOffset;
  $('#catalog-title').textContent = categoryOptions.find(([value]) => value === category)[1];
  const sort = $('#sort').value;
  const list = products.filter(p => (
    (category === all || (category === sale ? p.sale_price !== null : favorites.has(p.id)))
    && (!filters.type || p.category === filters.type)
    && (filters.minPrice === null || currentPrice(p) >= filters.minPrice)
    && (filters.maxPrice === null || currentPrice(p) <= filters.maxPrice)
  ));
  if (sort === 'low') list.sort((a,b) => currentPrice(a) - currentPrice(b));
  if (sort === 'high') list.sort((a,b) => currentPrice(b) - currentPrice(a));
  if (sort === 'name') list.sort((a,b) => a.name.localeCompare(b.name));
  status.textContent = loaded ? list.length + ' бараа' : 'Бараа ачаалж байна…';
  const activeFilters = [filters.type,filters.minPrice !== null ? money(filters.minPrice) + '-өөс' : '',
    filters.maxPrice !== null ? money(filters.maxPrice) + ' хүртэл' : ''].filter(Boolean);
  $('#filter-label').textContent = activeFilters.length ? 'Шүүлтүүр · ' + activeFilters.length : 'Шүүлтүүр';
  const count = $('#mobile-filter-count');
  count.textContent = activeFilters.length;
  count.hidden = activeFilters.length === 0;
  const summary = $('#filter-summary');
  summary.textContent = activeFilters.join(' · ');
  summary.hidden = activeFilters.length === 0;
  grid.replaceChildren();
  if (loaded && !list.length) {
    const empty = node('div','','empty-state');
    empty.append(node('p', !activeFilters.length && category === favorite ? 'Хадгалсан бараа байхгүй байна.' : 'Тохирох бараа олдсонгүй.'));
    if (activeFilters.length) empty.append(action('Шүүлтүүр арилгах','button',resetFilters));
    grid.append(empty);
  }
  for (const product of list) {
    const fragment = $('#card-template').content.cloneNode(true);
    const media = fragment.querySelector('.product-media');
    let previewColor;
    const openDetail = () => showDetail(product,previewColor);
    media.setAttribute('aria-label', product.name + ' үзэх');
    media.addEventListener('click',openDetail);
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
      const fallback = media.querySelector('.no-image');
      image.addEventListener('error', () => {
        image.hidden = true;
        fallback.hidden = false;
      });
      image.addEventListener('load', () => {
        image.hidden = false;
        fallback.hidden = true;
      });
      image.src = product.images[0];
    } else {
      image.hidden = true;
      media.querySelector('.no-image').hidden = false;
    }
    media.querySelector('.sale-badge').hidden = !product.sale_price;
    fragment.querySelector('.product-category').textContent = product.category;
    const title = fragment.querySelector('h3 button');
    title.textContent = product.name;
    title.addEventListener('click',openDetail);
    const prices = priceBlock(product);
    fragment.querySelector('.prices').replaceWith(prices);
    if (product.colors?.length > 1) {
      const variants = node('div','','card-swatches');
      variants.setAttribute('role','group');
      variants.setAttribute('aria-label','Өнгөний урьдчилсан харагдац');
      product.colors.forEach((color,index) => {
        const swatch = action('', 'card-swatch', () => {
          previewColor = color;
          const shown = displayedVariant(product,color);
          title.textContent = shown.name;
          media.setAttribute('aria-label',shown.name + ' үзэх');
          prices.replaceChildren(...priceBlock(shown).childNodes);
          media.querySelector('.sale-badge').hidden = !shown.sale_price;
          if (product.images.length) image.src = product.images[color.photo] ?? product.images[0];
          for (const [i,button] of [...variants.children].entries()) button.setAttribute('aria-pressed',String(i === index));
        });
        const dot = node('span','','color-dot');
        dot.style.backgroundColor = color.hex;
        swatch.setAttribute('aria-label',color.name);
        swatch.setAttribute('aria-pressed',String(color.photo === 0));
        swatch.append(dot);
        variants.append(swatch);
      });
      prices.after(variants);
    }
    const stock = fragment.querySelector('.stock-label');
    stock.textContent = stockText(product);
    stock.classList.toggle('empty', !product.stock);
    const add = fragment.querySelector('.add-button');
    if (product.sample) {
      add.textContent = 'Дэлгэрэнгүй';
      add.addEventListener('click',openDetail);
      fragment.querySelector('.product-card').classList.add('sample-card');
    } else if (product.colors?.length || product.sizes?.length) {
      add.textContent = product.sizes?.length ? 'Размер сонгох' : 'Өнгө сонгох';
      add.disabled = !product.stock;
      add.addEventListener('click',openDetail);
    } else {
      add.disabled = !product.stock;
      add.addEventListener('click', () => addProduct(product));
    }
    grid.append(fragment);
  }
}

async function loadProducts() {
  const live = await api('/api/products');
  const showingSamples = live.length === 0;
  products = showingSamples ? await api('/collection-samples.json') : live;
  $('#sample-notice').hidden = !showingSamples;
  const types = [...new Set(products.map(product => product.category))].sort((a,b) => a.localeCompare(b));
  $('#filter-type').replaceChildren(new Option('Бүх төрөл',''),...types.map(type=>new Option(type,type)));
  if (filters.type && !types.includes(filters.type)) filters.type = '';
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
  return Object.entries(bag).map(([key,quantity]) => {
    const [id,colorId,encodedSize] = key.split('~');
    let size = '';
    if (encodedSize) {
      try { size = decodeURIComponent(encodedSize); } catch { size = '–'; }
    }
    const product = products.find(product => product.id === id);
    return {key,id,colorId,size,quantity,product,color:product?.colors?.find(color => color.id === colorId)};
  });
}

function checkoutItems(items) {
  const ordered = new Map();
  for (const {id,product,color,size,quantity} of items) {
    if (!ordered.has(id)) ordered.set(id,{id,price:currentPrice(product),quantity:0,colors:[],variants:[]});
    const line = ordered.get(id);
    line.quantity += quantity;
    if (color) {
      const previous = line.colors.find(entry=>entry.id===color.id);
      if (previous) previous.quantity += quantity;
      else line.colors.push({id:color.id,quantity});
    }
    if (size) line.variants.push({size,color:color?.id ?? '',quantity});
  }
  return [...ordered.values()];
}

function renderBag(notice) {
  const panel = bagPanel('Таны сагс');
  if (notice) panel.append(node('p', notice, 'form-message'));
  const items = currentItems();
  if (!items.length) {
    panel.append(node('p', 'Таны сагс хоосон байна.', 'empty-state'));
    return;
  }
  let total = 0;
  let canOrder = true;
  for (const {key,id,colorId,size,quantity,product,color} of items) {
    const row = node('div', '', 'bag-row');
    const label = node('div', '', 'bag-item');
    const validColor = colorId ? Boolean(color) : !product?.colors?.length;
    const validSize = size ? product?.sizes?.includes(size) : !product?.sizes?.length;
    const valid = product && !product.sample && validColor && validSize && quantityInBag(id) <= Math.min(product.stock,999);
    label.append(node('strong', product?.name || 'Боломжгүй бараа'), node('br'));
    if (color || size) label.append(node('small',[color?.name,size].filter(Boolean).join(' / ') + ' · '));
    label.append(node('small', !validColor || !validSize ? 'Өнгө, размераа дахин сонгоно уу.' : valid ? money(currentPrice(product)) + ' / ш' :
      'Боломжит тоо: ' + (product?.stock ?? 0)));
    if (!valid) canOrder = false;
    if (product) total += quantity * currentPrice(product);
    const buttons = node('div', '', 'quantity');
    const change = amount => {
      if (amount < 1) delete bag[key];
      else bag[key] = amount;
      orderKey = null;
      updateBag();
      renderBag();
    };
    const minus = action('−', '', () => change(quantity - 1));
    minus.setAttribute('aria-label', 'Тоо хасах');
    const plus = action('+', '', () => change(quantity + 1));
    plus.setAttribute('aria-label', 'Тоо нэмэх');
    plus.disabled = !product || !validColor || !validSize || quantityInBag(id) >= Math.min(product.stock,999);
    buttons.append(minus, node('span', String(quantity)), plus);
    row.append(label,buttons);
    panel.append(row);
  }
  const summary = node('div', '', 'summary-row');
  summary.append(node('span','Барааны дүн'),node('span',money(total)));
  const productCount = new Set(items.map(item => item.id)).size;
  const checkout = action('Захиалах', 'button primary wide-button', () => renderCheckout(items));
  checkout.disabled = !canOrder || productCount > 30;
  if (productCount > 30) panel.append(node('p', 'Нэг захиалгад 30 хүртэл төрлийн бараа оруулна уу.', 'form-message'));
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
  if (deliveryNote) form.prepend(node('p',deliveryNote,'muted checkout-delivery'));
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
        json:{...data, id:orderKey, items:checkoutItems(items)},
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

$('#sort').addEventListener('change', renderCatalog);
const selectCategory = value => {
  category = value;
  renderCatalog();
};
for (const link of ['#sale-link','#mobile-sale']) $(link).addEventListener('click', () => selectCategory(sale));
for (const link of ['#shop-link','#nav-shop','#mobile-shop']) $(link).addEventListener('click', () => selectCategory(all));

function openFilters() {
  for (const key of Object.keys(filters)) filterForm.elements[key].value = filters[key] ?? '';
  $('#filter-error').hidden = true;
  filterDialog.showModal();
}

function resetFilters() {
  filters = {type:'', minPrice:null, maxPrice:null};
  filterForm.reset();
  renderCatalog();
  if (filterDialog.open) filterDialog.close();
}

for (const button of ['#open-filters','#mobile-filter']) $(button).addEventListener('click',openFilters);
$('#close-filters').addEventListener('click',() => filterDialog.close());
$('#reset-filters').addEventListener('click',resetFilters);
filterForm.addEventListener('submit',event => {
  event.preventDefault();
  const fields = filterForm.elements;
  const minPrice = fields.minPrice.value === '' ? null : fields.minPrice.valueAsNumber;
  const maxPrice = fields.maxPrice.value === '' ? null : fields.maxPrice.valueAsNumber;
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
    const error = $('#filter-error');
    error.textContent = 'Дээд үнэ доод үнээс бага байж болохгүй.';
    error.hidden = false;
    fields.maxPrice.focus();
    return;
  }
  filters = {type:fields.type.value,minPrice,maxPrice};
  renderCatalog();
  filterDialog.close();
  $('#catalog').scrollIntoView();
});

function applyLanding(settings) {
  document.body.dataset.theme = settings.theme;
  const hero = $('.hero');
  hero.dataset.position = settings.position;
  hero.dataset.mobilePosition = settings.mobile_position;
  hero.dataset.layout = settings.layout;
  deliveryNote = settings.delivery_note || '';
  const banner = $('#store-announcement');
  banner.textContent = settings.announcement;
  banner.hidden = !settings.announcement;
  $('#store-location').textContent = settings.location;
  const contact = $('#store-contact');
  contact.textContent = settings.contact;
  contact.hidden = !settings.contact;
  for (const logo of document.querySelectorAll('.storefront .brand img')) {
    logo.alt = settings.brand_name;
    if (settings.logo) logo.src = settings.logo;
    else if (settings.brand_name !== 'Tuya Brand') logo.replaceWith(node('span',settings.brand_name,'brand-wordmark'));
  }
  const heading = $('#hero-heading');
  if (settings.heading !== 'Монгол үндэсний хувцас') heading.textContent = settings.heading;
  $('#hero-description').textContent = settings.description;
  $('#hero-description').hidden = !settings.description;
  $('#shop-link').textContent = settings.action;
  const image = $('.hero-media img');
  image.alt = settings.alt;
  if (settings.image) {
    $('.hero-media source').srcset = settings.image;
    image.src = settings.image;
  }
}

async function openBag() {
  const opening = bagPanel('Таны сагс');
  opening.append(node('p','Үлдэгдэл шалгаж байна…','muted'));
  bagDialog.showModal();
  try {
    await loadProducts();
    if (bagDialog.open) renderBag();
  } catch (error) {
    if (bagDialog.open) bagPanel('Таны сагс').append(node('p',error.message,'form-message'));
  }
}
for (const button of ['#bag-button','#mobile-bag']) $(button).addEventListener('click',openBag);
productDialog.addEventListener('click', event => {
  if (event.target === productDialog) productDialog.close();
});
const fineMotion = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
if (fineMotion.matches) {
  const hero = $('.hero');
  hero.addEventListener('pointermove',event => {
    if (!fineMotion.matches || event.pointerType !== 'mouse') return;
    const {left,top,width,height} = hero.getBoundingClientRect();
    hero.style.setProperty('--hero-pan-x', ((event.clientX - left) / width - .5) * -16 + 'px');
    hero.style.setProperty('--hero-pan-y', ((event.clientY - top) / height - .5) * -12 + 'px');
  }, {passive:true});
  hero.addEventListener('pointerleave',() => {
    hero.style.removeProperty('--hero-pan-x');
    hero.style.removeProperty('--hero-pan-y');
  });
}

const topLink = $('#back-to-top');
if ('IntersectionObserver' in window) {
  const headerObserver = new IntersectionObserver(([entry]) => {
    topLink.hidden = entry.isIntersecting || entry.boundingClientRect.top > 0;
  }, {rootMargin:'-72px 0px 0px'});
  headerObserver.observe($('#hero-heading'));
}
if ('ResizeObserver' in window) {
  const header = $('.site-header');
  const resize = new ResizeObserver(() => document.body.style.setProperty('--header-offset',header.offsetHeight+'px'));
  resize.observe(header);
}
updateBag();
api('/api/storefront').then(applyLanding).catch(() => {});
loadProducts().catch(error => { status.textContent = error.message; });
