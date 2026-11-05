// ── META UI STRINGS — EN (source of truth) + VI ─────────────────────
// Strings for the Harbor meta UI (Shipyard, World Chart, Battle Result,
// Harbor bar). Kept out of i18n.js so the meta UI ships as one unit; the
// active language still comes from i18n.getLang().
//
// Values are strings or functions (like i18n.T). Lookup order:
//   MS[lang][key] → MS.en[key] → key itself.
// Data names (hulls, ranks, regions, missions, islands) fall back to the
// English `nm` / `desc` in data/ when a translation is missing.

import { getLang } from '../../i18n.js';
import { UI2 } from './strings.ui2.js';
import { FR } from './strings.fr.js';
import { JA } from './strings.ja.js';

const plural = (n, one, many) => (n === 1 ? one : many);

export const MS = {
  en: {
    // ── common ──────────────────────────────────────────────
    close: 'Close', cancel: 'Cancel', confirm: 'Confirm', back: 'Back',
    wood: 'Wood', gold: 'Gold', renown: 'Renown',
    hp: 'Hull', tier: 'Tier', tierN: (r) => `Tier ${r}`,
    cls_light: 'Light', cls_standard: 'Standard', cls_heavy: 'Heavy',
    slot_L: 'Port', slot_R: 'Starboard', slot_B: 'Bow', slot_S: 'Stern',
    slotEmpty: 'empty',
    st_ready: 'Ready', st_building: 'Building', st_repairing: 'Repairing',
    st_salvaging: 'Salvaging', st_wreck: 'Wreck',
    need: (parts) => `Need ${parts} more`,
    dur_h: (h, m) => `${h} h ${m} min`, dur_m: (m) => `${m} min`, dur_s: (s) => `${s} s`,

    // ── Shipyard ────────────────────────────────────────────
    sy_title: 'Shipyard',
    sy_lv: (n) => `Level ${n}`,
    sy_none: 'Not built',
    sy_unlocks: (r) => `Builds up to Tier ${r}`,
    sy_slipways: 'Slipways', sy_slipwaysTip: 'Ships that can be built at the same time (one per shipyard)',
    sy_berths: 'Berths', sy_berthsTip: 'Ships your harbor can keep in its roster',
    sy_fleetcap: 'Fleet cap', sy_fleetcapTip: 'Most ships that can sail into one battle',
    sy_roster: 'Your Fleet', sy_catalogue: 'Shipwright’s Plans',
    sy_tab_roster: 'Fleet', sy_tab_build: 'Build',
    sy_battles: (n) => `${n} ${plural(n, 'battle', 'battles')}`,
    sy_sinks: (n) => `${n} ${plural(n, 'sink', 'sinks')}`,
    sy_seaworthy: 'Seaworthy',
    sy_sunkNote: 'Sunk in battle — raise her or scrap her',
    sy_inDock: 'In dry dock',
    sy_onSlip: 'On the slipway',
    sy_readyIn: (t) => `Ready in ${t}`,
    sy_repair: 'Repair', sy_salvage: 'Salvage', sy_rush: 'Rush', sy_scrap: 'Scrap', sy_build: 'Build',
    sy_rushTip: 'Finish now for gold',
    sy_scrapQ: (nm) => `Scrap ${nm}?`,
    sy_scrapRefund: (r) => `Refund ${r}. This cannot be undone.`,
    sy_lastShip: 'Your last ship cannot be scrapped',
    sy_noScrapBuilding: 'Ships on the slipway cannot be scrapped',
    sy_speed: 'Speed', sy_slots: 'Gun slots', sy_time: 'Build time', sy_cost: 'Cost',
    sy_tierLocked: (n) => `Shipyard Lv ${n} required`,
    sy_tierOpen: 'Available',
    sy_noYardTitle: 'No shipyard in your harbor',
    sy_noYardBody: 'Build a Shipyard from the Build menu to lay down new hulls.',
    reason_no_shipyard: 'Build a Shipyard in your harbor first',
    reason_shipyard_level: (n) => `Requires Shipyard Lv ${n}`,
    reason_slipway_busy: 'All slipways are busy',
    reason_roster_full: 'All berths are full — scrap a ship first',
    reason_unknown_hull: 'Unknown hull',
    t_buildStart: (nm, hull) => `⚒ Keel laid: ${nm} (${hull})`,
    t_ready: (nm) => `⚓ ${nm} is ready to sail!`,
    t_repair: (nm) => `🔧 ${nm} is in dry dock for repairs`,
    t_salvage: (nm) => `⚓ Salvage crews are raising ${nm}`,
    t_rush: (nm) => `⚡ ${nm} finished early`,
    t_scrap: (nm, r) => `🪓 ${nm} scrapped (+${r})`,
    t_fail: 'That is not possible right now',

    // ── World Chart ─────────────────────────────────────────
    wc_title: 'World Chart',
    wc_cartouche: 'The Isles',
    wc_cartoucheSub: 'An Admiralty chart of the western waters',
    wc_leagues: 'Leagues',
    wc_back: 'Harbor', wc_backTip: 'Return to your harbor',
    wc_next: (need, nm) => `${need} renown to ${nm}`,
    wc_max: 'Highest rank attained',
    wc_ready: (n) => `${n} ready`,
    wc_readyTip: 'Ships ready to sail',
    wc_home: 'Home Harbor',
    wc_locked: 'Locked', wc_open: 'Open', wc_won: 'Won',
    wc_regionLock: (n) => `Renown ${n}`,
    wc_regionLockLong: (n, region) => `Reach ${n} renown to sail into ${region}`,
    wc_requires: (names) => `Win first: ${names}`,
    wc_repeatable: 'Repeatable',
    wc_patrols: (n) => `${n} won`,
    wc_briefing: 'Orders',
    wc_closeBrief: 'Close orders',
    wc_objective: 'Objective',
    obj_sink_all: 'Sink every enemy ship',
    obj_destroy_forts: (n) => (n > 1 ? `Destroy all ${n} enemy forts` : 'Destroy the enemy fort'),
    obj_survive: (t, w) => `Keep a ship afloat for ${t} against ${w} ${plural(w, 'wave', 'waves')}`,
    obj_capture: (names) => `Capture ${names}`,
    obj_timeLimit: (t) => `Time limit ${t}`,
    wc_enemies: 'Enemy forces',
    wc_wave: (i, t) => `Wave ${i} · ${t}`,
    wc_fort: 'Fort',
    wc_reward: 'Reward', wc_firstClear: 'First victory bonus', wc_claimed: 'Claimed',
    wc_plunderNote: '+ plunder for every ship sunk',
    wc_renownGain: (n) => `+${n} renown`,
    wc_par: 'Par time', wc_best: 'Best',
    wc_star1: 'Victory', wc_star2: 'No ship lost', wc_star3: (t) => `Under ${t}`,
    wc_fleet: 'Sailing orders',
    wc_sel: (n, cap) => `${n} / ${cap} ships`,
    wc_capReached: 'Fleet cap reached',
    wc_lowHp: 'Low hull',
    wc_lowHpTip: 'Under 40% hull — consider repairing her first',
    wc_noShips: 'No ships are ready. Visit the Shipyard to build or repair.',
    wc_inYard: (n) => `${n} more in the shipyard`,
    wc_setSail: 'Set Sail ⛵',
    wc_sailing: 'Weighing anchor…',
    wc_pickShip: 'Select at least one ship',
    wc_patrolNote: 'Enemy strength grows with your rank.',
    wc_openWar: 'Open War',
    wc_openWarTag: 'Classic match',
    wc_openWarDesc: 'The classic full match: capture islands, build, research and push the war front against a rival admiral. Your harbor and fleet are not affected.',
    wc_declare: 'Declare War ⚔',

    // ── Battle result ───────────────────────────────────────
    br_victory: 'Victory', br_defeat: 'Defeat', br_retreat: 'Retreat',
    br_firstClear: 'First victory!',
    br_spoils: 'Spoils of War',
    br_missionReward: 'Mission reward', br_plunder: 'Plunder',
    br_plunderKept: (pct) => `Plunder kept (${pct}%)`,
    br_firstBonus: 'First victory bonus', br_total: 'Total',
    br_time: 'Time', br_par: (t) => `par ${t}`,
    br_fleet: 'Fleet report',
    br_afloat: (pct) => `Afloat · ${pct}%`,
    br_sunk: 'Sunk — wreck',
    br_needsRepair: 'Needs repair',
    br_return: 'Return to Harbor', br_retry: 'Retry',
    br_promoted: (nm) => `Promoted to ${nm}!`,
    br_lost: (n) => `${n} ${plural(n, 'ship', 'ships')} lost`,

    // ── Harbor bar / offline report ─────────────────────────
    hb_shipyard: 'Shipyard', hb_chart: 'World Chart', hb_setSail: 'Set Sail',
    hb_inYard: (n) => `${n} in yard`,
    hb_ready: (n) => `${n} ready`,
    hb_key: (k) => `Shortcut: ${k}`,
    away_title: 'While you were away',
    away_body: (d) => `Your harbor kept working for ${d}.`,
    away_finished: (nm) => `${nm} completed`,
    away_full: 'Storehouses are full',
    away_ok: 'Splendid!',

    // ── campaign progress + how to win ──────────────────────
    wc_campaign: (w, t) => `Campaign ${w}/${t}`,
    wc_campaignTip: (w, t, s, m) => `Missions won ${w}/${t} · stars ${s}/${m}`,
    wc_campaignDone: 'Campaign won',
    wc_help: 'How to win',
    help_title: 'How to win',
    help_battle_h: 'Sea battles',
    help_battle_1: 'Complete the mission objective: sink every enemy ship, destroy the enemy forts, hold out until the timer runs out, or capture the marked island.',
    help_battle_2: 'You lose if every ship you brought is sunk, if you retreat, or if a time limit runs out.',
    help_stars: 'Stars: ★ win · ★★ win without losing a ship · ★★★ also beat the par time.',
    help_campaign_h: 'The campaign',
    help_campaign_1: (nm, rank) => `Win the final battle, ${nm}, to complete the campaign and be named ${rank}.`,
    help_campaign_2: 'Battles earn renown. Renown raises your admiral rank and opens new sea regions.',
    help_fleet_h: 'Your fleet',
    help_fleet_1: 'Ships sunk in battle come home as wrecks — salvage them in the Shipyard. Damaged ships come home damaged; repair them there too.',
    help_war_h: 'Open War',
    help_war_1: 'The classic match: push the War Front to 100% to win.',
    help_ok: 'Understood',
    br_campaign: 'Campaign won!',
    br_campaignSub: (nm, rank) => `${nm} is won — you are ${rank}!`,

    // ── world map ───────────────────────────────────────────
    wc_cartoucheW: 'A New Chart of the World',
    wc_cartoucheWSub: 'with the sea-roads of the East and West Indies',
    wc_faction: 'Enemy colours',
    lbl_america: 'America', lbl_brasil: 'Brasil', lbl_africa: 'Africa', lbl_europa: 'Europa',
    lbl_arabia: 'Arabia', lbl_persia: 'Persia', lbl_india: 'India', lbl_china: 'China', lbl_asia: 'Asia',
    lbl_holland: 'Nova Hollandia', lbl_newspain: 'Nueva España',
    sea_atlantic: 'Oceanus Atlanticus', sea_indian: 'Mare Indicum', sea_pacific: 'Mar del Sur',
    sea_ethiopic: 'Oceanus Æthiopicus', sea_north: 'Mar del Norte',
  },

  vi: {
    // ── common ──────────────────────────────────────────────
    close: 'Đóng', cancel: 'Huỷ', confirm: 'Xác nhận', back: 'Quay lại',
    wood: 'Gỗ', gold: 'Vàng', renown: 'Danh vọng',
    hp: 'Thân tàu', tier: 'Hạng', tierN: (r) => `Hạng ${r}`,
    cls_light: 'Nhẹ', cls_standard: 'Tiêu chuẩn', cls_heavy: 'Hạng nặng',
    slot_L: 'Mạn trái', slot_R: 'Mạn phải', slot_B: 'Mũi tàu', slot_S: 'Đuôi tàu',
    slotEmpty: 'trống',
    st_ready: 'Sẵn sàng', st_building: 'Đang đóng', st_repairing: 'Đang sửa',
    st_salvaging: 'Đang trục vớt', st_wreck: 'Xác tàu',
    need: (parts) => `Cần thêm ${parts}`,
    dur_h: (h, m) => `${h} giờ ${m} phút`, dur_m: (m) => `${m} phút`, dur_s: (s) => `${s} giây`,

    // ── Shipyard ────────────────────────────────────────────
    sy_title: 'Xưởng tàu',
    sy_lv: (n) => `Cấp ${n}`,
    sy_none: 'Chưa xây',
    sy_unlocks: (r) => `Đóng được tới Hạng ${r}`,
    sy_slipways: 'Triền đà', sy_slipwaysTip: 'Số tàu có thể đóng cùng lúc (mỗi xưởng một triền)',
    sy_berths: 'Bến neo', sy_berthsTip: 'Số tàu cảng của bạn có thể giữ',
    sy_fleetcap: 'Ra trận tối đa', sy_fleetcapTip: 'Số tàu tối đa có thể ra một trận',
    sy_roster: 'Đội tàu của bạn', sy_catalogue: 'Bản vẽ đóng tàu',
    sy_tab_roster: 'Đội tàu', sy_tab_build: 'Đóng tàu',
    sy_battles: (n) => `${n} trận`,
    sy_sinks: (n) => `Đánh chìm ${n}`,
    sy_seaworthy: 'Nguyên vẹn',
    sy_sunkNote: 'Bị đánh chìm — hãy trục vớt hoặc phá dỡ',
    sy_inDock: 'Đang nằm ụ',
    sy_onSlip: 'Trên triền đà',
    sy_readyIn: (t) => `Xong sau ${t}`,
    sy_repair: 'Sửa chữa', sy_salvage: 'Trục vớt', sy_rush: 'Tăng tốc', sy_scrap: 'Phá dỡ', sy_build: 'Đóng',
    sy_rushTip: 'Dùng vàng để hoàn thành ngay',
    sy_scrapQ: (nm) => `Phá dỡ ${nm}?`,
    sy_scrapRefund: (r) => `Hoàn lại ${r}. Không thể hoàn tác.`,
    sy_lastShip: 'Không thể phá dỡ con tàu cuối cùng',
    sy_noScrapBuilding: 'Không thể phá dỡ tàu đang đóng',
    sy_speed: 'Tốc độ', sy_slots: 'Ô pháo', sy_time: 'Thời gian đóng', sy_cost: 'Chi phí',
    sy_tierLocked: (n) => `Cần Xưởng tàu cấp ${n}`,
    sy_tierOpen: 'Đã mở',
    sy_noYardTitle: 'Cảng chưa có Xưởng tàu',
    sy_noYardBody: 'Hãy xây Xưởng tàu từ menu Xây dựng để đóng tàu mới.',
    reason_no_shipyard: 'Hãy xây Xưởng tàu ở cảng trước',
    reason_shipyard_level: (n) => `Cần Xưởng tàu cấp ${n}`,
    reason_slipway_busy: 'Tất cả triền đà đang bận',
    reason_roster_full: 'Bến neo đã đầy — hãy phá dỡ bớt tàu',
    reason_unknown_hull: 'Không rõ loại tàu',
    t_buildStart: (nm, hull) => `⚒ Bắt đầu đóng ${nm} (${hull})`,
    t_ready: (nm) => `⚓ ${nm} đã sẵn sàng ra khơi!`,
    t_repair: (nm) => `🔧 ${nm} đã vào ụ sửa chữa`,
    t_salvage: (nm) => `⚓ Thợ lặn đang trục vớt ${nm}`,
    t_rush: (nm) => `⚡ ${nm} đã hoàn tất sớm`,
    t_scrap: (nm, r) => `🪓 Đã phá dỡ ${nm} (+${r})`,
    t_fail: 'Hiện chưa thể thực hiện',

    // ── World Chart ─────────────────────────────────────────
    wc_title: 'Hải đồ',
    wc_cartouche: 'Quần Đảo',
    wc_cartoucheSub: 'Hải đồ Bộ Hải quân vùng biển phía tây',
    wc_leagues: 'Hải lý',
    wc_back: 'Về cảng', wc_backTip: 'Trở về cảng nhà',
    wc_next: (need, nm) => `Còn ${need} danh vọng để lên ${nm}`,
    wc_max: 'Đã đạt quân hàm cao nhất',
    wc_ready: (n) => `${n} sẵn sàng`,
    wc_readyTip: 'Số tàu sẵn sàng ra khơi',
    wc_home: 'Cảng nhà',
    wc_locked: 'Chưa mở', wc_open: 'Đã mở', wc_won: 'Đã thắng',
    wc_regionLock: (n) => `Danh vọng ${n}`,
    wc_regionLockLong: (n, region) => `Đạt ${n} danh vọng để tiến vào ${region}`,
    wc_requires: (names) => `Cần thắng trước: ${names}`,
    wc_repeatable: 'Lặp lại được',
    wc_patrols: (n) => `Đã thắng ${n}`,
    wc_briefing: 'Lệnh tác chiến',
    wc_closeBrief: 'Đóng lệnh tác chiến',
    wc_objective: 'Mục tiêu',
    obj_sink_all: 'Đánh chìm toàn bộ tàu địch',
    obj_destroy_forts: (n) => (n > 1 ? `Phá huỷ cả ${n} pháo đài địch` : 'Phá huỷ pháo đài địch'),
    obj_survive: (t, w) => `Giữ ít nhất một tàu trụ vững ${t} trước ${w} đợt tấn công`,
    obj_capture: (names) => `Chiếm ${names}`,
    obj_timeLimit: (t) => `Giới hạn ${t}`,
    wc_enemies: 'Lực lượng địch',
    wc_wave: (i, t) => `Đợt ${i} · ${t}`,
    wc_fort: 'Pháo đài',
    wc_reward: 'Phần thưởng', wc_firstClear: 'Thưởng chiến thắng đầu', wc_claimed: 'Đã nhận',
    wc_plunderNote: '+ chiến lợi phẩm cho mỗi tàu địch bị đánh chìm',
    wc_renownGain: (n) => `+${n} danh vọng`,
    wc_par: 'Thời gian chuẩn', wc_best: 'Tốt nhất',
    wc_star1: 'Chiến thắng', wc_star2: 'Không mất tàu', wc_star3: (t) => `Dưới ${t}`,
    wc_fleet: 'Hạm đội xuất kích',
    wc_sel: (n, cap) => `${n} / ${cap} tàu`,
    wc_capReached: 'Đã đủ số tàu tối đa',
    wc_lowHp: 'Thân tàu yếu',
    wc_lowHpTip: 'Dưới 40% độ bền — nên sửa trước khi ra khơi',
    wc_noShips: 'Không có tàu nào sẵn sàng. Hãy ghé Xưởng tàu để đóng hoặc sửa tàu.',
    wc_inYard: (n) => `Còn ${n} tàu trong xưởng`,
    wc_setSail: 'Ra khơi ⛵',
    wc_sailing: 'Đang nhổ neo…',
    wc_pickShip: 'Hãy chọn ít nhất một tàu',
    wc_patrolNote: 'Sức mạnh của địch tăng theo quân hàm của bạn.',
    wc_openWar: 'Đại chiến',
    wc_openWarTag: 'Trận kinh điển',
    wc_openWarDesc: 'Trận đấu đầy đủ kinh điển: chiếm đảo, xây dựng, nghiên cứu và đẩy lùi mặt trận trước một đô đốc đối địch. Cảng nhà và hạm đội của bạn không bị ảnh hưởng.',
    wc_declare: 'Tuyên chiến ⚔',

    // ── Battle result ───────────────────────────────────────
    br_victory: 'Chiến thắng', br_defeat: 'Thất bại', br_retreat: 'Rút lui',
    br_firstClear: 'Chiến thắng đầu tiên!',
    br_spoils: 'Phần thưởng',
    br_missionReward: 'Thưởng nhiệm vụ', br_plunder: 'Chiến lợi phẩm',
    br_plunderKept: (pct) => `Giữ lại chiến lợi phẩm (${pct}%)`,
    br_firstBonus: 'Thưởng chiến thắng đầu', br_total: 'Tổng cộng',
    br_time: 'Thời gian', br_par: (t) => `chuẩn ${t}`,
    br_fleet: 'Báo cáo hạm đội',
    br_afloat: (pct) => `Còn nổi · ${pct}%`,
    br_sunk: 'Bị chìm — thành xác tàu',
    br_needsRepair: 'Cần sửa chữa',
    br_return: 'Về cảng', br_retry: 'Đánh lại',
    br_promoted: (nm) => `Thăng quân hàm: ${nm}!`,
    br_lost: (n) => `Mất ${n} tàu`,

    // ── Harbor bar / offline report ─────────────────────────
    hb_shipyard: 'Xưởng tàu', hb_chart: 'Hải đồ', hb_setSail: 'Ra khơi',
    hb_inYard: (n) => `${n} trong xưởng`,
    hb_ready: (n) => `${n} sẵn sàng`,
    hb_key: (k) => `Phím tắt: ${k}`,
    away_title: 'Trong lúc bạn vắng mặt',
    away_body: (d) => `Cảng nhà vẫn làm việc suốt ${d}.`,
    away_finished: (nm) => `${nm} đã hoàn thành`,
    away_full: 'Kho đã đầy',
    away_ok: 'Tuyệt vời!',

    // ── campaign progress + how to win ──────────────────────
    wc_campaign: (w, t) => `Chiến dịch ${w}/${t}`,
    wc_campaignTip: (w, t, s, m) => `Đã thắng ${w}/${t} nhiệm vụ · ${s}/${m} sao`,
    wc_campaignDone: 'Đã chinh phục chiến dịch',
    wc_help: 'Cách giành chiến thắng',
    help_title: 'Cách giành chiến thắng',
    help_battle_h: 'Hải chiến',
    help_battle_1: 'Hoàn thành mục tiêu nhiệm vụ: đánh chìm toàn bộ tàu địch, phá huỷ pháo đài địch, cầm cự đến hết giờ hoặc chiếm hòn đảo được đánh dấu.',
    help_battle_2: 'Bạn thua nếu mọi tàu mang theo đều bị đánh chìm, nếu bạn rút lui, hoặc khi hết thời gian giới hạn.',
    help_stars: 'Sao: ★ chiến thắng · ★★ thắng mà không mất tàu nào · ★★★ thắng nhanh hơn thời gian chuẩn.',
    help_campaign_h: 'Chiến dịch',
    help_campaign_1: (nm, rank) => `Thắng trận cuối cùng, ${nm}, để hoàn thành chiến dịch và được phong ${rank}.`,
    help_campaign_2: 'Mỗi trận đánh mang lại danh vọng. Danh vọng nâng quân hàm và mở ra những vùng biển mới.',
    help_fleet_h: 'Hạm đội',
    help_fleet_1: 'Tàu bị đánh chìm sẽ trở về cảng dưới dạng xác tàu — hãy trục vớt ở Xưởng tàu. Tàu hư hại vẫn mang thương tích về cảng; sửa chữa cũng tại đó.',
    help_war_h: 'Đại chiến',
    help_war_1: 'Trận đấu kinh điển: đẩy Mặt trận lên 100% để giành chiến thắng.',
    help_ok: 'Đã hiểu',
    br_campaign: 'Chiến dịch toàn thắng!',
    br_campaignSub: (nm, rank) => `Đã chiến thắng ${nm} — bạn là ${rank}!`,

    // ── world map ───────────────────────────────────────────
    wc_cartoucheW: 'Tân Hải Đồ Thế Giới',
    wc_cartoucheWSub: 'cùng các hải lộ Đông Ấn và Tây Ấn',
    wc_faction: 'Cờ hiệu địch',
    lbl_america: 'Châu Mỹ', lbl_brasil: 'Brasil', lbl_africa: 'Châu Phi', lbl_europa: 'Châu Âu',
    lbl_arabia: 'Ả Rập', lbl_persia: 'Ba Tư', lbl_india: 'Ấn Độ', lbl_china: 'Trung Hoa', lbl_asia: 'Châu Á',
    lbl_holland: 'Tân Hà Lan', lbl_newspain: 'Tân Tây Ban Nha',
    sea_atlantic: 'Đại Tây Dương', sea_indian: 'Ấn Độ Dương', sea_pacific: 'Thái Bình Dương',
    sea_ethiopic: 'Biển Nam Phi', sea_north: 'Bắc Đại Tây Dương',

    // ── data names (EN comes from data/*.js) ────────────────
    rank_captain: 'Thuyền trưởng', rank_commodore: 'Đề đốc', rank_rear_admiral: 'Chuẩn Đô đốc',
    rank_vice_admiral: 'Phó Đô đốc', rank_admiral: 'Đô đốc Quần đảo',

    region_reef: 'Bãi San Hô', region_straits: 'Eo Gió Mặn', region_storm: 'Vùng Bão Tố',
    regiond_reef: 'Vùng nước ấm nơi bọn buôn lậu ẩn nấp giữa các rạn san hô.',
    regiond_straits: 'Eo biển hẹp do các thuyền trưởng cướp biển và khẩu đội của chúng trấn giữ.',
    regiond_storm: 'Nước đen, hạm đội sắt và Thành Bão Tố.',

    hull_sloop: 'Thuyền Sloop', hull_cutter: 'Thuyền Cutter', hull_schooner: 'Thuyền Schooner',
    hull_brigantine: 'Tàu Brigantine', hull_brig: 'Tàu Brig chiến', hull_corvette: 'Tàu hộ tống',
    hull_frigate: 'Khinh hạm', hull_xebec: 'Thuyền Xebec', hull_galleon: 'Tàu Galleon',
    hull_heavy_frigate: 'Khinh hạm hạng nặng', hull_war_galleon: 'Galleon chiến',
    hull_man_o_war: 'Chiến hạm', hull_ship_of_the_line: 'Tàu chiến tuyến',

    mis_reef_1: 'Vịnh Buôn Lậu',
    misd_reef_1: 'Hai thuyền sloop buôn lậu đang chở hàng cấm qua vùng biển của ta. Đánh chìm chúng.',
    mis_reef_2: 'Khẩu đội Đá Đèn',
    misd_reef_2: 'Khẩu đội của bọn buôn lậu trên Đá Đèn nã pháo vào mọi thương thuyền. Hãy bịt miệng pháo đài ấy.',
    mis_reef_3: 'Giữ Vững Lạch Biển',
    misd_reef_3: 'Bọn đột kích kéo đến từng đợt. Giữ ít nhất một tàu còn nổi cho đến khi thủy triều đổi chiều.',
    mis_straits_1: 'Hải đội Cướp biển',
    misd_straits_1: 'Thuyền trưởng Vey dẫn một tàu brigantine và hai thuyền sloop qua eo biển. Hãy đập tan hải đội này.',
    mis_straits_2: 'Chiếm Cảng Hải Âu',
    misd_straits_2: 'Cảng Hải Âu có bến cảng tuyệt đẹp mà chưa có chủ. Hãy chiếm lấy trước bọn cướp biển.',
    mis_straits_3: 'Hai Khẩu đội Song sinh',
    misd_straits_3: 'Hai khẩu đội canh giữ eo Gió Mặn, cùng một khinh hạm đi tuần. Hãy hạ gục chúng.',
    mis_storm_1: 'Cơn Giông Đen',
    misd_storm_1: 'Mắc kẹt giữa cơn giông với tàu đột kích tứ phía. Hãy trụ vững cho đến khi bão tan.',
    mis_storm_2: 'Hạm đội Sắt',
    misd_storm_2: 'Hạm đội Sắt đang tiến đến phong toả các cảng của ta. Hãy đón đánh ngoài khơi và nhấn chìm chúng.',
    mis_storm_3: 'Thành Bão Tố',
    misd_storm_3: 'Thành Bão Tố thống trị cả vùng biển. Tường thành, tàu galleon và chiến hạm của nó đều phải sụp đổ.',
    mis_patrol: 'Tuần tra Cướp biển',
    misd_patrol: 'Càn quét hải phận lân cận để truy lùng cướp biển. Có thể lặp lại; càng lên quân hàm địch càng mạnh.',

    isle_gullhaven: 'Cảng Hải Âu', isle_lantern: 'Đá Đèn', isle_tw_n: 'Khẩu đội Bắc',
    isle_tw_s: 'Khẩu đội Nam', isle_citadel: 'Thành Bão Tố',
  },
};

// UI2 pass: onboarding / help / settings keys (EN, VI) + full FR and JA tables
Object.assign(MS.en, UI2.en);
Object.assign(MS.vi, UI2.vi);
MS.fr = FR;
MS.ja = JA;

/** Active language code, tolerant of i18n not being initialised (Node tests). */
function lang() {
  try { return getLang() || 'en'; } catch { return 'en'; }
}

/** Raw lookup without the key fallback (undefined when missing everywhere). */
function lookup(key) {
  const l = lang();
  const v = MS[l] && MS[l][key] !== undefined ? MS[l][key] : MS.en[key];
  return v;
}

/**
 * Meta-UI string for the active language (falls back to EN, then the key).
 * @param {string} key
 * @param {...*} args passed to function-valued strings
 * @returns {string}
 */
export function ms(key, ...args) {
  const v = lookup(key);
  if (v === undefined) return key;
  return typeof v === 'function' ? v(...args) : v;
}

/** Translation of a data name if one exists, else the provided fallback. */
function dataName(key, fallback) {
  const v = lookup(key);
  return v === undefined ? fallback : (typeof v === 'function' ? v() : v);
}

/** Vietnamese name/desc carried by the data record itself (faction.vi, sea.vi, mission.vi). */
function viData(o, field) {
  if (!o || lang() !== 'vi') return undefined;
  if (field === 'nm') return o.vi || o.nmVi || o.nm_vi || undefined;
  return o.descVi || o.desc_vi || o.vi_desc || undefined;
}

export const hullName    = (h) => viData(h, 'nm') ?? dataName('hull_' + h.id, h.nm);
export const rankName    = (r) => viData(r, 'nm') ?? dataName('rank_' + r.id, r.nm);
export const regionName  = (r) => viData(r, 'nm') ?? dataName('region_' + r.id, r.nm);
export const regionDesc  = (r) => viData(r, 'desc') ?? dataName('regiond_' + r.id, r.desc || '');
export const missionName = (m) => viData(m, 'nm') ?? dataName('mis_' + m.id, m.nm);
export const missionDesc = (m) => viData(m, 'desc') ?? dataName('misd_' + m.id, m.desc || '');
export const isleName    = (i) => viData(i, 'nm') ?? dataName('isle_' + i.id, i.nm);
export const factionName = (f) => (f ? viData(f, 'nm') ?? dataName('fac_' + f.id, f.nm ?? f.id ?? '') : '');
export const className   = (c) => ms('cls_' + c);

/** Locale-aware integer formatting (1,234 / 1.234). */
export function fmtNum(n) {
  const v = Math.floor(Number(n) || 0);
  try { return v.toLocaleString({ vi: 'vi-VN', fr: 'fr-FR', ja: 'ja-JP' }[lang()] || 'en-US'); } catch { return String(v); }
}

/** Countdown clock: 45 → "0:45", 125 → "2:05", 3725 → "1:02:05". */
export function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const pad = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}

/** Human duration: 8040 → "2 h 14 min", 300 → "5 min", 40 → "40 s". */
export function fmtDur(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  if (s >= 3600) return ms('dur_h', Math.floor(s / 3600), Math.floor((s % 3600) / 60));
  if (s >= 60) return ms('dur_m', Math.round(s / 60));
  return ms('dur_s', s);
}

/** Roman numeral for a tier number (1..10). */
export function roman(n) {
  return ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || String(n);
}
