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
          position: 'relative',
          background: '#6166F1',
          borderRadius: 40,
        }}
      >
        <div style={{ display: 'flex', position: 'absolute', left: 44, top: 49, width: 92, height: 23, background: '#ffffff', borderRadius: 11.5 }} />
        <div style={{ display: 'flex', position: 'absolute', left: 78.5, top: 49, width: 23, height: 82, background: '#ffffff', borderRadius: 11.5 }} />
      </div>
    ),
    { ...size }
  );
}
