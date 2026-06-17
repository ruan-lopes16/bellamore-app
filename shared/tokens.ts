export const COLORS = {
  primary:     '#2C1750',
  primarySoft: '#F0EBF8',
  accent:      '#8B5CF6',
  accentSoft:  '#EDE9FE',
  green:       '#16A34A',
  greenSoft:   '#F0FDF4',
  rose:        '#E8729A',
  roseSoft:    '#FFF1F5',
  amber:       '#F59E0B',
  amberSoft:   '#FFFBEB',
  indigo:      '#6366F1',
  indigoSoft:  '#EEF2FF',

  ink:   '#1A1A2E',
  ink2:  '#3D3D56',
  ink3:  '#6B6B80',
  ink4:  '#9CA3AF',

  bg:      '#F4F0EA',
  bg2:     '#EDE8E0',
  surface: '#FFFFFF',
  border:  '#E5E0D8',
  borderSoft: '#F0ECE4',
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  full: 999,
} as const;

export const SHADOW = {
  card: { color: '#2C1750', opacity: 0.06, radius: 6, offset: { x: 0, y: 2 } },
  hero: { color: '#2C1750', opacity: 0.20, radius: 36, offset: { x: 0, y: 12 } },
} as const;

export const ANIM = {
  stagger: 60,
  countUp: 900,
  popDuration: 500,
  drawDuration: 550,
  drawDelay: 300,
  tiltMax: 6,
  tiltPerspective: 700,
  easeOut: [0.2, 0.9, 0.3, 1] as const,
} as const;

export const FONT = {
  serif: 'Cormorant Garamond',
  sans:  'Plus Jakarta Sans',
} as const;
