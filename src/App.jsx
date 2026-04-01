import { useState, useRef, useEffect, useCallback } from 'react'
import { buildSide, chassisInnerPivots, deriveParams, instantCenter, rollCenterHeight, camberDeg, rcCurvePoints } from './suspension.js'

const BUILD_DATE = '01.04.2026 07:09'

const DEFAULTS = {
  rideH: 5.2, chassisH: 1.2,
  upperInnerYOffset: 29.46, upperInnerX: 19.15,
  lowerInnerYOffset: 1.0,   lowerInnerX: 8.23,
  upperOuterY: 44.49, upperArmLen: 49.20,
  lowerOuterY: 12.66, lowerArmLen: 61.92,
  halfTrack: 85.64, tireRadius: 31.84,
  jounce: 0, roll: 0,
}

const DARK = {
  bg:'#0D0F14',panel:'#090B10',border:'#151E2A',canvasBg:'#0D0F14',
  arm:'#00AAFF',upright:'#55B5F0',tire:'#121E2E',tireRim:'#4590C0',
  rim:'#0C1828',rimRing:'#3572B2',pivotIn:'#00FFAA',pivotOut:'#00CC88',
  ground:'#162434',centre:'#122035',ic:'#FF4080',rc:'#FFD700',rollAxis:'#FF3050',
  chassis:'rgba(24,48,72,0.7)',chassisBdr:'#5599BB',
  armExt:'rgba(0,204,255,0.32)',icLine:'rgba(255,80,48,0.5)',
  label:'rgba(112,168,208,0.85)',camber:'#00FFAA',camberPos:'#FFA000',
  value:'#00FFCC',dim:'#354855',hdr:'#00AAFF',good:'#00FFAA',rcColor:'#FFD700',
  infoBox:'#0E1420',infoBoxBdr:'#1A2535',text:'#E0E6F0',textDim:'#607080',
}
const LIGHT = {
  bg:'#F0F2F5',panel:'#E4E8EE',border:'#BBC8D8',canvasBg:'#F5F7FA',
  arm:'#0070CC',upright:'#1166BB',tire:'#CCD8E8',tireRim:'#2870AA',
  rim:'#AABBCC',rimRing:'#2266AA',pivotIn:'#00AA55',pivotOut:'#008844',
  ground:'#889AAA',centre:'#AABBCC',ic:'#CC1040',rc:'#AA7700',rollAxis:'#CC2040',
  chassis:'rgba(187,204,221,0.7)',chassisBdr:'#224488',
  armExt:'rgba(0,100,200,0.3)',icLine:'rgba(180,40,0,0.45)',
  label:'rgba(34,68,120,0.85)',camber:'#008844',camberPos:'#BB6600',
  value:'#006699',dim:'#889AAA',hdr:'#0055AA',good:'#008844',rcColor:'#AA7700',
  infoBox:'#F5F8FF',infoBoxBdr:'#BBCCDD',text:'#1A2A3A',textDim:'#607080',
}


function Slider({ label, value, min, max, step = 0.1, onChange, unit = 'mm', T }) {
  const sign = (label.includes('Federweg') || label.includes('Wanken')) && value >= 0 ? '+' : ''
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 1 }}>
        <span style={{ color: T.textDim, fontSize: 10, fontFamily: 'monospace' }}>{label}</span>
        <span style={{ color: T.value, fontSize: 11, fontFamily: 'monospace', fontWeight: 'bold', minWidth: 52, textAlign: 'right' }}>
          {sign}{value.toFixed(1)}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ accentColor: T.arm }} />
    </div>
  )
}

function Sec({ title, color, children, T }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ color: color || T.hdr, fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold', padding: '3px 0', borderBottom: `1px solid ${T.border}`, marginBottom: 6 }}>▸ {title}</div>
      {children}
    </div>
  )
}

function IBox({ label, children, T }) {
  return (
    <div style={{ background: T.infoBox, border: `1px solid ${T.infoBoxBdr}`, borderRadius: 3, padding: '5px 8px', marginBottom: 4 }}>
      <div style={{ color: T.textDim, fontSize: 8, fontFamily: 'monospace', marginBottom: 2 }}>{label}</div>
      {children}
    </div>
  )
}

// ── Drawing helpers ───────────────────────────────────────────────────────────
function line(ctx, x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke() }
function dot(ctx, x, y, r, color, alpha = 1) { ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1 }
function diamond(ctx, x, y, r, color, alpha = 1) { ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1 }
function ptLabel(ctx, x, y, txt, T) { ctx.fillStyle = T.label; ctx.font = '7.5px monospace'; ctx.textAlign = 'left'; ctx.fillText(txt, x, y) }
function extLine(ctx, a, b, ext, sx, sy) {
  const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy)
  if (l < 0.01) return
  ctx.beginPath()
  ctx.moveTo(sx(a.x - dx * ext / l), sy(a.y - dy * ext / l))
  ctx.lineTo(sx(a.x + dx * ext / l), sy(a.y + dy * ext / l))
  ctx.stroke()
}

function drawScene(canvas, s, zoom, T) {
  const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = T.canvasBg; ctx.fillRect(0, 0, W, H)
  // World bounds based on actual geometry settings
  const yTop    = s.rideH + s.chassisH + s.upperInnerYOffset + 8  // top of upper arm
  const yBot    = -4                                                 // below ground
  const xRange  = s.halfTrack + 15                                   // half total width
  const worldW  = xRange * 2
  const worldH  = yTop - yBot
  const scale   = Math.min(W / worldW, H / worldH) * zoom
  const ox      = W / 2
  // Centre vertically: world midpoint maps to screen centre
  const oy      = H / 2 + ((yTop + yBot) / 2) * scale
  const sx = wx => ox + wx * scale, sy = wy => oy - wy * scale
  const params = deriveParams(s)
  const hw = (params.upperInnerX + params.lowerInnerX) / 2
  const rr = Math.atan2(-s.roll, hw * 2)
  const { rUI, rLI, lUI, lLI } = chassisInnerPivots(params, s.jounce, rr)
  const R = buildSide(rUI, rLI, true, params), L = buildSide(lUI, lLI, false, params)
  if (!R || !L) return { rc: null, cam: null, ic: null }

  // Ground & centreline
  ctx.strokeStyle = T.ground; ctx.lineWidth = 2; ctx.setLineDash([])
  ctx.beginPath(); ctx.moveTo(sx(-220), sy(0)); ctx.lineTo(sx(220), sy(0)); ctx.stroke()
  ctx.strokeStyle = T.centre; ctx.lineWidth = 1; ctx.setLineDash([5, 4])
  ctx.beginPath(); ctx.moveTo(sx(0), sy(-5)); ctx.lineTo(sx(0), sy(120)); ctx.stroke(); ctx.setLineDash([])

  // IC lines (right only)
  ctx.strokeStyle = T.armExt; ctx.lineWidth = 1; ctx.setLineDash([6, 4])
  extLine(ctx, R.upperInner, R.upperOuter, 250, sx, sy)
  extLine(ctx, R.lowerInner, R.lowerOuter, 250, sx, sy)
  const icR = instantCenter(R)
  if (icR) {
    const cp = { x: R.wheelCenter.x, y: 0 }, dir = { x: icR.x - cp.x, y: icR.y - cp.y }, len = Math.hypot(dir.x, dir.y)
    if (len > 0.1) {
      ctx.strokeStyle = T.icLine; ctx.lineWidth = 1.3; ctx.setLineDash([8, 4])
      ctx.beginPath(); ctx.moveTo(sx(cp.x), sy(cp.y)); ctx.lineTo(sx(cp.x + dir.x * 400 / len), sy(cp.y + dir.y * 400 / len)); ctx.stroke()
    }
  }
  ctx.setLineDash([])

  // Tires
  for (const side of [R, L]) {
    const cx = sx(side.wheelCenter.x), cy = sy(side.wheelCenter.y)
    const tH = side.tireRadius * 2 * scale, tW = side.tireRadius * 0.5 * scale
    const angle = Math.atan2(side.upperOuter.x - side.lowerOuter.x, side.upperOuter.y - side.lowerOuter.y)
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(angle)
    ctx.fillStyle = T.tire; ctx.strokeStyle = T.tireRim; ctx.lineWidth = 1.8
    ctx.fillRect(-tW / 2, -tH / 2, tW, tH); ctx.strokeRect(-tW / 2, -tH / 2, tW, tH)
    ctx.fillStyle = T.rim; ctx.strokeStyle = T.rimRing; ctx.lineWidth = 1.2
    ctx.fillRect(-tW * .31, -tH * .28, tW * .62, tH * .56); ctx.strokeRect(-tW * .31, -tH * .28, tW * .62, tH * .56)
    ctx.restore()
    dot(ctx, cx, cy, 2 * scale, T.rimRing, 1)
    const cam = camberDeg(side), csign = cam >= 0 ? '+' : ''
    ctx.font = 'bold 11px monospace'
    ctx.fillStyle = cam < -0.3 ? T.camber : cam > 0.3 ? T.camberPos : T.text
    ctx.textAlign = 'center'
    ctx.fillText(`${csign}${cam.toFixed(2)}°`, cx, sy(side.wheelCenter.y + side.tireRadius + 7))
  }

  // Chassis
  const ch = s.chassisH, hW = 20, cY = s.rideH + ch / 2 - s.jounce, cos = Math.cos(rr), sin = Math.sin(rr)
  const rot = (lx, ly) => ({ x: lx * cos - ly * sin, y: cY + lx * sin + ly * cos })
  const bl = rot(-hW, -ch / 2), br = rot(hW, -ch / 2), tr = rot(hW, ch / 2), tl = rot(-hW, ch / 2)
  ctx.fillStyle = T.chassis; ctx.strokeStyle = T.chassisBdr; ctx.lineWidth = 1.5
  ctx.beginPath(); ctx.moveTo(sx(bl.x), sy(bl.y)); ctx.lineTo(sx(br.x), sy(br.y))
  ctx.lineTo(sx(tr.x), sy(tr.y)); ctx.lineTo(sx(tl.x), sy(tl.y)); ctx.closePath(); ctx.fill(); ctx.stroke()

  // Arms + pivots
  for (const [side, isR] of [[R, true], [L, false]]) {
    ctx.strokeStyle = T.arm; ctx.lineWidth = 2.5
    line(ctx, sx(side.upperInner.x), sy(side.upperInner.y), sx(side.upperOuter.x), sy(side.upperOuter.y))
    line(ctx, sx(side.lowerInner.x), sy(side.lowerInner.y), sx(side.lowerOuter.x), sy(side.lowerOuter.y))
    ctx.strokeStyle = T.upright; ctx.lineWidth = 2
    line(ctx, sx(side.upperOuter.x), sy(side.upperOuter.y), sx(side.lowerOuter.x), sy(side.lowerOuter.y))
    diamond(ctx, sx(side.upperInner.x), sy(side.upperInner.y), 2.5 * scale, T.pivotIn, 0.55)
    diamond(ctx, sx(side.lowerInner.x), sy(side.lowerInner.y), 2.5 * scale, T.pivotIn, 0.55)
    dot(ctx, sx(side.upperOuter.x), sy(side.upperOuter.y), 2.5 * scale, T.pivotOut, 0.55)
    dot(ctx, sx(side.lowerOuter.x), sy(side.lowerOuter.y), 2.5 * scale, T.pivotOut, 0.55)
    dot(ctx, sx(side.wheelCenter.x), sy(0), 2 * scale, T.rc, 0.55)
    const ox2 = isR ? 5 : -44, oxi = isR ? -44 : 5
    ptLabel(ctx, sx(side.upperOuter.x) + ox2, sy(side.upperOuter.y) - 4, `OA↑ Y${side.upperOuter.y.toFixed(1)}`, T)
    ptLabel(ctx, sx(side.lowerOuter.x) + ox2, sy(side.lowerOuter.y) + 12, `UA↓ Y${side.lowerOuter.y.toFixed(1)}`, T)
    ptLabel(ctx, sx(side.upperInner.x) + oxi, sy(side.upperInner.y) - 4, `OA-i Y${side.upperInner.y.toFixed(1)}`, T)
    ptLabel(ctx, sx(side.lowerInner.x) + oxi, sy(side.lowerInner.y) + 12, `UA-i Y${side.lowerInner.y.toFixed(1)}`, T)
  }

  // Roll centre
  const ic = instantCenter(R), rc = rollCenterHeight(R)
  if (ic) { dot(ctx, sx(ic.x), sy(ic.y), 3 * scale, T.ic, 1); ctx.fillStyle = T.ic; ctx.font = '8px monospace'; ctx.textAlign = 'left'; ctx.fillText('IC', sx(ic.x) + 5, sy(ic.y) + 4) }
  if (rc !== null) {
    const x0 = sx(0), y0 = sy(rc)
    ctx.strokeStyle = T.rc; ctx.lineWidth = 2; line(ctx, x0 - 15, y0, x0 + 15, y0); line(ctx, x0, y0 - 15, x0, y0 + 15)
    dot(ctx, x0, y0, 4.5 * scale, T.rc, 1); dot(ctx, x0, y0, 3 * scale, T.rollAxis, 1)
    ctx.strokeStyle = T.rc + '33'; ctx.lineWidth = 1; ctx.setLineDash([7, 5]); line(ctx, sx(-135), y0, sx(135), y0); ctx.setLineDash([])
    ctx.fillStyle = T.rcColor; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'left'
    ctx.fillText(`RC  ${rc >= 0 ? '+' : ''}${rc.toFixed(1)}mm`, x0 + 9, y0 + 5)
  }

  // RC curve
  const pts = rcCurvePoints(s)
  if (pts.length >= 2) {
    const m = 8, pw = 80, ph = 45, bx = W - pw - 14, by = H - ph - 26
    ctx.fillStyle = T.infoBox + 'EE'; ctx.strokeStyle = T.border; ctx.lineWidth = 1
    ctx.beginPath(); ctx.rect(bx - 3, by - 3, pw + 6, ph + 14); ctx.fill(); ctx.stroke()
    const rcV = pts.map(p => p.rc); let rMin = Math.min(...rcV), rMax = Math.max(...rcV)
    if (rMax - rMin < 2) { rMin -= 3; rMax += 3 }
    const rR = rMax - rMin, y0c = by + ph * (1 - (0 - rMin) / rR)
    if (y0c >= by && y0c <= by + ph) { ctx.strokeStyle = T.border; ctx.setLineDash([3, 3]); line(ctx, bx, y0c, bx + pw, y0c); ctx.setLineDash([]) }
    ctx.strokeStyle = T.rc; ctx.lineWidth = 1.5; ctx.beginPath()
    pts.forEach((p, i) => { const px = bx + pw * (p.j + 5) / 10, py = by + ph * (1 - (p.rc - rMin) / rR); i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py) })
    ctx.stroke()
    const near = pts.reduce((a, b) => Math.abs(a.j - s.jounce) < Math.abs(b.j - s.jounce) ? a : b)
    const mx = bx + pw * (near.j + 5) / 10, my = by + ph * (1 - (near.rc - rMin) / rR)
    dot(ctx, mx, my, 3, T.rc, 1); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(mx, my, 3, 0, Math.PI * 2); ctx.stroke()
    ctx.fillStyle = T.textDim; ctx.font = '7px monospace'; ctx.textAlign = 'center'
    ctx.fillText('RC −5→+5mm', bx + pw / 2, by + ph + 10)
  }

  return { rc, cam: camberDeg(R), ic }
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [s, setS] = useState({ ...DEFAULTS })
  const [zoom, setZoom] = useState(1.0)
  const [dark, setDark] = useState(false)
  const [info, setInfo] = useState({ rc: null, cam: null, ic: null })
  const canvasRef = useRef(null)
  const T = dark ? DARK : LIGHT
  const set = (k, v) => setS(p => ({ ...p, [k]: v }))

  const redraw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const parent = canvas.parentElement
    // Always use parent element size — most reliable on mobile
    const W = Math.round((parent ? parent.clientWidth  : canvas.clientWidth  || 300) * dpr)
    const H = Math.round((parent ? parent.clientHeight : canvas.clientHeight || 200) * dpr)
    if (W < 10 || H < 10) return  // not yet laid out
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width  = W
      canvas.height = H
      canvas.getContext('2d').scale(dpr, dpr)
    }
    setInfo(drawScene(canvas, s, zoom, T))
  }, [s, zoom, T])


  useEffect(() => {
    // Use rAF to ensure CSS layout is complete before measuring canvas
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(redraw)  // double rAF for mobile reliability
    })
    return () => cancelAnimationFrame(id)
  }, [redraw])
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ro = new ResizeObserver(redraw); ro.observe(canvas)
    return () => ro.disconnect()
  }, [redraw])

  const handleWheel = useCallback(e => { e.preventDefault(); setZoom(z => Math.max(0.3, Math.min(4, z + (e.deltaY < 0 ? 0.1 : -0.1)))) }, [])

  const saveSetup = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' })); a.download = 'setup.json'; a.click() }
  const loadSetup = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json'; inp.onchange = e => { const r = new FileReader(); r.onload = ev => { try { setS(p => ({ ...p, ...JSON.parse(ev.target.result) })) } catch {} }; r.readAsText(e.target.files[0]) }; inp.click() }

  const Btn = (label, onClick, color = T.hdr) => (
    <button onClick={onClick} style={{ flex: 1, background: T.infoBox, color, border: `1px solid ${color}`, borderRadius: 3, padding: '6px 4px', cursor: 'pointer', fontSize: 10, fontFamily: 'monospace', fontWeight: 'bold' }}>{label}</button>
  )
  const sl = (label, key, min, max) => <Slider key={key} label={label} value={s[key]} min={min} max={max} step={0.1} onChange={v => set(key, v)} T={T} />

  const p = deriveParams(s), hw = (p.upperInnerX + p.lowerInnerX) / 2, rr = Math.atan2(-s.roll, hw * 2)
  const { rUI, rLI } = chassisInnerPivots(p, s.jounce, rr)
  const R = buildSide(rUI, rLI, true, p)
  const uA = R ? Math.atan2(R.upperOuter.y - R.upperInner.y, R.upperOuter.x - R.upperInner.x) * 180 / Math.PI : null
  const lA = R ? Math.atan2(R.lowerOuter.y - R.lowerInner.y, R.lowerOuter.x - R.lowerInner.x) * 180 / Math.PI : null
  const rs = info.rc !== null && info.rc >= 0 ? '+' : '', cs = info.cam !== null && info.cam >= 0 ? '+' : ''

  return (
    <div className="app" style={{ background: T.bg, color: T.text, fontFamily: 'monospace', transition: 'background 0.2s' }}>

      {/* LEFT */}
      <div className="left" style={{ background: T.panel, borderRight: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}` }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ color: T.hdr, fontSize: 13, fontWeight: 'bold' }}>FAHRWERKS</div>
            <div style={{ color: T.text, fontSize: 13, fontWeight: 'bold', marginBottom: 8 }}>GEOMETRIE</div>
          </div>
          <div style={{ color: T.textDim, fontSize: 8, fontFamily:'monospace', opacity:0.5, marginTop:2 }}>{BUILD_DATE}</div>
        </div>

        <Sec title="CHASSIS" color="#FF8C00" T={T}>
          {sl('Unterboden-Höhe', 'rideH', 3, 8)}
          {sl('Chassis-Dicke', 'chassisH', 1, 2.5)}
        </Sec>
        <Sec title="OBERER QUERLENKER" T={T}>
          {sl('Innen Y (ab Chassisoberk.)', 'upperInnerYOffset', 5, 50)}
          {sl('Innen X', 'upperInnerX', 5, 45)}
          {sl('Aussen Y (Kugelgel.)', 'upperOuterY', 20, 65)}
          {sl('Länge Querlenker', 'upperArmLen', 30, 90)}
        </Sec>
        <Sec title="UNTERER QUERLENKER" T={T}>
          {sl('Innen Y (ab Chassisoberk.)', 'lowerInnerYOffset', 0, 15)}
          {sl('Innen X', 'lowerInnerX', 5, 45)}
          {sl('Aussen Y (Kugelgel.)', 'lowerOuterY', 0, 20)}
          {sl('Länge Querlenker', 'lowerArmLen', 30, 100)}
        </Sec>
        <Sec title="REIFEN & SPUR" T={T}>
          {sl('Halbspur', 'halfTrack', 70, 120)}
          {sl('Reifenradius', 'tireRadius', 18, 36)}
        </Sec>
        <Sec title="EINFEDERUNG / WANKEN" color={T.camber} T={T}>
          {sl('Federweg (+einf.)', 'jounce', -5, 5)}
          {sl('Wanken (+rechts)', 'roll', -5, 5)}
          <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
            {Btn('▶ Einfedern', () => { let d = 1; const id = setInterval(() => setS(p => { let v = p.jounce + d * 0.3; if (v >= 5) { v = 5; d = -1 } if (v <= -5) { v = -5; d = 1 } return { ...p, jounce: +v.toFixed(1) } }), 16); setTimeout(() => clearInterval(id), 4000) }, T.arm)}
            {Btn('↻ Wanken', () => { let d = 1; const id = setInterval(() => setS(p => { let v = p.roll + d * 0.3; if (v >= 5) { v = 5; d = -1 } if (v <= -5) { v = -5; d = 1 } return { ...p, roll: +v.toFixed(1) } }), 16); setTimeout(() => clearInterval(id), 4000) }, '#FF8C00')}
          </div>
        </Sec>

        <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 8, marginTop: 4 }}>
          <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
            {Btn('↺ Reset', () => setS({ ...DEFAULTS }), T.textDim)}
            {Btn(dark ? '☀ Hell' : '🌙 Dunkel', () => setDark(d => !d), '#FFCC44')}
          </div>
          <Sec title="SETUPS" color="#FF8C00" T={T}>
            <div style={{ display: 'flex', gap: 4 }}>
              {Btn('💾 Speichern', saveSetup, '#00CC66')}
              {Btn('📂 Laden', loadSetup, '#4488CC')}
            </div>
          </Sec>
          <div style={{ marginTop: 8 }}>
            <Slider label="🔍 Zoom" value={zoom} min={0.3} max={4} step={0.05} onChange={setZoom} unit="×" T={T} />
          </div>
        </div>
      </div>

      {/* CANVAS */}
      <div className="mid" style={{ background: T.canvasBg, maxWidth: 900, maxHeight: 640 }}>
        <canvas ref={canvasRef} onWheel={handleWheel}
          style={{ width: '100%', height: '100%', display: 'block', cursor: 'crosshair' }} />
      </div>

      {/* RIGHT */}
      <div className="right" style={{ background: T.panel, borderLeft: `1px solid ${T.border}`, borderTop: `1px solid ${T.border}` }}>
        <div style={{ color: T.hdr, fontSize: 11, fontWeight: 'bold', marginBottom: 8 }}>ANALYSE</div>
        <IBox label="ROLLZENTRUM" T={T}>
          <div style={{ fontSize: 17, color: T.rcColor, fontWeight: 'bold' }}>{info.rc !== null ? `${rs}${info.rc.toFixed(1)}mm` : '∞'}</div>
          <div style={{ color: T.dim, fontSize: 8 }}>{info.rc === null ? 'Querlenker parallel' : info.rc > 2 ? 'Über Fahrbahn ✓' : info.rc < -2 ? 'Unter Fahrbahn ⚠' : 'Auf Fahrbahn'}</div>
        </IBox>
        <IBox label="STURZ rechts (kinematisch)" T={T}>
          <div style={{ fontSize: 14, color: info.cam < -0.3 ? T.camber : info.cam > 0.3 ? T.camberPos : T.text, fontWeight: 'bold' }}>{info.cam !== null ? `${cs}${info.cam.toFixed(2)}°` : '–'}</div>
          <div style={{ color: T.dim, fontSize: 8 }}>{info.cam < -0.5 ? 'Negativsturz → Traktion' : info.cam > 0.5 ? 'Positivsturz' : 'Neutral'}</div>
        </IBox>
        <IBox label="MOMENTANPOL (IC)" T={T}>
          {info.ic ? <><div style={{ color: T.good, fontSize: 10, fontWeight: 'bold' }}>x={info.ic.x.toFixed(1)}mm</div><div style={{ color: T.good, fontSize: 10, fontWeight: 'bold' }}>y={info.ic.y.toFixed(1)}mm</div></> : <div style={{ color: T.good, fontWeight: 'bold' }}>Parallel (∞)</div>}
        </IBox>
        <IBox label="RC bei Federweg" T={T}>
          <div style={{ color: T.good, fontSize: 10, fontWeight: 'bold' }}>{info.rc !== null ? `bei ${s.jounce >= 0 ? '+' : ''}${s.jounce.toFixed(1)}mm: ${rs}${info.rc.toFixed(1)}mm` : '–'}</div>
        </IBox>
        <div style={{ borderTop: `1px solid ${T.border}`, margin: '8px 0 4px' }} />
        <div style={{ color: T.hdr, fontSize: 8, fontWeight: 'bold', marginBottom: 4 }}>ARMLÄNGEN</div>
        {[['Oberer Querlenker', s.upperArmLen.toFixed(1)], ['Unterer Querlenker', s.lowerArmLen.toFixed(1)], ['Radträger', p.uprightLength.toFixed(1)]].map(([l, v]) => (
          <IBox key={l} label={l} T={T}><div style={{ color: T.good, fontWeight: 'bold', fontSize: 10 }}>{v}mm</div></IBox>
        ))}
        <div style={{ borderTop: `1px solid ${T.border}`, margin: '8px 0 4px' }} />
        <div style={{ color: T.hdr, fontSize: 8, fontWeight: 'bold', marginBottom: 4 }}>WINKEL</div>
        {[['OA Winkel', uA], ['UA Winkel', lA]].map(([l, a]) => (
          <IBox key={l} label={l} T={T}><div style={{ color: T.good, fontWeight: 'bold', fontSize: 10 }}>{a !== null ? `${a >= 0 ? '+' : ''}${a.toFixed(2)}°` : '–'}</div></IBox>
        ))}
      </div>
    </div>
  )
}
