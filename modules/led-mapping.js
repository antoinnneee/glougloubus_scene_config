// LED matrix dimensions and physical mapping for the glougloubus device.
// 24 panels of 16×16 LEDs arranged in a 12×2 grid (logical 192×32).

export const WIDTH = 192;
export const HEIGHT = 32;

// Maps logical (col, row) coordinates to the physical LED index in the
// hardware chain. Used identically by the .bin export and the BLE stream.
//
// - Panels are numbered right-to-left, bottom-to-top (so panel 0 is the
//   bottom-right, panel 23 is the top-left).
// - Within each panel, rows are inverted vertically and alternate direction
//   (serpentine wiring): even local rows go right→left, odd ones left→right.
export function mapToLedIndex(col, row) {
  const NUMBER_OF_PANEL_WIDTH = 12;
  const NUMBER_OF_PANEL_HEIGHT = 2;
  const LED_PER_ROW = 16;
  const LED_PER_COL = 16;
  const LED_PER_PANEL = 256;

  if (col < 0 || row < 0) return -1;
  if (col > (NUMBER_OF_PANEL_WIDTH * LED_PER_ROW) - 1 ||
      row > (NUMBER_OF_PANEL_HEIGHT * LED_PER_COL) - 1) return -1;

  const panel_col = Math.floor(col / LED_PER_ROW);
  const panel_row = (NUMBER_OF_PANEL_HEIGHT - 1) - Math.floor(row / LED_PER_COL);
  const panel_index = panel_row * NUMBER_OF_PANEL_WIDTH + (NUMBER_OF_PANEL_WIDTH - 1 - panel_col);

  const local_col = col % LED_PER_ROW;
  const local_row = (LED_PER_COL - 1) - (row % LED_PER_COL);

  let local_led_index;
  if (local_row % 2 === 0) {
    local_led_index = local_row * LED_PER_ROW + (LED_PER_ROW - 1 - local_col);
  } else {
    local_led_index = local_row * LED_PER_ROW + local_col;
  }

  return panel_index * LED_PER_PANEL + local_led_index;
}

// HSL → RGB. h∈[0,360), s,l∈[0,100]. Used by the BLE test-pattern generator.
export function hslToRgb(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs(hp % 2 - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}
