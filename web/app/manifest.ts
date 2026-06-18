import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             'Bellamore',
    short_name:       'Bellamore',
    description:      'Gestão de salões e estúdios de estética',
    start_url:        '/dashboard',
    display:          'standalone',
    orientation:      'portrait',
    background_color: '#FAF8F5',
    theme_color:      '#2C1750',
    icons: [
      {
        src:     '/icon',
        sizes:   '512x512',
        type:    'image/png',
        purpose: 'any',
      },
      {
        src:     '/apple-icon',
        sizes:   '180x180',
        type:    'image/png',
        purpose: 'maskable',
      },
    ],
    screenshots: [],
  };
}
