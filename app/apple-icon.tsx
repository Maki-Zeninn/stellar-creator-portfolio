import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#000000',
          borderRadius: 37,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 96,
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', width: 96, height: 20, background: '#ffffff', borderRadius: 7 }} />
          <div style={{ display: 'flex', width: 20, height: 84, background: '#ffffff', borderRadius: 7 }} />
        </div>
      </div>
    ),
    { ...size }
  );
}
