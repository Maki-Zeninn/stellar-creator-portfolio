import { ImageResponse } from 'next/og';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
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
          borderRadius: 7,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 17,
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', width: 17, height: 3.5, background: '#ffffff', borderRadius: 1 }} />
          <div style={{ display: 'flex', width: 3.5, height: 15, background: '#ffffff', borderRadius: 1 }} />
        </div>
      </div>
    ),
    { ...size }
  );
}
