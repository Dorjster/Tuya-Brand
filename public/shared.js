export const $ = selector => document.querySelector(selector);
export const money = amount => '₮' + new Intl.NumberFormat('en-US').format(amount);

export function node(tag, text, className) {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  if (className) element.className = className;
  return element;
}

export function action(text, className, handler) {
  const button = node('button', text, className);
  button.type = 'button';
  button.addEventListener('click', handler);
  return button;
}

export function closeButton(dialog) {
  const button = action('×', 'close-button', () => dialog.close());
  button.setAttribute('aria-label', document.documentElement.lang === 'mn' ? 'Хаах' : 'Close');
  return button;
}

export async function api(path, { json, ...options } = {}) {
  if (json !== undefined) {
    options.body = JSON.stringify(json);
    options.headers = { 'Content-Type': 'application/json' };
  }
  const response = await fetch(path, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Could not reach the store. Try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function priceBlock(product) {
  const block = node('div', '', 'prices');
  block.append(node('strong', money(product.sale_price ?? product.price)));
  if (product.sale_price) block.append(node('del', money(product.price)));
  return block;
}
