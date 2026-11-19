import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import WipeStack from '../components/WipeStack';

describe('WipeStack', () => {
  it('renders two clipped layers with a 50% divider by default', () => {
    const { container } = render(
      <WipeStack first={<div>first</div>} second={<div>second</div>} />,
    );
    const stack = container.querySelector('[data-wipe="stack"]') as HTMLElement;
    const second = container.querySelector('[data-wipe="second"]') as HTMLElement;
    const divider = container.querySelector('[data-wipe="divider"]') as HTMLElement;

    expect(stack.style.getPropertyValue('--wipe')).toBe('50%');
    expect(second.style.clipPath).toContain('var(--wipe)');
    expect(divider.style.left).toContain('var(--wipe)');
    expect(container.textContent).toContain('first');
    expect(container.textContent).toContain('second');
  });

  it('double-clicking the divider restores 50%', () => {
    const { container } = render(
      <WipeStack first={<div>first</div>} second={<div>second</div>} />,
    );
    const stack = container.querySelector('[data-wipe="stack"]') as HTMLElement;
    const divider = container.querySelector('[data-wipe="divider"]') as HTMLElement;

    stack.style.setProperty('--wipe', '17%');
    fireEvent.doubleClick(divider);

    expect(stack.style.getPropertyValue('--wipe')).toBe('50%');
  });
});
