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
          position: 'relative',
          background: '#6166F1',
          borderRadius: 7,
        }}
      >
        <div style={{ display: 'flex', position: 'absolute', left: 7.8, top: 8.7, width: 16.4, height: 4.1, background: '#ffffff', borderRadius: 2 }} />
        <div style={{ display: 'flex', position: 'absolute', left: 14, top: 8.7, width: 4.1, height: 14.6, background: '#ffffff', borderRadius: 2 }} />
      </div>
    ),
    { ...size }
  );
}
