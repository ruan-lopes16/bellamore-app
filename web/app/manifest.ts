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
        // '/icon' (sem extensão) dá 404 nesta versão do Next — a rota gerada
        // é '/icon.png' (mesmo bug já documentado em public/sw.js).
        src:     '/icon.png',
        sizes:   '512x512',
        type:    'image/png',
        purpose: 'any',
      },
      {
        src:     '/apple-icon.png',
        sizes:   '180x180',
        type:    'image/png',
        purpose: 'maskable',
      },
    ],
    screenshots: [],
  };
}
