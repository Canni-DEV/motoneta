/** Reconcile small DOM views without losing focus, selection, scroll or the WebGL canvas. */
export function patch(root: Element, html: string) {
  const template = document.createElement('template');
  template.innerHTML = html;
  reconcile(root, template.content);
}

function key(node: Node): string | null {
  if (!(node instanceof Element)) return null;
  return node.id || node.getAttribute('data-key');
}
function compatible(a: Node, b: Node) {
  return a.nodeType === b.nodeType && a.nodeName === b.nodeName && key(a) === key(b);
}
function reconcile(parent: Node, desired: Node) {
  let cursor = parent.firstChild;
  for (const next of Array.from(desired.childNodes)) {
    let current: Node | null = cursor;
    if (!current || !compatible(current, next)) {
      const id = key(next);
      current = id
        ? (Array.from(parent.childNodes).find((n) => compatible(n, next)) ?? null)
        : null;
      if (current) parent.insertBefore(current, cursor);
      else {
        current = next.cloneNode(true);
        parent.insertBefore(current, cursor);
      }
    }
    update(current, next);
    cursor = current.nextSibling;
  }
  while (cursor) {
    const next = cursor.nextSibling;
    parent.removeChild(cursor);
    cursor = next;
  }
}
function update(current: Node, desired: Node) {
  if (!(current instanceof Element) || !(desired instanceof Element)) {
    if (current.nodeValue !== desired.nodeValue) current.nodeValue = desired.nodeValue;
    return;
  }
  for (const attr of Array.from(current.attributes))
    if (!desired.hasAttribute(attr.name)) current.removeAttribute(attr.name);
  for (const attr of Array.from(desired.attributes))
    if (current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
  // The renderer owns this subtree. Moving or replacing its canvas loses the drawing buffer.
  if (current.hasAttribute('data-scene-host')) return;
  reconcile(current, desired);
  if (current instanceof HTMLInputElement && desired instanceof HTMLInputElement) {
    if (
      current.type !== 'file' &&
      document.activeElement !== current &&
      current.value !== desired.value
    )
      current.value = desired.value;
    current.checked = desired.checked;
  }
  if (current instanceof HTMLSelectElement && desired instanceof HTMLSelectElement)
    current.value = desired.value;
}
