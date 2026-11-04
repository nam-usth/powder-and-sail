// ── PERIOD GLYPHS (AW-HUD) ─────────────────────────────────────────
// Engraving-style ink glyphs for the in-game HUD — anchor, cannon, sails,
// ship's wheel, spyglass, hammer, flag, compass, powder keg, coin, timber…
//
// One source of truth, no build step: on import this module injects a
// <style id="iow-glyphs"> holding
//   :root { --g-<name>: url("data:image/svg+xml,…") }    one per glyph
//   .gi            inline-block, 1em square, painted in currentColor
//   .gi-<name>     picks the glyph (CSS mask)
// so static markup (index.html), JS templates and CSS pseudo-elements on
// elements we do not own (e.g. #cmd-bar) all share the same drawings:
//   <i class="gi gi-anchor" aria-hidden="true"></i>
//   #cmd-barrage .cmd-ic::before { -webkit-mask-image: var(--g-broadside); }
//
// Every glyph is drawn on a 24×24 grid in black; the mask turns it into
// currentColor. Main strokes are ~1.6 wide, hatching ~.75 at lower alpha
// (the "engraved" shading survives as lighter ink).
//
// Strings returned by the helpers are built from constants only — safe to
// concatenate into innerHTML.

// paint presets — call with an override instead of repeating an attribute
// (a duplicated attribute makes the whole SVG invalid and the glyph vanishes)
const sw = (w = 1.6) => `fill='none' stroke='%23000' stroke-width='${w}' stroke-linecap='round' stroke-linejoin='round'`;
const hw = (o = .6, w = .8) => `fill='none' stroke='%23000' stroke-width='${w}' stroke-linecap='round' opacity='${o}'`;   // hatching
const fw = (w = 1.2) => `fill='%23000' stroke='%23000' stroke-width='${w}' stroke-linejoin='round'`;
const S = sw(), H = hw(), FS = fw();
const F = "fill='%23000' stroke='none'";

/** name → inner SVG markup (24×24). Keep paths simple: they render at 14–28 px. */
export const GLYPHS = {
  anchor: `<g ${S}><circle cx='12' cy='4.3' r='1.9'/><path d='M12 6.2V20.4M7.6 8.6h8.8'/><path d='M4.4 13.4c.6 4.2 3.8 6.9 7.6 7.1 3.8-.2 7-2.9 7.6-7.1'/></g><path ${F} d='M2.6 12.6l3.6.5-2.3 3zM21.4 12.6l-3.6.5 2.3 3z'/><circle ${F} cx='7.2' cy='8.6' r='.9'/><circle ${F} cx='16.8' cy='8.6' r='.9'/><path ${H} d='M8.4 18.4l.9-1.2M10.2 19.4l.6-1.3M13.2 19.4l-.6-1.3M15 18.4l-.9-1.2'/>`,
  cannon: `<g ${S}><path d='M4.1 10.4l14.3-2.3c1-.2 1.8.5 1.9 1.4l.1.6c.1 1-.5 1.8-1.5 1.9L4.6 13.6c-1 .1-1.7-.6-1.7-1.5v-.3c0-.7.5-1.3 1.2-1.4z'/><path d='M6.3 13.4l-.9 4.4h8.8l-.6-5.4'/><circle cx='7.6' cy='18.2' r='2.1'/><circle cx='13.2' cy='18.2' r='2.1'/></g><circle ${F} cx='2.3' cy='11.9' r='1.1'/><path ${H} d='M8.6 10v2.6M12.4 9.4v2.6M16.6 8.8v2.4M5.4 12.6h1.6M9.6 12h2'/>`,
  galleon: `<g ${S}><path d='M2.6 14.6h18.4l-2 4.4c-.3.6-.8.9-1.5.9H6.3c-.7 0-1.2-.3-1.5-.9z'/><path d='M2.6 14.6v-2.4h3.6v2.4M21 14.6l1.8-2.6M7.2 14.6V6M12 14.6V2.6M16.8 14.6V4.4'/></g><g ${fw(1)} fill-opacity='.35'><path d='M9.4 4.2h5.2q.5 1.8 0 3.6-2.6.6-5.2 0-.5-1.8 0-3.6zM9 8.8h6q.5 2 0 4-3 .6-6 0-.5-2 0-4zM14.8 5.8h4q.4 1.6 0 3.2-2 .5-4 0-.4-1.6 0-3.2zM14.6 10h4.4q.4 1.4 0 2.8-2.2.5-4.4 0-.4-1.4 0-2.8zM7.2 6.6L4.2 12h6z'/></g><path ${H} d='M4.2 17.2h15.4M6.6 18.8h11'/>`,
  brig: `<g ${S}><path d='M3.2 15h17.6l-1.9 4.2c-.3.6-.8.9-1.5.9H6.6c-.7 0-1.2-.3-1.5-.9z'/><path d='M20.8 15l1.8-2.6M8.6 15V4M15.2 15V3'/></g><g ${fw(1)} fill-opacity='.35'><path d='M5.8 5h5.6q.5 1.8 0 3.6-2.8.6-5.6 0-.5-1.8 0-3.6zM5.4 9.6h6.4q.5 1.9 0 3.8-3.2.6-6.4 0-.5-1.9 0-3.8zM12.4 4.2h5.6q.5 1.8 0 3.6-2.8.6-5.6 0-.5-1.8 0-3.6zM12 9h6.4q.5 2 0 4-3.2.6-6.4 0-.5-2 0-4z'/></g><path ${H} d='M5 17.6h14'/>`,
  sloop: `<g ${S}><path d='M4.2 15.6h15.6l-1.7 3.8c-.3.6-.8 1-1.5 1H7.4c-.7 0-1.2-.4-1.5-1z'/><path d='M11 15.6V3.2'/></g><path ${FS} d='M11.8 4.2c3.3 2.6 5.5 6.2 6.2 10.2h-6.2zM10.2 6.2c-2.2 2.2-3.6 5-4.2 8.2h4.2z'/><path ${H} d='M5.6 17.8h12.4'/>`,
  sail: `<g ${S}><path d='M12 2.4v19.2M4.4 4.8h15.2M6.4 17.2h11.2'/><path d='M5.2 4.8c-1.4 4.2-.8 8.6 1.2 12.4M18.8 4.8c1.4 4.2.8 8.6-1.2 12.4'/></g><path ${H} d='M6.6 8.4c3.4 1 7.4 1 10.8 0M6.4 11.8c3.6 1 7.6 1 11.2 0M7 15c3.2.8 6.8.8 10 0'/><path ${F} d='M12 2.4l4 1.2-4 1.2z'/>`,
  wheel: `<g ${S}><circle cx='12' cy='12' r='5.4'/><circle cx='12' cy='12' r='1.7'/><path d='M12 1.6V22.4M1.6 12H22.4M4.6 4.6l14.8 14.8M19.4 4.6L4.6 19.4'/></g><path ${H} d='M8.6 8.2a4.8 4.8 0 0 1 6.8 0'/>`,
  spyglass: `<g ${S}><path d='M2.8 15.6l4.4-2.5 1.6 2.8-4.4 2.5zM7.2 13.1l6.3-3.6 2 3.4-6.3 3.6zM13.5 9.5l5.8-3.3 2.2 3.8-5.8 3.3z'/><path d='M9.4 16.4l-1.6 5M11 15.4l3 5.4'/></g><path ${H} d='M15.2 9.6l1.6 2.7M17.4 8.4l1.6 2.8M9.4 12.4l1.2 2'/>`,
  hammer: `<g ${S}><path d='M4.3 20.2l9.3-9.3' stroke-width='2.4'/><path d='M10.2 6.6l3.6-3.2 6.8 6.8-3.2 3.6z'/><path d='M13.8 3.4c1.6-.8 3.1-.6 4.3.4'/></g><path ${H} d='M12.4 7.2l4.4 4.4M14.2 5.6l4.2 4.2'/>`,
  tools: `<g ${S}><path d='M3.6 20.4l9-9' stroke-width='2.2'/><path d='M9.6 7.2l3.2-3 5.8 5.8-3 3.2z'/><path d='M20.4 20.4L8.6 8.6'/><path d='M8.6 8.6l-3.4 1.2L4 6.4 6.4 4l3.4 1.2z'/></g><path ${H} d='M18.6 17.2l-1 1M16.6 15.2l-1 1M14.6 13.2l-1 1M12.6 11.2l-1 1'/>`,
  flag: `<g ${S}><path d='M5.6 21.6V3.2'/><path d='M5.6 4.2c2.9-1.5 5.4 1.4 8.2 0 2.3-1.1 3.8-1 5.6-.2v8.3c-1.8-.8-3.3-.9-5.6.2-2.8 1.4-5.3-1.5-8.2 0'/></g><circle ${F} cx='5.6' cy='2.6' r='1'/><path ${H} d='M8.2 6.2v4.6M10.8 6.6v4.8M13.6 5.6v5M16.4 4.6v4.8'/>`,
  pennant: `<g ${S}><path d='M5 21.6V2.8'/><path d='M5 3.6l15.4 3.9L5 11.4'/></g><path ${H} d='M7.6 5.6v4M10.4 6.2v2.8M13.2 6.8v1.4'/>`,
  compass: `<g ${sw(1.3)}><circle cx='12' cy='12' r='6.6'/></g><path ${FS} d='M12 1.8l1.7 8.5L12 12zM22.2 12l-8.5 1.7L12 12zM12 22.2l-1.7-8.5L12 12zM1.8 12l8.5-1.7L12 12z'/><path ${sw(1.1)} d='M12 1.8l-1.7 8.5L12 12M22.2 12l-8.5-1.7L12 12M12 22.2l1.7-8.5L12 12M1.8 12l8.5 1.7L12 12'/><path ${sw(1)} d='M12 12l4.6-4.6M12 12l4.6 4.6M12 12l-4.6 4.6M12 12L7.4 7.4'/>`,
  keg: `<g ${S}><path d='M7.2 4.2h9.6c1.6 2.4 2.4 5 2.4 7.8s-.8 5.4-2.4 7.8H7.2C5.6 17.4 4.8 14.8 4.8 12s.8-5.4 2.4-7.8z'/><path d='M5.6 8h12.8M5.6 16h12.8'/></g><path ${H} d='M9.4 4.4c-.8 2.4-1.2 5-1.2 7.6s.4 5.2 1.2 7.6M14.6 4.4c.8 2.4 1.2 5 1.2 7.6s-.4 5.2-1.2 7.6M12 4.4v15.2'/><path ${sw(1.2)} d='M12 4.2c0-1.4 1.2-2.3 2.6-1.9'/>`,
  coin: `<g ${S}><circle cx='12' cy='12' r='8.6'/></g><circle cx='12' cy='12' r='6.3' fill='none' stroke='%23000' stroke-width='.9' stroke-dasharray='.9 1.1'/><path ${sw(1.5)} d='M12 8.2v7.6M8.2 12h7.6'/><path ${F} d='M10.6 8.2h2.8l-1.4 1.6zM10.6 15.8h2.8L12 14.2zM8.2 10.6v2.8L9.8 12zM15.8 10.6v2.8L14.2 12z'/>`,
  timber: `<g ${S}><circle cx='6.8' cy='16.4' r='3.6'/><circle cx='17.2' cy='16.4' r='3.6'/><circle cx='12' cy='8.6' r='3.6'/></g><g ${hw(.7)}><circle cx='6.8' cy='16.4' r='1.6'/><circle cx='17.2' cy='16.4' r='1.6'/><circle cx='12' cy='8.6' r='1.6'/></g><circle ${F} cx='6.8' cy='16.4' r='.5'/><circle ${F} cx='17.2' cy='16.4' r='.5'/><circle ${F} cx='12' cy='8.6' r='.5'/>`,
  chest: `<g ${S}><path d='M3.6 11.2h16.8v8.6H3.6z'/><path d='M3.6 11.2V9.4c0-2.6 3.6-4.2 8.4-4.2s8.4 1.6 8.4 4.2v1.8'/><path d='M7.6 5.8v14M16.4 5.8v14'/></g><path ${fw(.8)} d='M10.6 10.2h2.8v3.4h-2.8z'/><path ${H} d='M4.6 14h2M4.6 16.6h2M17.4 14h2M17.4 16.6h2M9 9.6l1-2M15 9.6l-1-2'/>`,
  crate: `<g ${S}><path d='M4 6.4h16v13.2H4z'/><path d='M4 6.4l16 13.2M20 6.4L4 19.6'/></g><path ${H} d='M4 10h2M18 10h2M4 16h2M18 16h2'/>`,
  skull: `<g ${S}><path d='M12 3.6c-3.9 0-6.4 2.5-6.4 5.9 0 2 .9 3.5 2.4 4.3v2.3h8v-2.3c1.5-.8 2.4-2.3 2.4-4.3 0-3.4-2.5-5.9-6.4-5.9z'/><path d='M10.4 16.2v1.4M12 16.2v1.4M13.6 16.2v1.4'/><path d='M4 17.4l16 4.2M20 17.4L4 21.6' stroke-width='1.4'/></g><circle ${F} cx='9.6' cy='9.8' r='1.5'/><circle ${F} cx='14.4' cy='9.8' r='1.5'/><path ${F} d='M12 11.4l.9 1.8h-1.8z'/>`,
  sabres: `<g ${S}><path d='M5.2 18.8C9.6 15 13.8 10 18.6 4.2l.6 1.6C15 11.2 11 15.6 6.6 19.6'/><path d='M18.8 18.8C14.4 15 10.2 10 5.4 4.2l-.6 1.6C9 11.2 13 15.6 17.4 19.6'/><path d='M3.4 16.6l4 4M20.6 16.6l-4 4'/></g><circle ${F} cx='3.6' cy='21' r='1.1'/><circle ${F} cx='20.4' cy='21' r='1.1'/>`,
  cutlass: `<g ${S}><path d='M5.2 13.2h11.6c1.8 0 3.4-1 4.6-2.8-1.6.4-3.2.6-4.8.6H5.2'/><path d='M5.2 9.4v5.6M2.4 12.2h2.8'/><path d='M5.2 15c-1.4 1.6-1.6 3.4-.4 4.6'/></g><path ${H} d='M8 11.6h8.4'/>`,
  buckler: `<g ${S}><path d='M12 2.8l7.6 2.6v5.8c0 4.8-3.2 8.2-7.6 10-4.4-1.8-7.6-5.2-7.6-10V5.4z'/><path d='M12 2.8v18.4M4.4 10.4h15.2'/></g><path ${H} d='M6 6.4l4.4 3.2M6.2 8.6l2.6 1.8M13.6 12.2l4.4 3M13.6 14.6l3 2.2M14 11.8l5.4 1.4'/>`,
  hand: `<g ${S}><path d='M8.4 13.2V5.8a1.3 1.3 0 0 1 2.6 0v5.6M11 11.2V4.4a1.3 1.3 0 0 1 2.6 0v6.8M13.6 11.2V5.4a1.3 1.3 0 0 1 2.6 0v6.4M16.2 12V8a1.3 1.3 0 0 1 2.6 0v6c0 4.2-2.6 7.2-6.6 7.2-3.2 0-5-1.6-6.4-4L3.7 13.8a1.4 1.4 0 0 1 2.3-1.6l2.4 3'/></g>`,
  hourglass: `<g ${S}><path d='M5.6 2.8h12.8M5.6 21.2h12.8'/><path d='M7.4 2.8c0 5 4.2 6.4 4.2 9.2S7.4 16.2 7.4 21.2M16.6 2.8c0 5-4.2 6.4-4.2 9.2s4.2 4.2 4.2 9.2'/></g><path ${F} d='M9 20.6h6l-3-3.6zM9.6 6.4h4.8L12 9.4z'/>`,
  astrolabe: `<g ${S}><circle cx='12' cy='13.4' r='8'/><circle cx='12' cy='3.2' r='1.3'/><path d='M12 4.5v.9'/></g><path ${F} d='M12 7.6l1.2 4.6 4.6 1.2-4.6 1.2-1.2 4.6-1.2-4.6-4.6-1.2 4.6-1.2z'/><path ${H} d='M12 5.8v1M12 20v1M4.4 13.4h1M18.6 13.4h1M6.6 8l.7.7M16.7 18.1l.7.7M17.4 8l-.7.7M7.3 18.1l-.7.7'/>`,
  scales: `<g ${S}><path d='M12 4.6v15.6M8 20.6h8M4.6 7.2h14.8'/><path d='M4.6 7.2l-2.2 6.4M4.6 7.2l2.2 6.4M19.4 7.2l-2.2 6.4M19.4 7.2l2.2 6.4'/><path d='M1.8 13.6c.8 2.2 4.8 2.2 5.6 0zM16.6 13.6c.8 2.2 4.8 2.2 5.6 0z'/></g><circle ${F} cx='12' cy='3.6' r='1.3'/>`,
  cloud: `<g ${S}><path d='M6.6 15.4h10.8c2.2 0 3.8-1.5 3.8-3.4 0-2-1.6-3.4-3.4-3.3-.6-2.6-2.8-4.3-5.4-4.3-2.8 0-5 2-5.4 4.6-2.2.2-4 1.7-4 3.4 0 1.7 1.6 3 3.6 3z'/><path d='M4 18.6h11M8 21.4h12' stroke-width='1.3'/></g><path ${H} d='M8.6 12.6c1.4.8 3.4.9 5 .2'/>`,
  wind: `<g ${S}><path d='M2.6 8.4h11.2c2.4 0 3.4-2.6 1.9-3.9-1.2-1-3-.2-2.8 1.2'/><path d='M2.6 12.4h16c2.6 0 3.2 3.2 1.2 4.1-1.4.6-2.8-.4-2.4-1.6'/><path d='M2.6 16.4h8.2'/></g><path ${H} d='M4.4 20h5.2M13 20h3'/>`,
  island: `<g ${S}><path d='M3.4 17.6c2.8-3.2 14.4-3.2 17.2 0z'/><path d='M12.6 15.4c.4-3.4-.2-6-1.6-8.2'/><path d='M11 7.2c-2.2-1.8-5-1.4-6.4.4M11 7.2c-.6-2.6-2.6-4-4.4-3.8M11 7.2c2-2.2 5-2.2 6.6-.6M11 7.2c2.4-.4 4.6 1.2 5 3.4'/></g><path ${sw(1.2)} d='M2 20.6c1.5-1 3-1 4.5 0s3 1 4.5 0 3-1 4.5 0 3 1 4.5 0'/>`,
  crown: `<g ${S}><path d='M4.2 17L3 7.6l5 3.6 4-6.2 4 6.2 5-3.6L19.8 17z'/><path d='M4.2 17h15.6v2.8H4.2z'/></g><circle ${F} cx='3' cy='7.4' r='1.2'/><circle ${F} cx='12' cy='4.8' r='1.2'/><circle ${F} cx='21' cy='7.4' r='1.2'/><path ${H} d='M7 18.4h1.4M11.3 18.4h1.4M15.6 18.4H17'/>`,
  fleur: `<g ${S}><path d='M12 2.6c-2.4 3-2.6 7.4 0 11.2 2.6-3.8 2.4-8.2 0-11.2z'/><path d='M11.2 13.2c-3 .6-6.6-1-6.8-4-.1-1.9 1.6-2.9 3-1.9-1.4.6-1.2 2.6.4 3.2'/><path d='M12.8 13.2c3 .6 6.6-1 6.8-4 .1-1.9-1.6-2.9-3-1.9 1.4.6 1.2 2.6-.4 3.2'/><path d='M7.2 14.4h9.6'/><path d='M12 14.4v3.2c-1.6 0-2.8 1.2-3 3.2M12 17.6c1.6 0 2.8 1.2 3 3.2'/></g>`,
  broadside: `<g ${S}><path d='M2.4 13.2l8-1.9.6 2.6-8 1.9z'/><circle cx='5.6' cy='17.6' r='1.9'/></g><path ${F} d='M11.6 12.4l3.1-2.4-.4 2.2 3.4-.6-2.6 2 2.8 2.2-3.6-1 .2 2.2z'/><g ${sw(1.2)}><circle cx='19.6' cy='7.6' r='2.1'/><circle cx='16.4' cy='5.2' r='1.5'/><circle cx='21' cy='12.4' r='1.4'/></g>`,
  arrow: `<g ${S}><path d='M4.4 12h15.4M14.8 7l5 5-5 5'/><path d='M4.4 12L2.6 9.2M4.4 12l-1.8 2.8M7.2 12L5.4 9.2M7.2 12l-1.8 2.8' stroke-width='1.2'/></g>`,
  stop: `<g ${S}><rect x='5.4' y='5.4' width='13.2' height='13.2' rx='1.4'/></g><path ${H} d='M8.2 15.8l7.6-7.6M8.2 12l3.8-3.8M12 15.8l3.8-3.8'/>`,
  patrol: `<g ${S}><path d='M4.8 10.2C5.4 6.8 8.4 4.6 12 4.6c3.9 0 6.7 2.6 7.1 6'/><path d='M19.2 13.8c-.6 3.4-3.6 5.6-7.2 5.6-3.9 0-6.7-2.6-7.1-6'/><path d='M19.1 10.6l2.2-2.8M19.1 10.6l-3-1.4M4.9 13.4l-2.2 2.8M4.9 13.4l3 1.4'/></g>`,
  column: `<path ${fw(.8)} d='M12 1.8l1.9 2.6v2.6h-3.8V4.4zM12 8.8l1.9 2.6V14h-3.8v-2.6zM12 15.8l1.9 2.6V21h-3.8v-2.6z'/><path ${H} d='M12 7.4v1M12 14.4v1'/>`,
  line: `<path ${fw(.8)} d='M4.6 8.6l1.9 2.6v4.4H2.7v-4.4zM12 8.6l1.9 2.6v4.4h-3.8v-4.4zM19.4 8.6l1.9 2.6v4.4h-3.8v-4.4z'/><path ${H} d='M2.4 19h19.2'/>`,
  wedge: `<path ${fw(.8)} d='M12 3.4l1.9 2.6v3.4h-3.8V6zM5.4 11.8l1.9 2.6v3.4H3.5v-3.4zM18.6 11.8l1.9 2.6v3.4h-3.8v-3.4z'/><path ${H} d='M10.4 10.6l-3.4 2.8M13.6 10.6l3.4 2.8'/>`,
  tower: `<g ${S}><path d='M7.6 21l1.2-11.4h6.4L16.4 21z'/><path d='M7.4 9.6V6h2.2v1.6h1.4V6h2v1.6h1.4V6h2.2v3.6'/><path d='M10.4 21v-3.2a1.6 1.6 0 0 1 3.2 0V21'/></g><path ${F} d='M11.4 11.6h1.2v3h-1.2z'/><path ${H} d='M9 13.4h1.4M13.6 16.4H15M9.4 17.2h1'/>`,
  fort: `<g ${S}><path d='M3 21V9.4h3.6V21M17.4 21V9.4H21V21M6.6 21v-7.6h10.8V21'/><path d='M3 9.4V7h1.2v1.2h1.2V7h1.2v2.4M17.4 9.4V7h1.2v1.2h1.2V7H21v2.4M6.6 13.4v-1.8h1.6v1M11.2 13.4v-1.8h1.6v1M15.8 13.4v-1.8h1.6'/><path d='M10.2 21v-3a1.8 1.8 0 0 1 3.6 0v3'/></g><path ${H} d='M4.2 12.4h1.2M18.6 12.4h1.2M8.4 16.2h1.4M14.4 16.2h1.4'/>`,
  lighthouse: `<g ${S}><path d='M9.4 21l1.2-11.8h2.8L14.6 21z'/><path d='M10 9.2V6.6h4v2.6M9.6 6.6L12 4l2.4 2.6M8 21h8'/><path d='M7.4 6.2L3.6 5.2M7.4 8.4l-3.8 1M16.6 6.2l3.8-1M16.6 8.4l3.8 1' stroke-width='1.2'/></g><path ${F} d='M10.4 12.6h3.2l.2 2h-3.6zM10.1 16.6h3.8l.2 2.2H9.9z'/>`,
  warehouse: `<g ${S}><path d='M3.6 10.6L12 4.4l8.4 6.2V20H3.6z'/><path d='M8.6 20v-6h6.8v6M8.6 14l6.8 6M15.4 14l-6.8 6'/></g><path ${H} d='M5 12.4h2M17 12.4h2M10.6 9.4h2.8'/>`,
  house: `<g ${S}><path d='M3.6 11.6L12 4.6l8.4 7'/><path d='M5.8 9.8V20h12.4V9.8'/><path d='M10.2 20v-5h3.6v5'/></g>`,
  pickaxe: `<g ${S}><path d='M5.2 20.6l10.6-10.6' stroke-width='2'/><path d='M8.4 4.2c4.4-.6 8.8 1 11.6 4.4l.6 1.4-1.6-.4c-3-2.6-6.8-3.8-10.6-3.6z'/></g><path ${H} d='M12.2 7.4l2.8 2.8'/>`,
  axe: `<g ${S}><path d='M4.4 20.4l10.4-10.4' stroke-width='2'/><path d='M12.4 4.6c2.6-1.2 5.6-.4 7.4 1.6 1.8 2 2.4 4.8 1.2 7.2l-3.6-2.2-3-3z'/></g><path ${H} d='M15.4 6.6l2.6 2.6M17.6 5.4l2 2'/>`,
  tree: `<g ${S}><path d='M12 2.8l3.8 5.4h-2l3.8 5.4h-2.4l3.4 5H5.4l3.4-5H6.4l3.8-5.4h-2z'/><path d='M12 18.6v3'/></g><path ${H} d='M10.6 10.4l1.4 1M13.4 10.4l-1.4 1M9.8 15.4l2.2 1.2M14.2 15.4L12 16.6'/>`,
  wall: `<g ${S}><path d='M3 6.4h18v13.2H3z'/><path d='M3 10.8h18M3 15.2h18M8.4 6.4v4.4M15.6 6.4v4.4M12 10.8v4.4M6 15.2v4.4M18 15.2v4.4'/></g>`,
  bomb: `<g ${S}><circle cx='10.6' cy='14.2' r='6.4'/><path d='M13.6 8.6l1.4-1.4 1.8 1.8-1.4 1.4'/><path d='M16 8.2c.8-1.6 2-2.4 3.4-2.2' stroke-width='1.2'/></g><path ${F} d='M20.6 2.6l.5 1.7 1.7.5-1.7.5-.5 1.7-.5-1.7-1.7-.5 1.7-.5z'/><path ${H} d='M7 12c.4-1.4 1.4-2.4 2.8-2.8M6.6 14.4c.2-.6.4-1 .8-1.4'/>`,
  target: `<g ${S}><circle cx='12' cy='12' r='8.6'/><circle cx='12' cy='12' r='5'/></g><circle ${F} cx='12' cy='12' r='1.7'/><path ${sw(1.2)} d='M12 1.6v3.2M12 19.2v3.2M1.6 12h3.2M19.2 12h3.2'/>`,
  flame: `<path ${S} d='M12 21.2c-4.4 0-6.6-3.2-6.1-6.4.4-2.6 2.3-3.8 2.7-6.2 1.6 1.2 2 2.8 1.8 4 1.4-1.8 2.2-5 1.4-9.2 3.8 2.2 6.8 6.2 6.4 11.2-.2 3.8-2.6 6.6-6.2 6.6z'/><path ${F} d='M12 21.2c-1.6 0-2.4-1.4-2-2.8.4-1.4 1.6-1.8 1.8-3.4 1.8 1.2 2.6 2.8 2.2 4.2-.3 1.2-1.1 2-2 2z'/>`,
  chain: `<g ${S}><rect x='3.2' y='11.4' width='10.4' height='5.6' rx='2.8' transform='rotate(-45 8.4 14.2)'/><rect x='10.4' y='7' width='10.4' height='5.6' rx='2.8' transform='rotate(-45 15.6 9.8)'/></g>`,
  burst: `<path ${S} d='M12 2.4l1.7 5.4 5-3.2-2.4 5.3 5.3 1.7-5.3 2 3.3 5-5.4-2.6L12 21.6l-1.8-5.6-5.4 2.6 3.3-5-5.3-2 5.3-1.7-2.4-5.3 5 3.2z'/><circle ${F} cx='12' cy='12' r='2.2'/>`,
  lock: `<g ${S}><rect x='5.4' y='10.8' width='13.2' height='9.8' rx='1.6'/><path d='M8.4 10.8V8a3.6 3.6 0 0 1 7.2 0v2.8'/></g><circle ${F} cx='12' cy='14.6' r='1.4'/><path ${F} d='M11.4 15h1.2l.4 2.8h-2z'/>`,
  check: `<path ${sw(2)} d='M4.6 12.8l4.6 4.6L19.6 6.8'/>`,
  warn: `<g ${S}><path d='M12 3.4l9.6 16.8H2.4z'/><path d='M12 9.6v5'/></g><circle ${F} cx='12' cy='17.4' r='1.1'/>`,
  bell: `<g ${S}><path d='M5.8 17.2c1-1.6 1.4-4 1.4-6.6 0-3.4 2.2-5.8 4.8-5.8s4.8 2.4 4.8 5.8c0 2.6.4 5 1.4 6.6z'/><path d='M4.6 17.2h14.8M12 4.8V2.8M10.4 2.8h3.2'/></g><circle ${F} cx='12' cy='19.6' r='1.5'/><path ${H} d='M9 9.4c-.4 1.6-.4 3.6-.2 5.4'/>`,
  close: `<path ${sw(1.9)} d='M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8'/><path ${F} d='M5 5l2.4.4-2 2zM19 5l-.4 2.4-2-2zM5 19l.4-2.4 2 2zM19 19l-2.4-.4 2-2z'/>`,
  plus: `<path ${sw(1.9)} d='M12 4.6v14.8M4.6 12h14.8'/>`,
  prev: `<path ${sw(2)} d='M15 4.6L7.6 12l7.4 7.4'/>`,
  next: `<path ${sw(2)} d='M9 4.6l7.4 7.4L9 19.4'/>`,
  up: `<path ${sw(1.8)} d='M12 20V4.8M6 10.4l6-6 6 6'/>`,
  star: `<path ${F} d='M12 2.4l2.2 7.4 7.4 2.2-7.4 2.2L12 21.6l-2.2-7.4L2.4 12l7.4-2.2z'/>`,
  grapnel: `<g ${S}><path d='M12 6.2v14'/><circle cx='12' cy='4.2' r='1.9'/><path d='M12 20.2c-3.6 0-6.4-2.4-6.8-5.8M12 20.2c3.6 0 6.4-2.4 6.8-5.8M12 20.2v-3'/><path d='M8.4 10.6h7.2'/></g><path ${F} d='M3.6 13l3 .1-1.4 2.6zM20.4 13l-3 .1 1.4 2.6z'/>`,
  scroll: `<g ${S}><path d='M6.6 4.4h11a2.2 2.2 0 0 1 0 4.4h-1.2v10.4a2.2 2.2 0 0 1-2.2 2.2H5.4a2.2 2.2 0 0 1 0-4.4h1.2z'/><path d='M6.6 17h8.2'/></g><path ${H} d='M9.2 9.2h4.8M9.2 11.6h4.8M9.2 14h3.4'/>`,
  laurel: `<g ${sw(1.3)}><path d='M12 21c-4.6-1.2-7.6-5.2-7.4-10.4M12 21c4.6-1.2 7.6-5.2 7.4-10.4'/></g><path ${F} d='M4.4 9.4c-.8-1.4-.4-3 .8-3.8.6 1.4.2 3-.8 3.8zM4.6 13.6c-1.6-.4-2.4-1.8-2.2-3.2 1.4.2 2.4 1.6 2.2 3.2zM6.8 17c-1.6.2-2.8-.8-3.2-2.2 1.4-.2 2.8.8 3.2 2.2zM9.6 19.6c-1.4.6-3 0-3.6-1.2 1.4-.6 3 0 3.6 1.2zM19.6 9.4c.8-1.4.4-3-.8-3.8-.6 1.4-.2 3 .8 3.8zM19.4 13.6c1.6-.4 2.4-1.8 2.2-3.2-1.4.2-2.4 1.6-2.2 3.2zM17.2 17c1.6.2 2.8-.8 3.2-2.2-1.4-.2-2.8.8-3.2 2.2zM14.4 19.6c1.4.6 3 0 3.6-1.2-1.4-.6-3 0-3.6 1.2z'/>`,
  dividers: `<g ${S}><circle cx='12' cy='3.8' r='1.6'/><path d='M11.2 5.2L5.6 21M12.8 5.2L18.4 21M8 13.4c2.6 1 5.4 1 8 0'/></g>`,
  quill: `<path ${S} d='M4 20.4c3.4-6.4 8.4-12.4 16.2-16.8-1.6 6-5 10.6-10.4 13.4'/><path ${H} d='M9.6 15.2l3.6.8M11.8 12.4l3.6.6M14 9.6l3.4.6'/><path ${sw(1.2)} d='M3.4 21.2l1.6-2'/>`,
  eye: `<g ${S}><path d='M2.2 12c2.4-4 5.8-6 9.8-6s7.4 2 9.8 6c-2.4 4-5.8 6-9.8 6s-7.4-2-9.8-6z'/><circle cx='12' cy='12' r='3.2'/></g><circle ${F} cx='12' cy='12' r='1.3'/>`,
  question: `<g ${S}><path d='M8.6 8.4c.4-2 1.8-3.4 3.6-3.4 2.2 0 3.8 1.4 3.8 3.4 0 2.8-3.8 3-3.8 6.2'/></g><circle ${F} cx='12.2' cy='18.6' r='1.3'/>`,
  pause: `<path ${fw(.8)} d='M7.4 5.2h3v13.6h-3zM13.6 5.2h3v13.6h-3z'/>`,
  rotate: `<g ${S}><path d='M18.8 12.4a6.8 6.8 0 1 1-2-5.4'/><path d='M17.6 3.2v4.4h-4.4'/></g>`,
  trash: `<g ${S}><path d='M4.6 6.6h14.8M9.4 6.6V4.2h5.2v2.4M6.4 6.6l1 13.6h9.2l1-13.6'/><path d='M10 9.6v7.6M14 9.6v7.6'/></g>`,
};

/** Hull class → glyph */
export const HULL_GLYPH = { light: 'sloop', standard: 'brig', heavy: 'galleon' };

/** Emoji / symbol used by data tables and older strings → glyph name. */
export const EMOJI_GLYPH = {
  '🪵': 'timber', '🪙': 'coin', '💰': 'chest', '📦': 'crate', '⚐': 'flag', '⚑': 'flag', '🏴': 'flag', '🚩': 'pennant',
  '⚓': 'anchor', '⛵': 'sloop', '🚢': 'galleon', '🛥': 'sloop',
  '⚔': 'sabres', '⚔️': 'sabres', '🗡': 'cutlass', '🛡': 'buckler', '🛡️': 'buckler', '✋': 'hand',
  '🏛': 'warehouse', '🔬': 'astrolabe', '💡': 'lighthouse', '🏰': 'fort', '🗼': 'tower', '🧱': 'wall',
  '💣': 'bomb', '🎯': 'target', '💀': 'skull', '☠': 'skull', '☠️': 'skull', '💥': 'burst', '🔥': 'flame', '⛓': 'chain',
  '🌲': 'tree', '⛏': 'pickaxe', '🔧': 'hammer', '🛠': 'tools', '⚒': 'tools', '🔨': 'hammer', '🏗': 'tools',
  '🌬': 'wind', '🌫': 'cloud', '🔭': 'spyglass', '⚖': 'scales', '🗺': 'compass', '🏝': 'island', '⚜': 'fleur',
  '⚙': 'cannon', '⚱': 'grapnel', '🏠': 'house', '⚠': 'warn', '⚠️': 'warn', '🔒': 'lock', '✓': 'check', '✔': 'check', '✅': 'check',
  '✦': 'star', '★': 'star', '🎉': 'laurel', '🏆': 'laurel', '⏸': 'hourglass', '⏱': 'hourglass', '⛈': 'cloud', '🗑': 'trash', '↻': 'rotate', '⬆': 'up',
};

const enc = (inner) => `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E${inner.replace(/</g, '%3C').replace(/>/g, '%3E').replace(/"/g, "'")}%3C/svg%3E")`;

/** CSS text for the glyph sheet (exported for tests / other pages). */
export function glyphCss() {
  const vars = Object.entries(GLYPHS).map(([k, v]) => `--g-${k}:${enc(v)};`).join('');
  const cls = Object.keys(GLYPHS).map(k => `.gi-${k}{--gi:var(--g-${k})}`).join('');
  return `:root{${vars}}
.gi{display:inline-block;width:1em;height:1em;flex:0 0 auto;vertical-align:-.15em;background-color:currentColor;
-webkit-mask:var(--gi) center/contain no-repeat;mask:var(--gi) center/contain no-repeat}
${cls}`;
}

/** Inject the glyph sheet once (no-op outside a browser). */
export function mountGlyphs() {
  if (typeof document === 'undefined' || document.getElementById('iow-glyphs')) return;
  const st = document.createElement('style');
  st.id = 'iow-glyphs';
  st.textContent = glyphCss();
  (document.head || document.documentElement).appendChild(st);
}
mountGlyphs();

/**
 * Inline glyph element.
 * @param {string} name  key of GLYPHS
 * @param {string} [cls] extra classes
 * @returns {string} `<i class="gi gi-name">` markup (constant-built, innerHTML-safe)
 */
export function gi(name, cls = '') {
  const n = GLYPHS[name] ? name : 'anchor';
  return `<i class="gi gi-${n}${cls ? ' ' + cls : ''}" aria-hidden="true"></i>`;
}

const _escTxt = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Data-table icon (usually an emoji) → glyph markup; unknown icons fall
 * back to the escaped original so nothing ever disappears.
 */
export function iconOf(emoji, cls = '') {
  const k = EMOJI_GLYPH[String(emoji || '').trim()];
  return k ? gi(k, cls) : `<span class="gi-txt${cls ? ' ' + cls : ''}">${_escTxt(emoji || '')}</span>`;
}

/** Cost/amount chips: 🪵 / 🪙 amounts as glyph + old-style figure. */
export function costHtml(wood = 0, gold = 0) {
  const out = [];
  if (wood) out.push(`<span class="pd-cost pd-cost-w">${gi('timber')}${wood}</span>`);
  if (gold) out.push(`<span class="pd-cost pd-cost-g">${gi('coin')}${gold}</span>`);
  return out.join(' ');
}

const EMOJI_RE = new RegExp(`(${Object.keys(EMOJI_GLYPH).sort((a, b) => b.length - a.length).map(e => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\uFE0F?`, 'g');

/**
 * Plain text with known emoji swapped for glyphs, as innerHTML-safe markup
 * (text is escaped). For strings coming from game code we do not own.
 */
export function glyphText(txt) {
  return _escTxt(txt).replace(EMOJI_RE, (m, e) => gi(EMOJI_GLYPH[e]));
}

/** Same as glyphText but builds DOM nodes (no innerHTML) into `el`. */
export function fillGlyphText(el, txt) {
  el.textContent = '';
  const s = String(txt);
  let last = 0;
  s.replace(EMOJI_RE, (m, e, off) => {
    if (off > last) el.appendChild(document.createTextNode(s.slice(last, off)));
    const i = document.createElement('i');
    i.className = `gi gi-${EMOJI_GLYPH[e]}`;
    i.setAttribute('aria-hidden', 'true');
    el.appendChild(i);
    last = off + m.length;
    return m;
  });
  if (last < s.length) el.appendChild(document.createTextNode(s.slice(last)));
}
