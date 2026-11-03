// ── FACTIONS — who sails the seas, c. 1570–1720 ───────────────────
// Shared by: campaign missions (mission.faction / enemy.faction), ship
// meshes (flag/sail/trim), UI badges, music colour. Names of companies are
// FICTIONAL analogues of the chartered trading companies of the era —
// never use film-franchise names.
//
// style: hull/rig family the ship mesh should use for this faction's ships
//   'european'  square-rigged carracks, galleons, frigates
//   'junk'      Chinese / Vietnamese junks — battened lug sails, high stern
//   'dhow'      Indian Ocean ghurabs / dhows — lateen sails, raked bows
//   'prau'      Malay lanong / penjajap — low galleys with tanja sails and oars
// colours are hex ints for 3D, css strings for UI.

export const FACTIONS = {
  player: {
    id: 'player', nm: 'Your Harbor', kind: 'player', style: 'european',
    flag: { field: 0xf2ead8, charge: 0x1d3f6e, pattern: 'anchor' }, sail: 0xf3ecd9, trim: 0x1d3f6e,
    css: '#1d3f6e', vi: 'Cảng của bạn',
  },

  // ── Caribbean ──────────────────────────────────────────────────
  buccaneers: {
    id: 'buccaneers', nm: 'Brethren of the Coast', kind: 'pirates', style: 'european', home: 'caribbean',
    flag: { field: 0x111111, charge: 0xeeeeee, pattern: 'skull' }, sail: 0x3a3530, trim: 0x2a1a12,
    css: '#2a2522', vi: 'Huynh đệ Bờ biển (hải tặc Caribe)',
    note: 'English, French and Dutch buccaneers of Tortuga and Port Royal.',
    shipNames: ['Black Gull', 'Rum Runner', 'Quiet Eel', 'Night Heron', 'Cutthroat Wren', 'Bilge Rat', 'Tortuga Belle', 'Mad Kestrel'],
  },
  spain: {
    id: 'spain', nm: 'Armada of the Spanish Crown', kind: 'crown', style: 'european', home: 'caribbean',
    flag: { field: 0xf4f0e4, charge: 0xb01e23, pattern: 'saltire' }, sail: 0xf1e9d2, trim: 0xb8862b,
    css: '#b01e23', vi: 'Hạm đội Hoàng gia Tây Ban Nha',
    note: 'Treasure-fleet escorts of the Carrera de Indias; Cross of Burgundy ensign.',
    shipNames: ['San Isidro', 'Nuestra Señora del Rayo', 'Santa Catalina', 'San Felipe', 'La Concepción', 'San Telmo', 'Santo Domingo'],
  },
  france: {
    id: 'france', nm: 'French Royal Navy & Corsairs', kind: 'crown', style: 'european', home: 'caribbean',
    flag: { field: 0xf6f3ea, charge: 0xd4b04a, pattern: 'plain' }, sail: 0xf4eedd, trim: 0x2a3f8f,
    css: '#2a3f8f', vi: 'Hải quân Pháp & tư lược Saint-Malo',
    note: 'White ensign of the Bourbon navy; corsairs of Saint-Malo and Saint-Domingue.',
    shipNames: ['Le Faucon', 'La Belle Étoile', 'Le Hardi', 'La Licorne', 'Le Saint-Malo', 'La Railleuse'],
  },
  england: {
    id: 'england', nm: 'Honourable Saltwind Company', kind: 'company', style: 'european', home: 'atlantic',
    flag: { field: 0xb22234, charge: 0xf4f0e4, pattern: 'stripes' }, sail: 0xf3ede0, trim: 0x8a1e22,
    css: '#8a1e22', vi: 'Công ty Saltwind Danh giá (thương hội Anh)',
    note: 'Fictional chartered English trading company — striped company ensign, armed Indiamen.',
    shipNames: ['Saltwind Merchant', 'Red Dragon', 'Good Hope', 'Hector', 'Ascension', 'Royal Exchange'],
  },
  netherlands: {
    id: 'netherlands', nm: 'Spice Company of the Seven Provinces', kind: 'company', style: 'european', home: 'spice',
    flag: { field: 0xff7f00, charge: 0x21468b, pattern: 'tricolour' }, sail: 0xefe6cf, trim: 0xd06a10,
    css: '#d06a10', vi: 'Công ty Hương liệu Bảy Tỉnh (thương hội Hà Lan)',
    note: 'Fictional Dutch chartered company — orange-white-blue Prince\'s flag, fluyts and retourschepen.',
    shipNames: ['Gouden Leeuw', 'Zeerob', 'Nieuw Batavia', 'De Hoop', 'Witte Valk', 'Amboina'],
  },
  portugal: {
    id: 'portugal', nm: 'Estado da Índia (Portugal)', kind: 'crown', style: 'european', home: 'indian',
    flag: { field: 0xf4f0e4, charge: 0x1f4fa0, pattern: 'quinas' }, sail: 0xf2eadb, trim: 0x8a2a2a,
    css: '#1f4fa0', vi: 'Estado da Índia (Bồ Đào Nha)',
    note: 'Carracks and galleons of Goa, Malacca and Macau; red Cross of the Order of Christ on the sails.',
    shipNames: ['São Gabriel', 'Madre de Deus', 'Santa Cruz', 'São Bento', 'Flor de la Mar', 'Nossa Senhora da Graça'],
  },

  // ── Indian Ocean & Asian seas ──────────────────────────────────
  malabar: {
    id: 'malabar', nm: 'Malabar Corsairs', kind: 'pirates', style: 'dhow', home: 'indian',
    flag: { field: 0xc0392b, charge: 0xf1c40f, pattern: 'plain' }, sail: 0xd9c49a, trim: 0x7a3b16,
    css: '#c0392b', vi: 'Cướp biển Malabar (Ấn Độ)',
    note: 'Swift ghurabs and paals of the Malabar coast; raiders of the spice lanes.',
    shipNames: ['Kunjali\'s Wrath', 'Monsoon Hawk', 'Calicut Star', 'Pepper Wind', 'Tiger of Kannur'],
  },
  malay: {
    id: 'malay', nm: 'Orang Laut Raiders', kind: 'pirates', style: 'prau', home: 'spice',
    flag: { field: 0xf2c200, charge: 0x8b0000, pattern: 'plain' }, sail: 0xc8a96e, trim: 0x5a3a1e,
    css: '#a0782a', vi: 'Hải tặc Orang Laut (eo Malacca – Singapore)',
    note: 'Sea nomads and lanong war-praus around Singapura and the Straits of Malacca.',
    shipNames: ['Lanong Merah', 'Naga Laut', 'Angin Selatan', 'Penjajap Hitam', 'Bintang Temasek'],
  },
  chinese: {
    id: 'chinese', nm: 'Red Banner Fleet', kind: 'pirates', style: 'junk', home: 'southchina',
    flag: { field: 0xc0161d, charge: 0xf5d76e, pattern: 'banner' }, sail: 0x9a5a3a, trim: 0x7a1010,
    css: '#c0161d', vi: 'Hạm đội Cờ Đỏ (hải tặc Trung Hoa)',
    note: 'Pirate-merchant war junks of the Fujian coast with battened sails and painted eyes on the bow.',
    shipNames: ['Golden Carp', 'Jade Tide', 'Red Kite', 'Thunder of Amoy', 'Dragon\'s Whisker'],
  },
  vietnamese: {
    id: 'vietnamese', nm: 'Gulf of Tonkin Raiders', kind: 'pirates', style: 'junk', home: 'southchina',
    flag: { field: 0xe8c33a, charge: 0x9b1b1b, pattern: 'banner' }, sail: 0xb08a5a, trim: 0x2f4a2f,
    css: '#b8922a', vi: 'Hải tặc Vịnh Bắc Bộ (Việt Nam)',
    note: 'Fast war junks and ghe bầu sailing from the islands of the Gulf of Tonkin.',
    shipNames: ['Sóng Bạc', 'Hải Long', 'Phong Ba', 'Cá Kình', 'Bạch Đằng Gió'],
  },
};

/** Sea regions of the World Chart and who holds them (campaign order). */
export const SEAS = [
  { id: 'caribbean',  nm: 'The Caribbean',       vi: 'Biển Caribe',          factions: ['buccaneers', 'spain', 'france'] },
  { id: 'atlantic',   nm: 'The Atlantic Lanes',  vi: 'Hải lộ Đại Tây Dương', factions: ['england', 'france'] },
  { id: 'indian',     nm: 'The Indian Ocean',    vi: 'Ấn Độ Dương',          factions: ['portugal', 'malabar'] },
  { id: 'spice',      nm: 'The Spice Straits',   vi: 'Eo biển Hương liệu',   factions: ['netherlands', 'malay'] },
  { id: 'southchina', nm: 'The South China Sea', vi: 'Biển Đông',            factions: ['chinese', 'vietnamese', 'portugal'] },
];

export const factionOf = id => FACTIONS[id] || FACTIONS.buccaneers;
