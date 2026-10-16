import { loadIdentity } from './api.js';

let renderFn = () => {};
export const setRenderer = (fn) => { renderFn = fn; };

export function go(path) {
  const target = `#/${path}`;
  if (location.hash === target || (target === '#/' && !location.hash)) renderFn();
  else location.hash = target;
}

// Reload who the user is (after sign-in, approval, etc.) and redraw.
export async function refresh(path) {
  await loadIdentity();
  if (path != null) go(path); else renderFn();
}
