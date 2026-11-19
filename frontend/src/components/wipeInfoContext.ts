import { createContext, useContext } from 'react';

export type WipeSide = 'first' | 'second';

type SlotPair = {
  first: HTMLElement | null;
  second: HTMLElement | null;
};

export const WipeInfoContext = createContext<{
  header: SlotPair;
  histogram: SlotPair;
  watermark: SlotPair;
  color: HTMLElement | null;
} | null>(null);

export function useWipeInfoSlot(side: WipeSide): HTMLElement | null {
  const slots = useContext(WipeInfoContext);
  return slots ? slots.header[side] : null;
}

export function useWipeOverlaySlot(
  kind: 'histogram' | 'watermark',
  side: WipeSide,
): HTMLElement | null {
  const slots = useContext(WipeInfoContext);
  return slots ? slots[kind][side] : null;
}

export function useWipeColorSlot(): HTMLElement | null {
  const slots = useContext(WipeInfoContext);
  return slots ? slots.color : null;
}
