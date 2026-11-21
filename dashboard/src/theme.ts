import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Primary ramp = the sequential blue of the validated chart palette.
const brand: MantineColorsTuple = [
  '#eef5fd',
  '#cde2fb',
  '#9ec5f4',
  '#6da7ec',
  '#3987e5',
  '#2a78d6',
  '#256abf',
  '#1c5cab',
  '#184f95',
  '#104281',
];

export const theme = createTheme({
  primaryColor: 'brand',
  primaryShade: { light: 5, dark: 4 },
  colors: { brand },
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontFamilyMonospace: "ui-monospace, SFMono-Regular, 'Cascadia Mono', Menlo, Consolas, monospace",
  headings: { fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", fontWeight: '600' },
  defaultRadius: 'md',
  cursorType: 'pointer',
});
