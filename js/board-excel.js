// =====================================================================
//  board-excel.js — Export กระดานจัดบินรายวัน (หน้าหลัก) เป็น Excel ตามฟอร์มเดิมของฝูง
//  • โหลดแม่แบบ assets/board-template.xlsx (สร้างด้วย scripts/build_board_template.py)
//    แล้วเติมข้อมูลตามตำแหน่งเซลล์ — ฟอนต์ / เส้นขอบ / การรวมเซลล์ / ตั้งค่าพิมพ์ มาจากแม่แบบ
//  • ผัง: แผงซ้าย A–E (หัว · สถานภาพเครื่อง แถว 4–31 · STBY 32–37 · น.จัดบิน 38–40)
//         การ์ดภารกิจ 6 ใบ (คอลัมน์เริ่ม F / M / T × แถวเริ่ม 1 / 21) ใบละ 7 คอลัมน์ × 20 แถว
//  • ไลบรารี ExcelJS โหลดเมื่อกดปุ่มเท่านั้น (pin เวอร์ชัน + SRI)
// =====================================================================
import { orderMissions, hidePilotRow } from "./mission-sheet.js";
import { pocLines, missionNameLines, stbyLabel } from "./missions.js";

const EXCELJS_URL = new URL("../vendor/exceljs-4.4.0.min.js", import.meta.url).href;   // เก็บในระบบเอง (vendor/README.md)
const EXCELJS_SRI = "sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz";
const TEMPLATE_URL = "assets/board-template.xlsx";

const TH_MONTH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const TH_MON_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const TH_DOW = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
const shortTH = (d) => `${d.getDate()} ${TH_MON_SHORT[d.getMonth()]}${String(d.getFullYear() + 543).slice(-2)}`;

const CARD_ORIGINS = [[1, 6], [1, 13], [1, 20], [21, 6], [21, 13], [21, 20]];   // [แถว, คอลัมน์] มุมซ้ายบนของการ์ด
const CREW_ROWS = 8;                                                             // แถว 9–16 ของการ์ด (หลังตัดแถวระยะทาง)
const BASE_ROLES = ["IP", "P", "CP", "N", "FM", "RO", "LM", "AH"];               // ป้ายมาตรฐานของกระดาน
const ROLE_ORDER = ["ผอ.เดินทาง", "AC", "IP", "P", "CP", "นบ.ราชฯ 1", "นบ.ราชฯ 2", "ตห.", "N", "FM", "RO", "LM", "AH"];
const EXTRA_ROLES = ["ผอ.เดินทาง", "AC", "ตห."];                                    // มีคนเมื่อไรจึงขึ้นแถว
const ONE_PER_ROW = ["นบ.ราชฯ 1", "นบ.ราชฯ 2"];                                   // 1 คน = 1 แถว (เหมือนกระดานจริง)
const PANEL_FIRST = 4, PANEL_LAST = 31;                                          // แผงสถานภาพเครื่อง
const STATUS_FILL = { FMC: "FF00B050", PMC: "FFFFFF00", NMC: "FFFF0000" };
const MED = { style: "medium" };

let libPromise;
export function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  libPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = EXCELJS_URL; s.integrity = EXCELJS_SRI; s.crossOrigin = "anonymous";
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => { libPromise = null; reject(new Error("โหลดไลบรารี Excel ไม่สำเร็จ (ตรวจอินเทอร์เน็ต)")); };
    document.head.appendChild(s);
  });
  return libPromise;
}

const clean = (s) => String(s ?? "").trim();
// ความกว้างข้อความไทยโดยประมาณ (สระบน/ล่าง วรรณยุกต์ ไม่กินที่) · ช่องหมายเหตุ (G:J, TH SarabunPSK 26) ≈ 34 ตัวอักษร/บรรทัด
const thWidth = (s) => String(s).replace(/[\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/g, "").length;
const REMARK_CHARS = 34;
const tail3 = (t) => clean(t).slice(-3);
function namesBy(crew, role) {
  return crew.filter((c) => clean(c.position).toUpperCase() === role)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((c) => clean(c.crew_name)).filter(Boolean);
}

// ป้ายตำแหน่ง 8 แถว: มาตรฐาน IP…AH · ตำแหน่งพิเศษ (ผอ.เดินทาง / AC / นบ.ราชฯ / ตห.) ที่มีคน → แทรกตามลำดับ ROLE_ORDER
//  แทนแถวมาตรฐานที่ว่าง (เหมือนกระดานจริง) · ยังไม่พอ → รวมชื่อที่เกินไว้แถวสุดท้ายแบบ "ตำแหน่ง: ชื่อ"
function crewLayout(crew) {
  const by = Object.fromEntries(ROLE_ORDER.map((r) => [r, namesBy(crew, r)]));
  let rows = ROLE_ORDER.flatMap((r) => {
    if (!by[r].length && hidePilotRow(r, crew)) return [];       // มี นบ.ราชฯ → ตัดแถว IP/P/CP ที่ว่าง (เหมือนหน้าเว็บ)
    if (ONE_PER_ROW.includes(r)) return by[r].map((n) => ({ role: r, names: [n] }));
    return BASE_ROLES.includes(r) || (EXTRA_ROLES.includes(r) && by[r].length) ? [{ role: r, names: by[r] }] : [];
  });
  for (const drop of ["P", "N", "AH", "RO", "LM", "FM", "CP", "IP"]) {
    if (rows.length <= CREW_ROWS) break;
    if (!by[drop].length) rows = rows.filter((x) => x.role !== drop);
  }
  if (rows.length > CREW_ROWS) {
    const keep = rows.slice(0, CREW_ROWS), last = keep[CREW_ROWS - 1];
    last.names = [...last.names, ...rows.slice(CREW_ROWS).flatMap((x) => x.names.map((n) => `${x.role}: ${n}`))];
    rows = keep;
  }
  while (rows.length < CREW_ROWS) rows.push({ role: null, names: [] });   // แถวที่เหลือ → ว่าง (ไม่ให้ป้ายในแม่แบบค้าง)
  return rows;
}

// แม่แบบการ์ดมีแถว ระยะทาง/เวลา/ความสูง (แถว 8) — ไม่ใช้ (ผู้ใช้ขอเอาออก 30 ต.ค. 69)
//  → เลื่อนแถว 9–18 ขึ้น 1 แถว (ค่า + style + merge) · POC คณะได้ 2 แถว (17–18) ไว้แยกบรรทัดตามภารกิจ
//  ไม่ลบแถวทั้งแผ่น เพราะคอลัมน์ A–E (สถานภาพเครื่อง / STBY) ใช้แถวเดียวกัน
function dropDistanceRow(ws, [r0, c0]) {
  const addr = (r, c) => ws.getCell(r0 + r - 1, c0 + c - 1).address;
  const rng = (r1, c1, r2, c2) => `${addr(r1, c1)}:${addr(r2, c2)}`;
  const PAIRS = [[2, 3], [4, 5], [6, 7]];
  ws.unMergeCells(rng(8, 4, 8, 5));
  ws.unMergeCells(rng(9, 2, 9, 7));
  for (let r = 10; r <= 17; r++) PAIRS.forEach(([a, b]) => ws.unMergeCells(rng(r, a, r, b)));
  ws.unMergeCells(rng(18, 2, 18, 7));
  for (let r = 8; r <= 17; r++) {                               // แถว 18 คงเดิม (เป็นแถว POC อยู่แล้ว)
    for (let c = 1; c <= 7; c++) {
      const src = ws.getCell(addr(r + 1, c)), dst = ws.getCell(addr(r, c));
      dst.value = src.value;
      dst.style = JSON.parse(JSON.stringify(src.style || {}));
    }
  }
  ws.mergeCells(rng(8, 2, 8, 7));
  for (let r = 9; r <= 16; r++) PAIRS.forEach(([a, b]) => ws.mergeCells(rng(r, a, r, b)));
  ws.mergeCells(rng(17, 1, 18, 1));
  ws.mergeCells(rng(17, 2, 18, 7));
  const poc = ws.getCell(addr(17, 2));
  poc.alignment = { ...poc.alignment, wrapText: true, vertical: "middle" };
}

// draft = ไม่ใส่ชื่อลูกเรือและ callsign (ผู้ใช้ขอ 13 พ.ย. 69) · ป้ายตำแหน่งยังแสดงตามจริง เพื่อให้เห็นว่าใช้ตำแหน่งอะไรบ้าง
function fillCard(ws, [r0, c0], m, draft = false) {
  const at = (r, c) => ws.getCell(r0 + r - 1, c0 + c - 1);    // r 1–20 · c 1–7 (1 = คอลัมน์ป้าย)
  const ac = m.aircraft;
  if (ac) { at(1, 2).value = `${clean(ac.type)}/ `; at(1, 4).value = tail3(ac.tail_number); }
  at(1, 6).value = draft ? null : clean(m.callsign) || null;   // ป้าย "Callsign" · ค่าเต็ม เช่น CBY301
  at(2, 2).value = clean(m.showtime) || "-";
  at(2, 6).value = clean(m.brief_time) || "-";
  at(3, 2).value = clean(m.step_time) || "-";
  at(3, 4).value = clean(m.taxi_time) || "-";
  at(3, 6).value = clean(m.takeoff_time) || "-";
  at(4, 2).value = clean(m.fuel) || "-";
  at(4, 4).value = clean(m.catering) || "-";
  at(4, 7).value = clean(m.pax) || "-";
  // "(1) … / (2) …" → ขึ้นบรรทัดใหม่ต่อภารกิจย่อย (เซลล์ภารกิจสูง 2 แถว ตัดบรรทัดอัตโนมัติ)
  const name = missionNameLines(m).join("\n");
  at(5, 2).value = (m.status === "cancelled" ? "(ยกเลิก) " : "") + name;
  at(7, 2).value = clean(m.route) || null;
  at(8, 2).value = clean(m.head_delegation) || null;
  // ผอ.เดินทาง (missions.travel_director) → แถวบนสุดของรายชื่อในการ์ด เหมือนกระดานจริง
  const crewRows = clean(m.travel_director)
    ? [{ position: "ผอ.เดินทาง", crew_name: clean(m.travel_director), sort_order: -1 }, ...(m.mission_crew || [])]
    : (m.mission_crew || []);
  const rng = (r1, c1, r2, c2) => `${at(r1, c1).address}:${at(r2, c2).address}`;
  crewLayout(crewRows).forEach(({ role, names }, i) => {
    const r = 9 + i;
    if (draft && role !== "ผอ.เดินทาง") names = [];              // ผอ.เดินทาง ไม่ใช่ลูกเรือ → คงไว้
    at(r, 1).value = role;
    if (role === "ผอ.เดินทาง" || role === "AC") {            // ชื่อ + เบอร์ยาว → ใช้เต็มแถว
      [[2, 3], [4, 5], [6, 7]].forEach(([a, b]) => ws.unMergeCells(rng(r, a, r, b)));
      ws.mergeCells(rng(r, 2, r, 7));
      at(r, 2).value = names.join("  ·  ") || null;
      return;
    }
    const slots = [names[0], names[1], names.slice(2).join(", ")];
    [2, 4, 6].forEach((c, k) => { at(r, c).value = slots[k] || null; });
  });
  // POC หลายคณะ → บรรทัดละคน (pocLines) · เกิน 2 บรรทัด → ย่อตัวอักษรให้พอ 2 แถว
  const poc = pocLines(m).map(clean).filter(Boolean);
  const pc = at(17, 2);
  pc.value = poc.join("\n") || null;
  const doc = clean(m.doc_officer);
  if (doc) {
    // มี น.เอกสาร (migration_49) → POCคณะ 1 แถว (17) + น.เอกสาร (18) เหมือนกระดานจริง · POC หลายคณะ → เพิ่มความสูงแถว 17
    ws.unMergeCells(rng(17, 1, 18, 1)); ws.unMergeCells(rng(17, 2, 18, 7));
    for (let c = 1; c <= 7; c++) at(18, c).style = JSON.parse(JSON.stringify(at(17, c).style || {}));   // แถว 18 ใช้ style เดียวกับแถว POC
    ws.mergeCells(rng(17, 2, 17, 7)); ws.mergeCells(rng(18, 2, 18, 7));
    at(18, 1).value = "น.เอกสาร";
    at(18, 2).value = doc;
    const row = ws.getRow(r0 + 16), need = poc.length * 33 + 4;
    if (poc.length > 1 && (row.height || 35) < need) row.height = need;
  } else if (poc.length > 2) pc.font = { ...pc.font, size: Math.max(14, Math.floor((pc.font?.size || 26) * 2.5 / poc.length)) };
  // หมายเหตุ: "/" = ขึ้นบรรทัดใหม่ · บรรทัดแรกลงแถว 19 ที่เหลือลงแถว 20 · ยาวเกินช่อง → ตัดบรรทัด + เพิ่มความสูงแถว
  const rem = clean(m.remark).split(/\s*\/\s*/).filter(Boolean);
  [[19, rem.slice(0, 1)], [20, rem.slice(1)]].forEach(([r, lines]) => {
    if (!lines.length) return;
    const cell = at(r, 2);
    cell.value = lines.join("\n");
    cell.alignment = { ...cell.alignment, wrapText: true, vertical: "middle" };
    const vis = lines.reduce((n, t) => n + Math.max(1, Math.ceil(thWidth(t) / REMARK_CHARS)), 0);
    const row = ws.getRow(r0 + r - 1), need = vis * 33 + 4;
    if (vis > 1 && (row.height || 35) < need) row.height = need;   // แถวเดียวกันของ 3 การ์ด → ใช้ค่าสูงสุด
  });
  at(19, 7).value = clean(m.parking_out) || null;
  at(20, 7).value = clean(m.parking_in) || null;
}

// ExcelJS: เซลล์ที่โหลดจากแม่แบบใช้ style object ร่วมกัน — แก้ fill/border ตรง ๆ จะเปลี่ยนทุกเซลล์ที่ใช้ style เดียวกัน
//  → สร้าง style ใหม่ต่อเซลล์ทุกครั้ง
function restyle(cell, patch) {
  cell.style = { ...cell.style, ...patch };
}

// ---------- แผงสถานภาพเครื่อง: แต่ละลำ = 1 บล็อก (ความสูงตามข้อขัดข้อง/รายการเช็ค) ----------
function fillPanel(ws, aircraft, defMap, chkMap, stLabel) {
  const total = PANEL_LAST - PANEL_FIRST + 1;
  const blocks = aircraft.map((a) => ({
    a, defs: (defMap.get(a.id) || []).map(clean).filter(Boolean),
    chks: chkMap.get(a.id) || [],
  }));
  blocks.forEach((b) => { b.h = Math.max(3, b.defs.length, b.chks.length); });
  // พื้นที่เกิน 28 แถว → ลดบล็อกที่ยาวสุด (ข้อขัดข้องที่ล้นรวมไว้บรรทัดสุดท้าย)
  while (blocks.reduce((s, b) => s + b.h, 0) > total) {
    const big = blocks.reduce((x, y) => (y.h > x.h ? y : x));
    if (big.h <= 3) break;
    big.h -= 1;
  }
  // ที่เหลือ → เกลี่ยให้บล็อกจากบนลงล่าง
  let spare = total - blocks.reduce((s, b) => s + b.h, 0);
  for (let i = 0; spare > 0 && blocks.length; i = (i + 1) % blocks.length, spare--) blocks[i].h += 1;

  let r = PANEL_FIRST;
  for (const b of blocks) {
    const first = r, last = Math.min(r + b.h - 1, PANEL_LAST);
    const st = stLabel(b.a);
    const fill = STATUS_FILL[b.a.status];
    const lines = b.defs.map((d, i) => `${i + 1}. ${d}`);
    const n = last - first + 1;
    if (lines.length > n) lines.splice(n - 1, lines.length, lines.slice(n - 1).join("  "));
    for (let rr = first; rr <= last; rr++) {
      const k = rr - first;
      const A = ws.getCell(rr, 1), B = ws.getCell(rr, 2), D = ws.getCell(rr, 4), E = ws.getCell(rr, 5);
      A.value = k === 0 ? tail3(b.a.tail_number) : k === 1 ? st : null;
      B.value = lines[k] || null;
      // ช่องที่ไม่มีข้อมูลต้องว่างจริง (null) — ถ้าเขียน "" Excel ถือว่ามีข้อมูล ข้อความยาวช่องข้างๆ (เช่น HANGAR QUEEN) จะล้นมาแสดงไม่ได้
      D.value = (b.chks[k] && clean(b.chks[k].name)) || null;
      E.value = (b.chks[k] && clean(b.chks[k].due_text)) || null;
      const top = rr === first ? MED : undefined, bottom = rr === last ? MED : undefined;
      restyle(A, { fill: fill ? { type: "pattern", pattern: "solid", fgColor: { argb: fill } } : undefined,
                   alignment: { horizontal: "center", vertical: "middle" },
                   border: { left: MED, right: MED, top, bottom } });
      restyle(B, { font: { ...(B.style.font || {}), size: 20 },
                   alignment: { horizontal: "left", vertical: "middle", shrinkToFit: true },
                   border: { left: MED, top, bottom } });
      restyle(ws.getCell(rr, 3), { border: { right: MED, top, bottom } });
      // มีแค่ชื่อรายการ ไม่มีกำหนด (เช่น HANGAR QUEEN) → รวมช่อง D:E ให้ข้อความแสดงเต็ม
      const wide = !!D.value && !E.value;
      if (wide) ws.mergeCells(rr, 4, rr, 5);
      restyle(D, { border: { left: MED, top, bottom, ...(wide ? { right: MED } : {}) } });
      restyle(E, { border: { right: MED, top, bottom } });
    }
    r = last + 1;
    if (r > PANEL_LAST) break;
  }
}

// แถว STBY = เฉพาะชนิด "stby" อันสุดท้าย (สร้างล่าสุด) — STBY เดโชชัย / STBY (ภารกิจ) ลงเป็นการ์ดเหมือนภารกิจปกติ
function fillStby(ws, stbys, draft = false) {
  const m = stbys[stbys.length - 1];
  if (!m) return;
  const title = `STBY ${clean(stbyLabel(m))}`;          // ป้ายเดียวกับช่อง STBY หน้าหลัก (ชื่อภารกิจที่กรอก · 11 พ.ย. 69)
  ws.getCell("A32").value = title;
  ws.getCell("A32").alignment = { ...ws.getCell("A32").alignment, shrinkToFit: true };   // ชื่อยาว → ย่อให้พอดี A32:B32
  ws.getCell("C32").value = "Callsign";
  ws.getCell("D32").value = draft ? null : clean(m.callsign) || null;
  const rows = ROLE_ORDER.map((role) => ({ role, names: namesBy(m.mission_crew || [], role) }))
    .filter((x) => x.names.length);
  // 5 แถว (33–37) · ตำแหน่งเกิน → รวมไว้แถวสุดท้าย
  const shown = rows.slice(0, 5);
  if (rows.length > 5) {
    shown[4] = { role: shown[4].role, names: [...shown[4].names,
      ...rows.slice(5).map((x) => `${x.role}: ${x.names.join(", ")}`)] };
  }
  shown.forEach(({ role, names }, i) => {
    const r = 33 + i;
    if (draft) names = [];
    ws.getCell(r, 1).value = role;
    ws.getCell(r, 2).value = names[0] || null;
    ws.getCell(r, 3).value = names[1] || null;
    ws.getCell(r, 4).value = names.slice(2).join(", ") || null;
  });
}

const personLine = (note) => [clean(note?.duty_officer), clean(note?.duty_phone)].filter(Boolean).join(" ") || null;

// เติมกระดานของ 1 วันลงชีต (ชีตจากแม่แบบ) · คืนจำนวนภารกิจที่เกิน 6 การ์ด
function fillBoard(ws, { day, missions, aircraft, defMap, chkMap, noteToday, noteNext }, stLabel, draft) {
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  ws.getCell("A2").value = `วัน ${TH_DOW[day.getDay()]} ที่ ${day.getDate()} ${TH_MONTH[day.getMonth()]} พ.ศ.${day.getFullYear() + 543}`;

  const order = (a) => [clean(a.type), clean(a.tail_number)].join("|");    // -500 ก่อน -600 เหมือนกระดาน
  fillPanel(ws, [...aircraft].sort((a, b) => order(a).localeCompare(order(b))), defMap, chkMap, stLabel);
  fillStby(ws, missions.filter((m) => m.kind === "stby"), draft);

  ws.getCell("A38").value = personLine(noteToday);
  ws.getCell("A39").value = `น.จัดบิน ภารกิจ วันที่ ${shortTH(next)}`;
  ws.getCell("A40").value = personLine(noteNext);

  // ป้ายการ์ดในแม่แบบเขียน "COWBOY" → เปลี่ยนเป็น "Callsign" ทุกการ์ด (รวมการ์ดที่ว่าง)
  CARD_ORIGINS.forEach(([r, c]) => { ws.getCell(r, c + 4).value = "Callsign"; dropDistanceRow(ws, [r, c]); });
  const cards = orderMissions(missions.filter((m) => m.kind !== "stby"));
  cards.slice(0, CARD_ORIGINS.length).forEach((m, i) => fillCard(ws, CARD_ORIGINS[i], m, draft));
  return Math.max(0, cards.length - CARD_ORIGINS.length);
}

/**
 * สร้างไฟล์ Excel กระดาน 1 วัน = 1 ชีต (หลายวันในไฟล์เดียว) แล้วดาวน์โหลด
 * @param days   [{ day: Date, missions, aircraft, defMap, chkMap, noteToday, noteNext }, ...] เรียงตามวัน
 * @param draft  true = ไม่มีชื่อลูกเรือ / callsign
 * @returns {Promise<{file: string, skipped: {day: Date, n: number}[]}>}  skipped = วันที่มีภารกิจเกิน 6 การ์ด
 */
export async function exportBoardXlsx({ days, stLabel, draft = false }) {
  if (!days?.length) throw new Error("ยังไม่ได้เลือกวัน");
  const ExcelJS = await loadExcelJS();
  const res = await fetch(TEMPLATE_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error("โหลดแม่แบบ Excel ไม่สำเร็จ");
  const tpl = await res.arrayBuffer();
  const openTemplate = async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl);
    const ws = wb.worksheets[0];
    // ExcelJS เขียน <pageSetUpPr> ก่อน <outlinePr> (ผิด schema) → Excel ฟ้อง "XML error" · ไม่ใช้ outline อยู่แล้ว
    if (ws.properties) delete ws.properties.outlineProperties;
    return { wb, ws };
  };

  // ชีตแรกเติมในสมุดแม่แบบเลย · วันถัดไปโหลดแม่แบบใหม่ เติม แล้วคัดลอกชีต (model) มาต่อท้าย — ExcelJS ไม่มีคำสั่งคัดลอกชีต
  //  model ที่อ่านออกมาเก็บ merge ไว้ใน "merges" แต่ตอนตั้งค่าอ่านจาก "mergeCells"
  const { wb, ws: first } = await openTemplate();
  const skipped = [], used = new Set();
  for (const [i, d] of days.entries()) {
    const ws = i ? (await openTemplate()).ws : first;
    let name = shortTH(d.day);
    for (let k = 2; used.has(name); k++) name = `${shortTH(d.day)} (${k})`;
    used.add(name);
    ws.name = name;
    const n = fillBoard(ws, d, stLabel, draft);
    if (n) skipped.push({ day: d.day, n });
    if (i) {
      const m = ws.model;
      const dst = wb.addWorksheet(name);
      dst.model = { ...m, name, mergeCells: m.merges };
      // ตอนตั้ง merge ExcelJS เขียน style ของเซลล์มุมซ้ายบนทับเซลล์อื่นในช่วงที่รวม → เส้นขอบด้านใน/ขวา/ล่างของช่องรวมหาย (เส้นขาด)
      //  → คืน style เดิมให้ทุกเซลล์จากชีตต้นทาง
      ws.eachRow({ includeEmpty: true }, (row, r) => row.eachCell({ includeEmpty: true }, (cell, c) => {
        dst.getCell(r, c).style = JSON.parse(JSON.stringify(cell.style || {}));
      }));
    }
  }

  wb.creator = wb.lastModifiedBy = "Flight Operation";
  const buf = await wb.xlsx.writeBuffer();
  const a0 = days[0].day, a1 = days[days.length - 1].day;
  const span = days.length > 1 ? `${shortTH(a0)} - ${shortTH(a1)}` : shortTH(a0);
  const file = `${draft ? "DRAFT " : ""}จัดบิน ฝูง.603 ${span}.xlsx`;
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: file });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { file, skipped };
}

// =====================================================================
//  Show Draft (ผู้ใช้ขอ 20 พ.ย. 69) — แสดงใบจัดบินเป็นภาพบนหน้าจอ (ไว้แคปส่งรูป) โดยใช้แม่แบบ Excel ชุดเดียวกับ Export
//  เติมข้อมูลด้วย fillBoard(draft) แล้วแปลงชีต (พื้นที่พิมพ์ A1:Z42) เป็นตาราง HTML:
//  ความกว้างคอลัมน์ / ความสูงแถว / การรวมเซลล์ / ฟอนต์ / สีพื้น / เส้นขอบ / การจัดวาง ตามแม่แบบ
// =====================================================================
const SHEET_ROWS = 42, SHEET_COLS = 26;
// TH SarabunPSK ไม่มีบนเว็บ → ใช้ Sarabun (Google Fonts · ออกแบบจากตัวเดียวกัน แต่ตัวใหญ่กว่า) ย่อขนาดให้เท่า PSK
const SARABUN_SCALE = 0.68;   // วัดจากความกว้างข้อความ TH SarabunPSK ÷ Sarabun ขนาดเดียวกัน ≈ 0.67
const XL_THEME = ["FFFFFF", "000000", "E7E6E6", "44546A", "4472C4", "ED7D31", "A5A5A5", "FFC000", "5B9BD5", "70AD47"];
const BORDER_CSS = { thin: "1px solid", hair: "1px solid", medium: "2px solid", thick: "3px solid", double: "3px double",
  dashed: "1px dashed", dotted: "1px dotted", mediumDashed: "2px dashed", dashDot: "1px dashed", mediumDashDot: "2px dashed",
  dashDotDot: "1px dotted", mediumDashDotDot: "2px dotted", slantDashDot: "2px dashed" };
let tplPromise;
const loadTemplate = () => (tplPromise ||= fetch(TEMPLATE_URL, { cache: "no-cache" })
  .then((r) => { if (!r.ok) throw new Error("โหลดแม่แบบ Excel ไม่สำเร็จ"); return r.arrayBuffer(); })
  .catch((e) => { tplPromise = null; throw e; }));
const escH = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function xlColor(c) {
  if (!c) return null;
  if (c.argb) return "#" + c.argb.slice(-6);
  if (c.theme == null || !XL_THEME[c.theme]) return null;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(XL_THEME[c.theme].slice(i, i + 2), 16));
  const t = c.tint || 0;                                         // tint > 0 = จางลง · < 0 = เข้มขึ้น
  [r, g, b] = [r, g, b].map((v) => Math.round(t > 0 ? v + (255 - v) * t : v * (1 + t)));
  return `rgb(${r},${g},${b})`;
}
function fontCss(f) {
  if (!f) return "";
  const out = [];
  const name = f.name || "Calibri";
  const psk = /sarabun/i.test(name);
  if (f.size) out.push(`font-size:${((f.size * 4) / 3 * (psk ? SARABUN_SCALE : 1)).toFixed(1)}px`);
  // ใช้ ' ใน font-family — ค่า style อยู่ใน attribute style="…"
  out.push(`font-family:${psk ? `'Sarabun','TH SarabunPSK',sans-serif` : `'${name.replace(/['"<>&]/g, "")}',Calibri,Arial,sans-serif`}`);
  if (f.bold) out.push("font-weight:700");
  if (f.italic) out.push("font-style:italic");
  if (f.underline) out.push("text-decoration:underline");
  const col = xlColor(f.color); if (col) out.push(`color:${col}`);
  return out.join(";");
}
function valueHtml(v) {
  if (v == null) return "";
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((r) => `<span style="${fontCss(r.font)}">${escH(r.text)}</span>`).join("");
    if ("result" in v) return valueHtml(v.result);
    if (v instanceof Date) return escH(v.toLocaleDateString("th-TH"));
    if (v.text) return escH(v.text);
    return "";
  }
  return escH(v);
}

// ชีต → <table> · คืน { html, width, height } (px ตามขนาดจริงของชีต)
function sheetHtml(ws) {
  const colPx = [], rowPx = [];
  for (let c = 1; c <= SHEET_COLS; c++) {
    const col = ws.getColumn(c);
    colPx.push(col.hidden ? 0 : Math.round((col.width ?? 8.43) * 7 + 5));   // ความกว้างตัวอักษร Excel → px (Calibri 11)
  }
  for (let r = 1; r <= SHEET_ROWS; r++) {
    const row = ws.getRow(r);
    rowPx.push(row.hidden ? 0 : Math.round(((row.height ?? 15) * 4) / 3));
  }
  // ช่องรวม: มุมซ้ายบน → ขนาด · เซลล์อื่นในช่วง → ข้าม
  const span = new Map(), covered = new Set();
  for (const ref of ws.model.merges || []) {
    const [a, b] = ref.split(":").map((x) => ws.getCell(x));
    if (a.row > SHEET_ROWS || a.col > SHEET_COLS) continue;
    const r2 = Math.min(b.row, SHEET_ROWS), c2 = Math.min(b.col, SHEET_COLS);
    span.set(`${a.row},${a.col}`, [r2 - a.row + 1, c2 - a.col + 1]);
    for (let r = a.row; r <= r2; r++) for (let c = a.col; c <= c2; c++) if (r !== a.row || c !== a.col) covered.add(`${r},${c}`);
  }
  const bd = (b) => (b && b.style ? `${BORDER_CSS[b.style] || "1px solid"} ${xlColor(b.color) || "#000"}` : null);
  let html = `<table class="xls" style="width:${colPx.reduce((s, w) => s + w, 0)}px"><colgroup>${colPx.map((w) => `<col style="width:${w}px">`).join("")}</colgroup><tbody>`;
  for (let r = 1; r <= SHEET_ROWS; r++) {
    html += `<tr style="height:${rowPx[r - 1]}px">`;
    for (let c = 1; c <= SHEET_COLS; c++) {
      const key = `${r},${c}`;
      if (covered.has(key)) continue;
      const cell = ws.getCell(r, c), st = cell.style || {}, [rs, cs] = span.get(key) || [1, 1];
      // เส้นขอบช่องรวม: บน/ซ้าย จากมุมซ้ายบน · ขวา จากเซลล์ขวาสุด · ล่าง จากเซลล์ล่างสุด
      const B = st.border || {};
      const right = rs > 1 || cs > 1 ? ws.getCell(r, c + cs - 1).style?.border?.right || B.right : B.right;
      const bottom = rs > 1 || cs > 1 ? ws.getCell(r + rs - 1, c).style?.border?.bottom || B.bottom : B.bottom;
      const css = [];
      [["top", B.top], ["left", B.left], ["right", right], ["bottom", bottom]].forEach(([k, b]) => { const v = bd(b); if (v) css.push(`border-${k}:${v}`); });
      const fill = st.fill?.type === "pattern" && st.fill.pattern !== "none" ? xlColor(st.fill.fgColor) : null;
      if (fill) css.push(`background:${fill}`);
      const al = st.alignment || {};
      const isNum = typeof cell.value === "number";
      const h = al.horizontal === "centerContinuous" ? "center" : al.horizontal && al.horizontal !== "general" ? al.horizontal : isNum ? "right" : "left";
      css.push(`text-align:${h === "distributed" || h === "justify" ? "justify" : h === "fill" ? "left" : h}`);
      css.push(`vertical-align:${al.vertical === "middle" ? "middle" : al.vertical === "top" ? "top" : "bottom"}`);
      css.push(al.wrapText ? "white-space:pre-wrap" : "white-space:pre");
      if (al.indent) css.push(`padding-left:${al.indent * 9 + 2}px`);
      const inner = valueHtml(cell.value);
      // ล้นช่อง: Excel ให้ข้อความยาวล้นไปช่องข้างที่ว่าง · ช่องข้างมีข้อมูล → ตัด
      const filled = (cc) => cc >= 1 && cc <= SHEET_COLS && !covered.has(`${r},${cc}`) && ws.getCell(r, cc).value != null && ws.getCell(r, cc).value !== "";
      if (!al.wrapText && inner && (filled(c + cs) || ((h === "center" || h === "right") && filled(c - 1)))) css.push("overflow:hidden");
      // ข้อความไม่ตัดบรรทัด + ช่องข้างว่าง → ล้นไปช่องข้างเหมือน Excel · shrinkToFit → ย่อด้วย JS หลังแสดง
      const shrink = al.shrinkToFit && !al.wrapText;
      html += `<td${rs > 1 ? ` rowspan="${rs}"` : ""}${cs > 1 ? ` colspan="${cs}"` : ""} style="${fontCss(st.font)};${css.join(";")}">`
        + (inner ? `<div class="v${shrink ? " shrink" : ""}${!al.wrapText && h === "center" ? " c" : ""}">${inner}</div>` : "") + `</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody></table>";
  return { html, width: colPx.reduce((s, w) => s + w, 0), height: rowPx.reduce((s, h) => s + h, 0) };
}

/**
 * ใบจัดบิน 1 วัน (แบบ Draft — ไม่มีชื่อลูกเรือ / callsign) เป็น HTML สำหรับแสดงบนจอ
 * @param data  ข้อมูลวันเดียวกับ exportBoardXlsx ({ day, missions, aircraft, defMap, chkMap, noteToday, noteNext })
 * @returns {Promise<{html: string, width: number, height: number, skipped: number}>}
 */
export async function renderBoardHtml(data, stLabel, draft = true) {
  const ExcelJS = await loadExcelJS();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await loadTemplate());
  const ws = wb.worksheets[0];
  const skipped = fillBoard(ws, data, stLabel, draft);
  return { ...sheetHtml(ws), skipped };
}

// ย่อข้อความในเซลล์ shrinkToFit ให้พอดีช่อง (เรียกหลังใส่ HTML ลงหน้าแล้ว)
export function fitShrinkCells(root) {
  root.querySelectorAll(".xls .v.shrink").forEach((v) => {
    const td = v.parentElement, avail = td.clientWidth - 4;
    if (v.scrollWidth > avail && avail > 0) v.style.fontSize = `${(parseFloat(getComputedStyle(td).fontSize) * avail / v.scrollWidth).toFixed(1)}px`;
  });
}

// CSS ของตาราง (ใส่ครั้งเดียวในหน้า) — ตัวแปลงใช้ inline style ต่อเซลล์ ที่เหลือคือค่าพื้นฐานแบบ Excel
export const BOARD_HTML_CSS = `
.xls{border-collapse:collapse;table-layout:fixed;background:#fff;color:#000;font-family:Calibri,Arial,sans-serif;font-size:14.7px;line-height:1.15}
.xls td{padding:0 2px;overflow:visible;box-sizing:border-box}
.xls .v{display:block}
.xls .v.c{width:max-content;min-width:100%;position:relative;left:50%;transform:translateX(-50%)}
.xls td[style*="overflow:hidden"] .v.c{width:auto;left:0;transform:none}
.xls .v.shrink{white-space:nowrap}`;
