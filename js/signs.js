// js/signs.js — readable signage from one canvas atlas: shop fascias on the modernist canopies, hand-painted names on
// colonial verandahs, backlit rooftop billboards, faded painted adverts on old party walls, and company names lit up
// on tower tops. Every name and brand is fictional. buildings.js places the quads; this module draws and meshes them.
import * as THREE from 'three';
import { rng } from './util.js';

const W = 2048, H = 2048;

export const SHOPS = [
  "Mai Rufaro Hair Salon", "Chipo's Fashions", 'Takudzwa Hardware', 'Mbare Musika Wholesalers', 'Zambezi Pharmacy',
  'Kopje Butchery', 'Sunshine Bakery', 'Highfield Electronics', 'Avenues Supermarket', 'Jacaranda Café', 'Sadza Express',
  'Tinashe Cellphones & Repairs', 'Shumba Insurance', 'Msasa Building Society', 'Baba Tendai Shoe Repairs',
  'Mutare Road Furnishers', 'Chiedza Bookshop', 'Gokwe Cotton Traders', 'Mufaro Opticians', 'Rumbidzai Beauty Parlour',
  'Kariba Fisheries', 'Mbuya Nehanda Fabrics', 'Mosi Travel & Tours', 'Great Dyke Mining Supplies', 'Tafadzwa Auto Spares',
  'Gweru General Dealers', 'Borrowdale Bridal', 'Domboshava Dairy', 'Chitungwiza Wholesale', 'Ruwa Paint & Hardware',
  'Mukuvisi Furniture', 'Mabvuku Money Transfer', "Tsitsi's Tailoring", 'Kudzai Phone Accessories', 'Mhofu Meats',
  'Nyasha Cash & Carry', 'Marondera Seed House', 'Eastlea Electrical', 'Belvedere Bicycles', 'Glen View Textiles',
  'Mazowe Valley Fruiters', 'Chimanimani Coffee House', 'Kuwadzana Boutique', 'Matopos Pharmacy', 'Tongai Photo Studio',
  'Musasa Dry Cleaners', 'Mukoma Electronics', "Simba's Barber Shop", 'Mbira Music Centre', 'Shingai Stationers',
  'Dzivarasekwa Tyres', 'Chapungu Jewellers', 'Avenues Book Exchange', 'Zvido Fast Foods', 'Mhondoro Chicken Inn-Out',
];
const OLD_FIRMS = [
  'Takudzwa Hardware (Pvt) Ltd', 'Kopje Trading Store', 'Moyo & Sons General Dealers', 'Pioneer Street Outfitters',
  'Salisbury Saddlery', 'Mhofu Bros Butchery', 'Gwanzura Drapers', 'Nhamo Bicycle Works', 'Chikomba Grain & Feed',
  'Sabi Valley Merchants', 'Manica Road Pharmacy', 'Hunyani Tailors', 'Lomagundi Seed Co.', 'Mukwati Tea Room',
  'Charter Hotel Bar', 'Umvukwes Ironmongers',
];
const BILLBOARDS = [
  { brand: 'Mbira Mobile', line: '4G everywhere · $1 data bundles', bg: ['#4b1a7a', '#7d2fb8'], fg: '#c6f432', mark: 'wave' },
  { brand: 'Chiedza Orange', line: 'Squeeze the sunshine', bg: ['#f07b0c', '#ffb02e'], fg: '#ffffff', mark: 'bottle' },
  { brand: 'Gomo Lager', line: 'Brewed on the highveld', bg: ['#7a1010', '#b0281a'], fg: '#f5c542', mark: 'bottle' },
  { brand: 'Msasa Building Society', line: 'Build your home with us', bg: ['#0d4d2b', '#1f7a46'], fg: '#ffffff', mark: 'house' },
  { brand: 'Zambezi Bank', line: 'Banking that flows', bg: ['#0a3d7a', '#1767b8'], fg: '#ffffff', mark: 'wave' },
  { brand: 'Tsoko Telecom', line: 'Talk more, pay less  *130#', bg: ['#c8102e', '#e8323f'], fg: '#ffffff', mark: 'phone' },
  { brand: 'Mukoma Cooking Oil', line: 'Pure sunflower goodness', bg: ['#f2c200', '#ffe066'], fg: '#7a3b00', mark: 'sun' },
  { brand: 'Shumba Insurance', line: 'Strength for your family', bg: ['#5a1530', '#8a2550'], fg: '#f5d76e', mark: 'shield' },
];
const WALL_ADS = [
  { t: 'DRINK', b: 'CHIEDZA ORANGE', s: 'Squeeze the sunshine', bg: '#e8761a', fg: '#ffffff', mark: 'bottle' },
  { t: 'Cook with', b: 'MUKOMA OIL', s: 'Pure sunflower', bg: '#f0c419', fg: '#6a2a00', mark: 'sun' },
  { t: 'Colour your home', b: 'JACARANDA PAINTS', s: 'Sold here', bg: '#6a4aa8', fg: '#ffffff', mark: 'none' },
  { t: 'Built for Zim roads', b: 'GONA BICYCLES', s: 'Strong · Reliable', bg: '#1b5e9a', fg: '#ffe9a8', mark: 'none' },
  { t: 'The national cuppa', b: 'HWITI TEA', s: 'From the Eastern Highlands', bg: '#b0301c', fg: '#fff3d6', mark: 'none' },
  { t: 'Roller Meal', b: 'SADZA GOLD', s: '10 kg · 20 kg', bg: '#f4ead2', fg: '#a01a1a', mark: 'sun' },
  { t: 'Washes whiter', b: 'KANZURU SOAP', s: 'Bar & powder', bg: '#1f8a4a', fg: '#ffffff', mark: 'none' },
  { t: 'Buy airtime here', b: 'MBIRA MOBILE', s: 'Recharge · Data · Money', bg: '#4b1a7a', fg: '#c6f432', mark: 'wave' },
];
const CROWNS = ['SHUMBA INSURANCE', 'MSASA BUILDING SOCIETY', 'ZAMBEZI BANK', 'MBIRA MOBILE', 'KOPJE HOUSE', 'CHIEDZA HOUSE', 'TSOKO TOWERS', 'NYAMAPANDA CENTRE'];
const BRAND = ['#c8102e', '#0a4ea2', '#1b8a3a', '#e35205', '#6a1b9a', '#00838f', '#111111', '#f2b705', '#8a1538', '#0d6e5c'];
const OLD_BG = ['#2f4a34', '#6b2a26', '#1d2a44', '#1a1a1a', '#5a3a1a', '#f1ead6'];

// Atlas layout: [x0, y0, cellW, cellH, cols, count]
const LAYOUT = {
  fascia: [0, 0, 512, 64, 4, 64], // 0-47 shop panels, 48-63 painted colonial names
  billboard: [0, 1024, 512, 192, 4, 8],
  wallad: [0, 1408, 512, 256, 4, 8],
  crown: [0, 1920, 512, 64, 4, 8],
};
export const ATLAS = { W, H, LAYOUT };
export const cellRect = (kind, i) => {
  const [x0, y0, cw, ch, cols] = LAYOUT[kind];
  return [x0 + (i % cols) * cw, y0 + Math.floor(i / cols) * ch, cw, ch];
};

function fit(g, text, weight, family, maxW, maxH) {
  let size = maxH;
  g.font = `${weight} ${size}px ${family}`;
  const w = g.measureText(text).width;
  if (w > maxW) size = Math.floor((size * maxW) / w);
  g.font = `${weight} ${size}px ${family}`;
  return size;
}

function mark(g, kind, x, y, s, col) {
  g.save();
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineWidth = s * 0.08;
  if (kind === 'bottle') {
    g.beginPath();
    g.moveTo(x - s * 0.12, y - s * 0.5);
    g.lineTo(x + s * 0.12, y - s * 0.5);
    g.lineTo(x + s * 0.12, y - s * 0.25);
    g.quadraticCurveTo(x + s * 0.3, y - s * 0.12, x + s * 0.3, y + s * 0.1);
    g.lineTo(x + s * 0.3, y + s * 0.5);
    g.lineTo(x - s * 0.3, y + s * 0.5);
    g.lineTo(x - s * 0.3, y + s * 0.1);
    g.quadraticCurveTo(x - s * 0.3, y - s * 0.12, x - s * 0.12, y - s * 0.25);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(x - s * 0.22, y, s * 0.44, s * 0.22);
  } else if (kind === 'sun') {
    g.beginPath(); g.arc(x, y, s * 0.24, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.beginPath(); g.moveTo(x + Math.cos(a) * s * 0.32, y + Math.sin(a) * s * 0.32); g.lineTo(x + Math.cos(a) * s * 0.46, y + Math.sin(a) * s * 0.46); g.stroke();
    }
  } else if (kind === 'wave') {
    for (let k = 0; k < 3; k++) {
      g.beginPath(); g.arc(x - s * 0.2, y + s * 0.2, s * (0.18 + k * 0.14), -Math.PI / 2, 0); g.stroke();
    }
    g.beginPath(); g.arc(x - s * 0.2, y + s * 0.2, s * 0.07, 0, Math.PI * 2); g.fill();
  } else if (kind === 'house') {
    g.beginPath(); g.moveTo(x - s * 0.4, y); g.lineTo(x, y - s * 0.4); g.lineTo(x + s * 0.4, y); g.closePath(); g.fill();
    g.fillRect(x - s * 0.28, y, s * 0.56, s * 0.38);
  } else if (kind === 'phone') {
    g.fillRect(x - s * 0.18, y - s * 0.4, s * 0.36, s * 0.8);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x - s * 0.13, y - s * 0.32, s * 0.26, s * 0.5);
  } else if (kind === 'shield') {
    g.beginPath(); g.moveTo(x - s * 0.3, y - s * 0.4); g.lineTo(x + s * 0.3, y - s * 0.4); g.lineTo(x + s * 0.3, y); g.quadraticCurveTo(x + s * 0.3, y + s * 0.35, x, y + s * 0.45); g.quadraticCurveTo(x - s * 0.3, y + s * 0.35, x - s * 0.3, y); g.closePath(); g.fill();
  }
  g.restore();
}

// A backlit rooftop billboard: { brand, line, bg: [from, to], fg, mark }. Also used for sponsors (js/features/sponsors.js).
export function paintBillboard(g, x, y, w, h, b) {
  g.save();
  g.textBaseline = 'middle';
  const grd = g.createLinearGradient(x, y, x + w, y + h);
  grd.addColorStop(0, b.bg[0]);
  grd.addColorStop(1, b.bg[1] || b.bg[0]);
  g.fillStyle = grd;
  g.fillRect(x, y, w, h);
  // big diagonal swoosh
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath(); g.moveTo(x + w * 0.55, y); g.lineTo(x + w, y); g.lineTo(x + w, y + h); g.lineTo(x + w * 0.75, y + h); g.closePath(); g.fill();
  const hasMark = b.mark && b.mark !== 'none';
  if (hasMark) mark(g, b.mark, x + w * 0.85, y + h * 0.5, h * 0.75, b.fg);
  g.textAlign = 'left';
  g.fillStyle = b.fg;
  fit(g, b.brand, '900', 'Arial Black, Arial, sans-serif', w * (hasMark ? 0.68 : 0.9), h * 0.34);
  g.fillText(b.brand, x + 22, y + h * 0.38);
  g.fillStyle = b.lineColor || '#ffffff';
  fit(g, b.line || '', 'bold', 'Arial, sans-serif', w * (hasMark ? 0.66 : 0.9), h * 0.16);
  g.fillText(b.line || '', x + 24, y + h * 0.7);
  g.fillStyle = 'rgba(0,0,0,0.5)';
  g.fillRect(x, y + h - 6, w, 6);
  g.restore();
}

// A hand-painted wall advert: { t, b, s, bg, fg, mark }; r (a random stream) adds sun-bleaching and flaking paint
export function paintWallAd(g, x, y, w, h, a, r = null) {
  g.save();
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillStyle = a.bg;
  g.fillRect(x, y, w, h);
  g.strokeStyle = a.fg;
  g.lineWidth = 5;
  g.strokeRect(x + 12, y + 12, w - 24, h - 24);
  const hasMark = a.mark && a.mark !== 'none';
  const cx = x + (hasMark ? w * 0.42 : w / 2);
  g.fillStyle = a.fg;
  fit(g, a.t || '', 'italic bold', 'Georgia, serif', w * 0.6, h * 0.16);
  g.fillText(a.t || '', cx, y + h * 0.27);
  fit(g, a.b, '900', 'Impact, "Arial Black", sans-serif', w * (hasMark ? 0.66 : 0.82), h * 0.3);
  g.fillText(a.b, cx, y + h * 0.52);
  fit(g, a.s || '', 'bold', 'Arial, sans-serif', w * 0.6, h * 0.11);
  g.fillText(a.s || '', cx, y + h * 0.77);
  if (hasMark) mark(g, a.mark, x + w * 0.83, y + h * 0.52, h * 0.55, a.fg);
  if (r) {
    // sun-bleached and peeling: pale wash, flakes and drips
    g.fillStyle = 'rgba(235,225,205,0.22)';
    g.fillRect(x, y, w, h);
    for (let k = 0; k < 260; k++) {
      g.fillStyle = `rgba(225,215,195,${0.15 + r() * 0.45})`;
      const fx = x + r() * w, fy = y + r() * h;
      g.fillRect(fx, fy, 2 + r() * 16, 1 + r() * 6);
    }
    for (let k = 0; k < 30; k++) {
      g.fillStyle = `rgba(60,45,35,${r() * 0.12})`;
      g.fillRect(x + r() * w, y + r() * h * 0.5, 1 + r() * 2, 20 + r() * 80);
    }
  }
  g.restore();
}

function drawAtlas() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const r = rng(77);
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  g.fillStyle = '#777';
  g.fillRect(0, 0, W, H);

  // Shop fascias: backlit panels and painted boards
  for (let i = 0; i < 48; i++) {
    const [x, y, w, h] = cellRect('fascia', i);
    const name = SHOPS[i % SHOPS.length];
    const style = i % 3;
    const brand = BRAND[Math.floor(r() * BRAND.length)];
    if (style === 0) {
      // backlit lightbox: brand colour with a white face strip
      g.fillStyle = brand;
      g.fillRect(x, y, w, h);
      g.fillStyle = 'rgba(255,255,255,0.18)';
      g.fillRect(x, y + 4, w, h * 0.32);
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 2;
      g.strokeRect(x + 5, y + 5, w - 10, h - 10);
      g.fillStyle = brand === '#f2b705' ? '#111' : '#fff';
      fit(g, name.toUpperCase(), '900', 'Arial, Helvetica, sans-serif', w - 40, h * 0.62);
      g.fillText(name.toUpperCase(), x + w / 2, y + h / 2 + 1);
    } else if (style === 1) {
      // painted white board, bold coloured lettering with a drop shadow, phone number
      g.fillStyle = '#f3efe4';
      g.fillRect(x, y, w, h);
      g.fillStyle = brand;
      g.fillRect(x, y + h - 9, w, 9);
      g.fillRect(x, y, w, 5);
      const tel = `Tel 0242-${700000 + Math.floor(r() * 99999)}`;
      fit(g, name, 'bold', 'Georgia, "Times New Roman", serif', w - 140, h * 0.6);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillText(name, x + w / 2 - 50 + 2, y + h / 2 + 1);
      g.fillStyle = brand === '#f2b705' ? '#7a5a00' : brand;
      g.fillText(name, x + w / 2 - 50, y + h / 2 - 1);
      g.font = 'bold 13px Arial, sans-serif';
      g.fillStyle = '#333';
      g.fillText(tel, x + w - 66, y + h / 2);
    } else {
      // dark panel with yellow/white condensed caps and a coloured roundel
      g.fillStyle = '#1b1b1d';
      g.fillRect(x, y, w, h);
      g.fillStyle = brand;
      g.beginPath(); g.arc(x + 34, y + h / 2, 22, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff';
      g.font = 'bold 22px Arial';
      g.fillText(name[0], x + 34, y + h / 2 + 1);
      g.fillStyle = r() < 0.5 ? '#ffd23a' : '#ffffff';
      fit(g, name.toUpperCase(), 'bold', '"Arial Narrow", "Helvetica Neue", Arial, sans-serif', w - 90, h * 0.58);
      g.fillText(name.toUpperCase(), x + w / 2 + 24, y + h / 2 + 1);
    }
  }
  // Hand-painted names for colonial verandah fascias
  for (let i = 0; i < 16; i++) {
    const [x, y, w, h] = cellRect('fascia', 48 + i);
    const bg = OLD_BG[i % OLD_BG.length];
    g.fillStyle = bg;
    g.fillRect(x, y, w, h);
    const light = bg === '#f1ead6';
    g.strokeStyle = light ? '#6b2a26' : '#d9c48a';
    g.lineWidth = 2;
    g.strokeRect(x + 6, y + 6, w - 12, h - 12);
    g.fillStyle = light ? '#6b2a26' : '#efdfa8';
    fit(g, OLD_FIRMS[i].toUpperCase(), 'bold', 'Georgia, "Times New Roman", serif', w - 50, h * 0.5);
    g.fillText(OLD_FIRMS[i].toUpperCase(), x + w / 2, y + h / 2 + 1);
    // weathering: flaking paint
    for (let k = 0; k < 40; k++) {
      g.fillStyle = `rgba(${light ? '90,80,70' : '230,220,200'},${r() * 0.15})`;
      g.fillRect(x + r() * w, y + r() * h, 2 + r() * 10, 1 + r() * 3);
    }
  }
  // Rooftop billboards
  BILLBOARDS.forEach((b, i) => paintBillboard(g, ...cellRect('billboard', i), b));
  // Faded hand-painted wall adverts
  WALL_ADS.forEach((a, i) => paintWallAd(g, ...cellRect('wallad', i), a, r));
  // Tower-top company names: lit letters on a dark band
  CROWNS.forEach((n, i) => {
    const [x, y, w, h] = cellRect('crown', i);
    g.fillStyle = '#222326';
    g.fillRect(x, y, w, h);
    g.fillStyle = i % 3 === 0 ? '#ffd65a' : i % 3 === 1 ? '#ffffff' : '#ff5a4a';
    fit(g, n, 'bold', 'Arial, Helvetica, sans-serif', w - 24, h * 0.72);
    g.fillText(n, x + w / 2, y + h / 2 + 2);
  });
  return c;
}

// Builder: collects quads, then makes one mesh. glow 0 painted · 1 backlit
export function createSigns(renderer) {
  const pos = [], nrm = [], uv = [], glow = [];
  const counts = {};
  const pick = (kind, r) => Math.floor(r() * LAYOUT[kind][5]);
  function quad(kind, cell, x, y, z, nx, nz, w, h, gl) {
    // (x, y, z): bottom centre on the wall face; n: outward normal. Seen from the front, right = (nz, -nx).
    const rx = nz, rz = -nx;
    const [cx, cy, cw, ch] = cellRect(kind, cell);
    const u0 = (cx + 2) / W, u1 = (cx + cw - 2) / W, v0 = 1 - (cy + ch - 2) / H, v1 = 1 - (cy + 2) / H;
    const P = [
      [x - rx * w / 2, y, z - rz * w / 2, u0, v0],
      [x + rx * w / 2, y, z + rz * w / 2, u1, v0],
      [x + rx * w / 2, y + h, z + rz * w / 2, u1, v1],
      [x - rx * w / 2, y + h, z - rz * w / 2, u0, v1],
    ];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const p = P[k];
      pos.push(p[0], p[1], p[2]);
      nrm.push(nx, 0, nz);
      uv.push(p[3], p[4]);
      glow.push(gl);
    }
    counts[kind] = (counts[kind] || 0) + 1;
  }
  return {
    // Shop name on a canopy fascia; r: the building's random stream
    fascia(x, y, z, nx, nz, w, h, r) {
      const cell = pick('fascia', r) % 48;
      quad('fascia', cell, x, y, z, nx, nz, w, h, cell % 3 === 1 ? 0.15 : 1);
    },
    painted(x, y, z, nx, nz, w, h, r) {
      quad('fascia', 48 + Math.floor(r() * 16), x, y, z, nx, nz, w, h, 0);
    },
    billboard(x, y, z, nx, nz, w, h, r) {
      quad('billboard', pick('billboard', r), x, y, z, nx, nz, w, h, 1);
    },
    wallAd(x, y, z, nx, nz, w, h, r) {
      quad('wallad', pick('wallad', r), x, y, z, nx, nz, w, h, 0);
    },
    crown(x, y, z, nx, nz, w, h, r) {
      quad('crown', pick('crown', r), x, y, z, nx, nz, w, h, 1.2);
    },
    build(scene) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geo.setAttribute('aGlow', new THREE.Float32BufferAttribute(glow, 1));
      const tex = new THREE.CanvasTexture(drawAtlas());
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
      const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const uNight = { value: 0 };
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uNight = uNight;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;')
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vGlow;')
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * diffuseColor.rgb * vGlow * (uNight * 1.6 + 0.05);');
      };
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      scene.add(mesh);
      console.log(`[harare] signs: ${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}`);
      return { mesh, setNight: (v) => (uNight.value = v) };
    },
  };
}
