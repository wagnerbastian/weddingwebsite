import type { ColorMode, SeatData, SeatingTableData } from './types';

/** The longest a name on a seat chip gets before it ends in an ellipsis. */
export const CHIP_NAME_MAX = 200;

/** The name a seat chip shows. */
export function chipName(seat: SeatData): string {
  return seat.display_name || seat.guest_name || '?';
}

/** Whether a seat chip carries the ⚠ of a split party. */
export function chipWarns(seat: SeatData, splitPartyGroupIds: Set<number>, colorMode: ColorMode): boolean {
  return colorMode === 'party' && seat.party_group_id !== null && splitPartyGroupIds.has(seat.party_group_id);
}

let canvas: HTMLCanvasElement | null = null;

/**
 * How wide each seat chip of a table is, in seat-list order — what
 * `tableLayout()` sizes the table by.
 *
 * Measured with a canvas in the chip's own font rather than by rendering the
 * chips and reading them back, so the layout is known before anything is drawn
 * and the table never jumps a frame after it appears. Mirrors SeatChip: a 1px
 * border and 8px of padding each side, the name capped at CHIP_NAME_MAX, and
 * the ⚠ with its 6px of spacing when it shows. A pixel over is harmless — the
 * layout leaves room between chips — so it rounds up.
 */
export function seatChipWidths(
  table: SeatingTableData,
  splitPartyGroupIds: Set<number>,
  colorMode: ColorMode,
): number[] {
  const ctx = typeof document === 'undefined'
    ? null
    : (canvas ??= document.createElement('canvas')).getContext('2d');
  if (ctx) ctx.font = `500 12px ${getComputedStyle(document.body).fontFamily}`;
  // No canvas (never on the canvas page, but the type allows it): a fair guess
  // at 12px text beats a layout that has no widths at all.
  const measure = (text: string) => (ctx ? ctx.measureText(text).width : text.length * 7);

  return table.seats.map(seat => {
    const name = Math.min(CHIP_NAME_MAX, measure(chipName(seat)));
    const warn = chipWarns(seat, splitPartyGroupIds, colorMode) ? measure('⚠') + 6 : 0;
    return Math.ceil(2 + 16 + name + warn) + 1;
  });
}
