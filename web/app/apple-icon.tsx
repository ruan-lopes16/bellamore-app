import { ImageResponse } from 'next/og';

export const size        = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'linear-gradient(135deg, #2C1750, #4A2A86)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '40px',
      }}
    >
      <span style={{ color: 'white', fontSize: '108px', lineHeight: 1, fontFamily: 'serif' }}>
        ✦
      </span>
    </div>,
    { ...size },
  );
}
