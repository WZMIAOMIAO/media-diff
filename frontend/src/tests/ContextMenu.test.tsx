import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import ContextMenu from '../components/ContextMenu';

let menuSize = { width: 180, height: 170 };
const originalRect = HTMLElement.prototype.getBoundingClientRect;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: height,
  });
}

beforeEach(() => {
  menuSize = { width: 180, height: 170 };
  setViewport(1500, 900);
  // jsdom has no layout; give the menu a fixed size so the clamp is testable.
  HTMLElement.prototype.getBoundingClientRect = function () {
    const isMenu = this.getAttribute('role') === 'menu';
    const width = isMenu ? menuSize.width : 0;
    const height = isMenu ? menuSize.height : 0;
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      width,
      height,
      right: width,
      bottom: height,
      toJSON: () => ({}),
    } as unknown as DOMRect;
  };
});

afterEach(() => {
  cleanup();
  HTMLElement.prototype.getBoundingClientRect = originalRect;
});

async function renderMenu(x: number, y: number) {
  render(
    <ContextMenu x={x} y={y}>
      <div>唯一选项</div>
    </ContextMenu>,
  );
  const menu = screen.getByRole('menu');
  await waitFor(() => expect(menu.style.visibility).toBe('visible'));
  return menu;
}

describe('ContextMenu viewport clamping', () => {
  it('moves a bottom-right menu up/left so it stays on screen', async () => {
    const menu = await renderMenu(1450, 880);
    // maxLeft = 1500 - 180 - 8 = 1312 ; maxTop = 900 - 170 - 8 = 722
    expect(menu.style.left).toBe('1312px');
    expect(menu.style.top).toBe('722px');
  });

  it('keeps a menu that already fits at the cursor', async () => {
    const menu = await renderMenu(10, 10);
    expect(menu.style.left).toBe('10px');
    expect(menu.style.top).toBe('10px');
  });

  it('keeps an 8px margin at the top-left edge', async () => {
    const menu = await renderMenu(0, 0);
    expect(menu.style.left).toBe('8px');
    expect(menu.style.top).toBe('8px');
  });

  it('caps a menu taller than the viewport at the top edge', async () => {
    menuSize = { width: 180, height: 2000 };
    const menu = await renderMenu(100, 100);
    expect(menu.style.top).toBe('8px');
    // jsdom normalises calc() ordering, so only check the viewport unit.
    expect(menu.style.maxHeight).toContain('100vh');
    expect(menu.style.overflowY).toBe('auto');
  });

  it('renders its children', async () => {
    await renderMenu(10, 10);
    expect(screen.getByText('唯一选项')).toBeDefined();
  });
});
