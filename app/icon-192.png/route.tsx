import { ImageResponse } from 'next/og'

export const dynamic = 'force-static'

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" rx="112" fill="#1d4ed8"/>
  <circle cx="256" cy="256" r="172" fill="#ffffff"/>
  <g fill="#0d1117" stroke="#0d1117" stroke-width="14" stroke-linejoin="round" stroke-linecap="round">
    <polygon points="256,201 308,239 288,301 224,301 204,239"/>
    <line x1="256" y1="201" x2="256" y2="92"/>
    <line x1="308" y1="239" x2="416" y2="204"/>
    <line x1="288" y1="301" x2="354" y2="392"/>
    <line x1="224" y1="301" x2="158" y2="392"/>
    <line x1="204" y1="239" x2="96" y2="204"/>
  </g>
</svg>`

export function GET() {
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`
  return new ImageResponse(
    (
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={dataUrl} width={192} height={192} alt="" />
      </div>
    ),
    { width: 192, height: 192 }
  )
}
