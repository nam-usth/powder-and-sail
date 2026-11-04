#!/usr/bin/env node
// ── tools/spec_tables.mjs — number tables for docs/SPECIFICATION.md ──
// Every balance number in the spec is GENERATED from frontend/src/data/*.js
// (and the pure Meta/ formulas), never typed by hand, so the spec follows the
// data while it is being tuned.
//
//   node tools/spec_tables.mjs            # print every table (Markdown) to stdout
//   node tools/spec_tables.mjs hulls      # print one table (names: see TABLES below)
//   node tools/spec_tables.mjs --write    # refresh the tables inside docs/SPECIFICATION.md
//
// --write replaces the text between the marker pairs
//   <!-- SPEC:<name> -->  …  <!-- /SPEC:<name> -->
// in docs/SPECIFICATION.md. Prose outside the markers is never touched.
// Read-only on game code: it only imports the data / pure Meta modules.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'frontend', 'src');
const imp = (p) => import(pathToFileURL(join(SRC, p)).href);

const H = await imp('data/harbor.js');
const C = await imp('data/campaign.js');
const F = await imp('data/factions.js');
const CN = await imp('data/cannons.js');
const SH = await imp('data/ships.js');
const B = await imp('data/buildings.js');
const D = await imp('data/defenses.js');
const U = await imp('data/upgrades.js');
const K = await imp('data/constants.js');
const M = await imp('data/modes.js');
const CAP = await imp('Experience/Utils/ShipCapacity.js');

// ── helpers ──────────────────────────────────────────────────────
const md = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `|${head.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.map((c) => String(c ?? '').replace(/\|/g, '\\|')).join(' | ')} |`),
].join('\n');
const clock = (s) => { s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const cost = (c = {}) => [c.wood ? `${c.wood}🪵` : '', c.gold ? `${c.gold}🪙` : ''].filter(Boolean).join(' ') || '0';
const R = CN.ROMAN_TIER;
const knots = (spd) => (spd * 60).toFixed(1);
const hullOf = (h) => H.HULLS[h] || H.HULLS[H.HULL_BY_CLASS[h]] || H.HULLS.brigantine;
const group = (list) => {
  const m = new Map();
  for (const e of list || []) {
    const h = hullOf(e.hull);
    const k = h.id + (e.faction ? `(${e.faction})` : '');
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m].map(([k, n]) => `${n}× ${k}`).join(', ');
};
const lo = (l = {}) => Object.entries(l).map(([s, c]) => `${s}:${c}`).join(' ');
const range = (rt) => `${rt} (${K.RANGE_U[rt]}u)`;

// ── tables ───────────────────────────────────────────────────────
const TABLES = {
  economy() {
    const rows = [
      ['Khoá lưu profile (localStorage)', `\`${H.PROFILE_KEY}\` (v${H.PROFILE_VERSION}); save hỏng → \`${H.PROFILE_KEY}_bad\``],
      ['Tài nguyên khởi đầu (profile mới)', cost(H.START_RES)],
      ['Thu nhập nền (không cần công trình)', `${K.WOOD_RATE} 🪵/s · ${K.GOLD_RATE} 🪙/s`],
      ['Hệ số đồng hồ Harbor `HARBOR_ECONOMY.rateMult`', H.HARBOR_ECONOMY.rateMult],
      ['Trần kho cơ bản', `${K.WOOD_CAP} 🪵 · ${K.GOLD_CAP} 🪙 (+ Warehouse)`],
      ['Offline tối đa `OFFLINE_MAX_SEC`', `${H.OFFLINE_MAX_SEC} s (${H.OFFLINE_MAX_SEC / 3600} h)`],
      ['Thư "Trong lúc bạn vắng mặt" khi offline ≥', `${H.OFFLINE_REPORT_MIN_SEC} s`],
      ['Tự lưu Harbor mỗi', `${H.SAVE_INTERVAL_SEC} s (+ khi pagehide / tab ẩn)`],
      ['Cảng vẫn sản xuất khi hạm đội ra khơi `PRODUCE_AT_SEA`', H.PRODUCE_AT_SEA],
      ['Hệ số thời gian xây/nâng cấp công trình `BUILD_TIME_MULT`', `${K.BUILD_TIME_MULT} (thời gian thật = buildTime × hệ số)`],
      ['Hạm đội khởi đầu', H.STARTER_FLEET.join(', ')],
      ['Công trình khởi đầu', H.STARTER_BUILDINGS.map((b) => `${b.buildingId}@${b.gridKey}`).join(', ')],
      ['Lưới xây dựng', `${K.BUILD_GRID_SIZE}×${K.BUILD_GRID_SIZE} ô, mask theo hình đảo (Home Port = HARBOR)`],
    ];
    return md(['Tham số', 'Giá trị'], rows);
  },

  buildings() {
    const rows = B.BUILDINGS.map((b) => {
      const extra = b.productionByLevel?.some((x) => x) ? `SX/s Lv1/5/10: ${b.productionByLevel[0]}/${b.productionByLevel[4]}/${b.productionByLevel[9]}`
        : b.capacityByLevel ? `+trần Lv1/5/10: ${b.capacityByLevel[0]}/${b.capacityByLevel[4]}/${b.capacityByLevel[9]}`
        : b.repairRateByLevel ? `sửa HP/s Lv1/10: ${b.repairRateByLevel[0]}/${b.repairRateByLevel[9]}`
        : b.fleetHpBonusByLevel ? `+HP hạm đội % Lv1/10: ${b.fleetHpBonusByLevel[0]}/${b.fleetHpBonusByLevel[9]}; +fleet cap ${[1, 3, 5, 7].map((l) => `Lv${l}:${CAP.getBarracksShipCapBonus(l)}`).join(' ')}`
        : b.visionMultByLevel ? `tầm nhìn × Lv1/10: ${b.visionMultByLevel[0]}/${b.visionMultByLevel[9]}`
        : b.fortHpBonusByLevel ? `+HP pháo đài Lv1/10: ${b.fortHpBonusByLevel[0]}/${b.fortHpBonusByLevel[9]}`
        : b.labLevelByLevel ? 'Lab level = level' : '';
      return [b.id, b.name, b.category, `${b.footprint.w}×${b.footprint.h}`, cost(b.cost),
        `${b.buildTime}s → ${(b.buildTime * K.BUILD_TIME_MULT).toFixed(1)}s`,
        b.unlock?.requiredLabLevel ? `Lab ${b.unlock.requiredLabLevel}` : '—', extra];
    });
    return md(['id', 'Tên', 'Nhóm', 'Ô', 'Giá xây', 'Thời gian (data → thật)', 'Mở khoá', 'Hiệu ứng'], rows)
      + `\n\nNâng cấp: Lv N → N+1 tốn \`cost × N\`, mất \`upgradeTime × ${K.BUILD_TIME_MULT}\` s, tối đa Lv10. Phá dỡ hoàn \`cost × level × 50%\`.`;
  },

  defenses() {
    const rows = D.DEFENSES.map((d) => [d.id, d.name, `${d.footprint.w}×${d.footprint.h}`, cost(d.cost),
      `${d.damageByLevel[0]}→${d.damageByLevel[9]}`, `${d.rangeByLevel[0]}→${d.rangeByLevel[9]}`, `${d.reloadSecByLevel[0]}→${d.reloadSecByLevel[9]}s`,
      [d.unlock?.requiredLabLevel ? `Lab ${d.unlock.requiredLabLevel}` : '', d.unlock?.requiredResearch || ''].filter(Boolean).join(' + ') || '—']);
    return md(['id', 'Tên', 'Ô', 'Giá', 'Sát thương Lv1→10', 'Tầm', 'Nạp đạn', 'Mở khoá'], rows);
  },

  research() {
    const rows = U.TECH_TREE.map((t) => [t.id, t.nm, t.br, t.desc, cost(t.cost), t.req.join(', ') || '—', t.requiredLabLevel ? `Lab ${t.requiredLabLevel}` : '—']);
    return md(['id', 'Tên', 'Nhánh', 'Hiệu ứng', 'Giá', 'Cần', 'Lab'], rows)
      + '\n\nNâng cấp tàu (tab Upgrades của Loadout): ' + U.UPGRADE_DEFS.map((u) => `${u.nm} (+${Math.round(u.perLv * 100)}%/cấp, tối đa ${u.max}, giá base × (cấp+1): ${cost(u.base)})`).join(' · ');
  },

  hulls() {
    const rows = Object.values(H.HULLS).filter((h) => !h.enemyOnly).map((h) => [
      h.id, h.nm, h.hull, R[h.tier], h.hp, `${h.spd} (${knots(h.spd)} kn)`, (SH.HULL_SLOTS[h.hull] || []).join(''),
      cost(h.cost), clock(h.buildSec), h.shipyardLevel, lo(defaultLoadout(h.hull, h.tier))]);
    return md(['hull id', 'Tên', 'Class', 'Tier', 'HP', 'Tốc độ', 'Slot', 'Giá', 'Thời gian đóng', 'Shipyard Lv', 'Pháo mặc định'], rows);
  },

  enemyHulls() {
    const rows = Object.values(H.HULLS).filter((h) => h.enemyOnly).map((h) => [h.id, h.nm, h.style, h.hull, R[h.tier], h.hp, knots(h.spd) + ' kn']);
    return md(['hull id (chỉ địch)', 'Tên', 'Kiểu mesh', 'Class', 'Tier', 'HP', 'Tốc độ'], rows);
  },

  shipyard() {
    const rows = ['light', 'standard', 'heavy'].map((c) => [c, (SH.HULL_SLOTS[c] || []).join(''),
      `${H.REPAIR_GOLD_FULL[c]}🪙 / ${H.REPAIR_SEC_FULL[c]}s`, `${H.SALVAGE_SEC[c]}s`,
      `${SH.HULL_HANDLING[c].turnRate} rad/s · accel ${SH.HULL_HANDLING[c].accel}`,
      `${H.PLUNDER_BY_HULL[c].wood}🪵 ${H.PLUNDER_BY_HULL[c].gold}🪙`]);
    return md(['Class', 'Slot', 'Sửa 0→100% (vàng / giây)', 'Trục vớt (thời gian)', 'Điều khiển', 'Chiến lợi phẩm khi bị chìm'], rows)
      + `\n\nTrục vớt tốn \`${H.SALVAGE_COST_FRAC * 100}%\` giá đóng tàu. Hạm đội tối đa: base ${H.FLEET_CAP_BASE}, trần ${H.FLEET_CAP_MAX}. `
      + `Neo ở cảng hồi ${H.MOORING_REGEN_FRAC * 100}% HP/s. Tàu về cảng không dưới ${H.MIN_AFLOAT_FRAC * 100}% HP.`;
  },

  fleetCap() {
    const fc = (yard, bar) => Math.min(H.FLEET_CAP_MAX, H.FLEET_CAP_BASE + Math.max(0, yard - 1) + bar);
    const bars = [0, 1, 2, 3, 4, 5];
    const rows = [1, 2, 3, 4, 5, 6].map((y) => [`Shipyard Lv${y}`, ...bars.map((b) => `${fc(y, b)} / ${fc(y, b) + 3}`)]);
    return md(['', ...bars.map((b) => `Barracks bonus ${b}`)], rows)
      + '\n\nÔ = fleet cap (số tàu tối đa ra trận) / roster cap (số bến = fleet cap + 3). Barracks bonus mỗi toà: '
      + [1, 3, 5, 7].map((l) => `Lv${l}→${CAP.getBarracksShipCapBonus(l)}`).join(', ') + ' (cộng dồn nhiều toà).';
  },

  cannons() {
    const rows = [...CN.CANNONS].sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id)).map((c) => [
      c.id, c.nm, R[c.tier], c.cls, range(c.rt), c.dmg, c.rof, c.wt, `${c.arc.m} ${c.arc.d}°`,
      c.ctr ? `+${Math.round(c.ctr.b * 100)}% vs ${c.ctr.t}` : '—', c.sp || '—']);
    return md(['cannon id', 'Tên', 'Tier', 'Loại', 'Tầm (rt)', 'Dmg', 'ROF', 'Nặng', 'Cung bắn', 'Khắc chế', 'Đặc biệt'], rows);
  },

  mountMatrix() {
    const tiers = [1, 2, 3, 4, 5];
    const rows = tiers.map((t) => [`Hull tier ${R[t]}`, CN.CANNONS.filter((c) => c.tier <= t).length + '/' + CN.CANNONS.length,
      CN.CANNONS.filter((c) => c.tier === t).map((c) => c.id).join(', ')]);
    return md(['Thân tàu', 'Số pháo lắp được', 'Pháo mới mở ở tier này'], rows);
  },

  factions() {
    const rows = Object.values(F.FACTIONS).map((f) => [f.id, f.nm, f.vi, f.kind, f.style, f.home || '—']);
    return md(['faction id', 'Tên', 'Tiếng Việt', 'Loại', 'Kiểu tàu', 'Vùng nhà'], rows);
  },

  regions() {
    const rows = C.REGIONS.map((r) => [r.id, r.nm, r.vi, r.minRenown, r.factions.join(', ')]);
    return md(['region id', 'Tên', 'Tiếng Việt', 'Danh vọng tối thiểu', 'Phe'], rows);
  },

  ranks() {
    return md(['rank id', 'Tên', 'Danh vọng'], H.RANKS.map((r) => [r.id, r.nm, r.renown]));
  },

  missions() {
    const rows = C.MISSIONS.map((m) => {
      const o = m.objective;
      const obj = o.type === 'survive' ? `survive ${clock(o.seconds)}` : o.type === 'capture' ? `capture ${o.islands.join(',')}` : o.type;
      let foes = group(m.enemies);
      if (o.waves) foes = [foes, ...o.waves.map((w, i) => `W${i + 1}@${clock(w.at)}: ${group(w.ships)}`)].filter(Boolean).join('; ');
      const forts = (m.islands || []).filter((i) => i.own === 'enemy').map((i) => `${i.nm} (${i.hp}HP, ${i.tdmg}dmg/${i.trof}s${i.trait ? ', ' + i.trait : ''})`).join('; ');
      return [m.id, m.nm, m.region, m.faction, obj, foes || '—', forts || '—', clock(m.parTime), m.timeLimit ? clock(m.timeLimit) : '—',
        cost(m.reward), cost(m.firstClear), m.renown, (m.requires || []).join(', ') || '—'];
    });
    return md(['mission id', 'Tên', 'Biển', 'Phe', 'Mục tiêu', 'Địch', 'Pháo đài', 'Par ★★★', 'Giới hạn', 'Thưởng', 'Lần đầu', 'Danh vọng', 'Cần thắng trước'], rows)
      + `\n\nNhiệm vụ cuối (thắng = hoàn thành chiến dịch): \`${C.FINAL_MISSION}\`.`;
  },

  renownPath() {
    // Guaranteed renown along the campaign = mission renown + RENOWN_PER_SINK × enemies a sink_all
    // mission forces you to sink. Other objectives can be won without sinking anything.
    let acc = 0;
    const rows = [];
    for (const r of C.REGIONS) {
      const ms = C.MISSIONS.filter((m) => m.region === r.id);
      const before = acc;
      for (const m of ms) acc += m.renown + (m.objective.type === 'sink_all' ? H.RENOWN_PER_SINK * (m.enemies || []).length : 0);
      const next = C.REGIONS[C.REGIONS.indexOf(r) + 1];
      rows.push([r.id, r.minRenown, before, acc, next ? `${next.id} cần ${next.minRenown} → ${acc >= next.minRenown ? 'đủ' : `THIẾU ${next.minRenown - acc} (cần patrol/sink thêm)`}` : '—']);
    }
    return md(['Biển', 'Cần', 'Danh vọng bảo đảm khi vào', 'Sau khi thắng hết biển', 'Biển kế tiếp'], rows)
      + `\n\nDanh vọng bảo đảm = renown nhiệm vụ + ${H.RENOWN_PER_SINK} × số tàu phải đánh chìm trong \`sink_all\`. Mọi tàu địch bị chìm (kể cả khi thua) đều +${H.RENOWN_PER_SINK}; patrol thắng +${C.PATROL.renown}. Hạng cao nhất: ${H.RANKS.at(-1).nm} (${H.RANKS.at(-1).renown}).`;
  },

  patrol() {
    const P = C.PATROL;
    const rows = [
      ['Vị trí trên hải đồ', `x=${P.chart.x}, y=${P.chart.y}`],
      ['Nguồn địch', 'biển xa nhất đã mở (renown) — pool: ' + Object.entries(P.pools).map(([k, v]) => `${k}: ${v.join('/')}`).join(' · ')],
      ['Ngân sách sức mạnh địch', `≤ ${P.strengthRatio} × Σ(HP × số slot) của tàu ra khơi; tối đa ${P.maxShips} tàu`],
      ['Không đủ ngân sách', '1 cutter với HP cắt cho vừa ngân sách (tối thiểu 25 HP)'],
      ['Thưởng', `${cost(P.reward.base)} + (${P.reward.perStrength.wood}🪵, ${P.reward.perStrength.gold}🪙) × sức mạnh địch`],
      ['Danh vọng', `${P.renown} khi thắng (+${H.RENOWN_PER_SINK}/tàu chìm)`],
      ['Par time', '120 s + 40 s × số tàu địch'],
      ['Không có thưởng lần đầu; không ghi sao', '`campaign.patrolsWon++`'],
    ];
    return md(['Quy tắc', 'Giá trị'], rows);
  },

  battleEcon() {
    const rows = [
      ['Tàu địch chìm', Object.entries(H.PLUNDER_BY_HULL).map(([k, v]) => `${k}: ${cost(v)}`).join(' · ')],
      ['Pháo đài địch bị phá / chiếm', cost(H.PLUNDER_FORT)],
      ['Thua / rút lui giữ lại', `${H.DEFEAT_PLUNDER_KEEP * 100}% chiến lợi phẩm (làm tròn xuống), không có thưởng nhiệm vụ`],
      ['Danh vọng mỗi tàu địch chìm', H.RENOWN_PER_SINK],
      ['Bán kính địch giao chiến `BATTLE.aggro`', `${H.BATTLE.aggro}u (pháo đài: r + ${H.BATTLE.aggro}×0.6)`],
      ['Pháo đài hồi máu / tick (~5.5s)', `${H.BATTLE.fortRegen * 100}% max`],
      ['Pháo đài bị phá có được xây lại', H.BATTLE.fortRebuild],
      ['Tàu địch hồi trong aura pháo đài', `${H.BATTLE.fortShipRegen} HP/s`],
    ];
    return md(['Quy tắc', 'Giá trị'], rows);
  },

  modes() {
    const keys = Object.keys(M.MODES.skirmish.features);
    return md(['feature', ...Object.keys(M.MODES)], keys.map((k) => [k, ...Object.values(M.MODES).map((m) => (m.features[k] ? '✔' : '—'))]))
      + `\n\nMode mặc định khi URL không có \`?mode=\`: \`${M.DEFAULT_MODE}\`.`;
  },

  openWar() {
    const rows = [
      ['Tài nguyên đầu trận', `${K.WOOD_START}🪵 ${K.GOLD_START}🪙`],
      ['Sóng địch', `mỗi ${K.WAVE_INT}s; số tàu = min(floor((wave+2)/3), 3)`],
      ['Hồi sinh tàu (revive)', `${K.REVIVE_TIME}s cơ bản`],
      ['Raid', `${K.RAID_DUR}s, cướp ${K.LOOT_W_RATE}🪵/${K.LOOT_G_RATE}🪙 mỗi s, cargo ≤ ${K.CARGO_MAX}`],
      ['Thắng bằng loot', `${K.LOOT_WIN} điểm loot (kiểm tra trong lúc raid)`],
    ];
    return md(['Tham số Open War', 'Giá trị'], rows);
  },
};

function defaultLoadout(cls, tier) {
  const byTier = H.DEFAULT_LOADOUT[cls] || H.DEFAULT_LOADOUT.light;
  for (let t = tier; t >= 1; t--) if (byTier[t]) return byTier[t];
  return byTier[Math.min(...Object.keys(byTier).map(Number))];
}

// ── CLI ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
if (args.includes('--write')) {
  const file = join(ROOT, 'docs', 'SPECIFICATION.md');
  let txt = readFileSync(file, 'utf8');
  let n = 0;
  txt = txt.replace(/<!-- SPEC:(\w+) -->[\s\S]*?<!-- \/SPEC:\1 -->/g, (all, name) => {
    if (!TABLES[name]) { console.warn(`unknown table marker: ${name}`); return all; }
    n++;
    return `<!-- SPEC:${name} -->\n${TABLES[name]()}\n<!-- /SPEC:${name} -->`;
  });
  writeFileSync(file, txt);
  console.log(`docs/SPECIFICATION.md: ${n} tables refreshed`);
} else {
  const names = args.length ? args : Object.keys(TABLES);
  for (const n of names) {
    if (!TABLES[n]) { console.error(`unknown table: ${n} (have: ${Object.keys(TABLES).join(', ')})`); process.exit(1); }
    console.log(`\n### ${n}\n\n${TABLES[n]()}`);
  }
}
