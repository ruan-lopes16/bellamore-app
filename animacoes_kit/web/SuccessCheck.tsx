'use client';
// SuccessCheck — círculo verde com pop + checkmark que se desenha.
//   <SuccessCheck size={84} />

type Props = {
  size?: number;
  color?: string;       // cor do check
  bg?: string;          // cor do círculo
};

export default function SuccessCheck({ size = 84, color = '#157A5B', bg = '#E6F6EF' }: Props) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 999, background: bg,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 6px 20px rgba(44,23,80,0.09)',
        animation: 'bm-pop .5s cubic-bezier(.2,.9,.3,1) both',
      }}
    >
      <svg
        width={size * 0.52} height={size * 0.52} viewBox="0 0 24 24"
        fill="none" stroke={color} strokeWidth="2.5"
        strokeLinecap="round" strokeLinejoin="round"
      >
        <path
          d="M20 6L9 17l-5-5"
          style={{
            strokeDasharray: 30,
            strokeDashoffset: 30,
            animation: 'bm-draw .55s .3s ease forwards',
          }}
        />
      </svg>
    </div>
  );
}
