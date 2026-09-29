import { GAME_NAME } from '../identity';
import { patch } from './dom';

/** Dialog structure keeps headings/actions fixed while only the body scrolls. */
export class Dialogs {
  private opener: HTMLElement | null = null;
  constructor(readonly element: HTMLDialogElement) {}
  show(html: string) {
    const template = document.createElement('template');
    template.innerHTML = html;
    const title = template.content.querySelector('h2');
    if (title) {
      title.id = 'dialog-title';
      title.setAttribute('tabindex', '-1');
    }
    const footer = document.createElement('footer');
    footer.className = 'dialog-actions';
    for (const child of Array.from(template.content.children))
      if (child.matches('.actions, button')) footer.append(child);
    const heading = title?.outerHTML ?? `<h2 id="dialog-title" tabindex="-1">${GAME_NAME}</h2>`;
    title?.remove();
    const tabs = Array.from(template.content.children).find((child) => child.matches('.tabs'));
    const navigation = tabs?.outerHTML ?? '';
    tabs?.remove();
    const body = document.createElement('div');
    body.append(template.content);
    if (!this.element.open) this.opener = document.activeElement as HTMLElement | null;
    patch(
      this.element,
      `<header class="dialog-heading">${heading}${navigation}</header><div class="dialog-body" data-key="dialog-body">${body.innerHTML}</div>${footer.outerHTML}`,
    );
    this.element.setAttribute('aria-labelledby', 'dialog-title');
    if (!this.element.open) {
      this.element.showModal();
      this.element.querySelector<HTMLElement>('[autofocus], .primary, button, input')?.focus();
    }
  }
  close() {
    if (!this.element.open) return;
    this.element.close();
    if (this.opener?.isConnected) this.opener.focus({ preventScroll: true });
  }
}
