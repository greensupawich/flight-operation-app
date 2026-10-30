// =====================================================================
//  board-excel.js — Export กระดานจัดบินรายวัน (หน้าหลัก) เป็น Excel ตามฟอร์มเดิมของฝูง
//  • โหลดแม่แบบ assets/board-template.xlsx (สร้างด้วย scripts/build_board_template.py)
//    แล้วเติมข้อมูลตามตำแหน่งเซลล์ — ฟอนต์ / เส้นขอบ / การรวมเซลล์ / ตั้งค่าพิมพ์ มาจากแม่แบบ
//  • ผัง: แผงซ้าย A–E (หัว · สถานภาพเครื่อง แถว 4–31 · STBY 32–37 · น.จัดบิน 38–40)
//         การ์ดภารกิจ 6 ใบ (คอลัมน์เริ่ม F / M / T × แถวเริ่ม 1 / 21) ใบละ 7 คอลัมน์ × 20 แถว
//  • ไลบรารี ExcelJS โหลดเมื่อกดปุ่มเท่านั้น (pin เวอร์ชัน + SRI)
// =====================================================================
import { isStby } from "./missions.js";
import { orderMissions } from "./mission-sheet.js";

const EXCELJS_URL = new URL("../vendor/exceljs-4.4.0.min.js", import.meta.url).href;   // เก็บในระบบเอง (vendor/README.md)
const EXCELJS_SRI = "sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz";
const TEMPLATE_URL = "assets/board-template.xlsx";

const TH_MONTH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                  "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const TH_MON_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const TH_DOW = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
const shortTH = (d) => `${d.getDate()} ${TH_MON_SHORT[d.getMonth()]}${String(d.getFullYear() + 543).slice(-2)}`;

const CARD_ORIGINS = [[1, 6], [1, 13], [1, 20], [21, 6], [21, 13], [21, 20]];   // [แถว, คอลัมน์] มุมซ้ายบนของการ์ด
const CREW_ROWS = 8;                                                             // แถว 10–17 ของการ์ด
const BASE_ROLES = ["IP", "P", "CP", "N", "FM", "RO", "LM", "AH"];               // ป้ายมาตรฐานของกระดาน
const ROLE_ORDER = ["AC", "IP", "P", "CP", "N", "FM", "RO", "LM", "AH"];
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
const tail3 = (t) => clean(t).slice(-3);
function namesBy(crew, role) {
  return crew.filter((c) => clean(c.position).toUpperCase() === role)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    .map((c) => clean(c.crew_name)).filter(Boolean);
}

// ป้ายตำแหน่ง 8 แถว: มาตรฐาน IP…AH · มี AC → ใส่ AC บนสุด แทนตำแหน่งที่ว่าง (เหมือนกระดานจริง)
function crewLayout(crew) {
  const by = Object.fromEntries(ROLE_ORDER.map((r) => [r, namesBy(crew, r)]));
  let labels = [...BASE_ROLES];
  if (by.AC.length) {
    const drop = ["P", "N", "AH", "RO", "LM", "FM", "CP"].find((r) => !by[r].length) || "N";
    labels = ["AC", ...labels.filter((r) => r !== drop)];
    if (by[drop].length) by.AC = [...by.AC, ...by[drop].map((n) => `${drop}: ${n}`)];
  }
  return labels.slice(0, CREW_ROWS).map((r) => ({ role: r, names: by[r] }));
}

function fillCard(ws, [r0, c0], m) {
  const at = (r, c) => ws.getCell(r0 + r - 1, c0 + c - 1);    // r 1–20 · c 1–7 (1 = คอลัมน์ป้าย)
  const ac = m.aircraft;
  if (ac) { at(1, 2).value = `${clean(ac.type)}/ `; at(1, 4).value = tail3(ac.tail_number); }
  at(1, 6).value = clean(m.callsign) || null;                  // ป้าย "Callsign" · ค่าเต็ม เช่น CBY301
  at(2, 2).value = clean(m.showtime) || "-";
  at(2, 6).value = clean(m.brief_time) || "-";
  at(3, 2).value = clean(m.step_time) || "-";
  at(3, 4).value = clean(m.taxi_time) || "-";
  at(3, 6).value = clean(m.takeoff_time) || "-";
  at(4, 2).value = clean(m.fuel) || "-";
  at(4, 4).value = clean(m.catering) || "-";
  at(4, 7).value = clean(m.pax) || "-";
  // "(1) … / (2) …" → ขึ้นบรรทัดใหม่ต่อภารกิจย่อย (เซลล์ภารกิจสูง 2 แถว ตัดบรรทัดอัตโนมัติ)
  const name = clean(m.mission_name).replace(/\s*\/\s*(?=\(\d+\))/g, "\n");
  at(5, 2).value = (m.status === "cancelled" ? "(ยกเลิก) " : "") + name;
  at(7, 2).value = clean(m.route) || null;
  at(9, 2).value = clean(m.head_delegation) || null;
  crewLayout(m.mission_crew || []).forEach(({ role, names }, i) => {
    const r = 10 + i;
    at(r, 1).value = role;
    const slots = [names[0], names[1], names.slice(2).join(", ")];
    [2, 4, 6].forEach((c, k) => { at(r, c).value = slots[k] || null; });
  });
  at(18, 2).value = [clean(m.poc_name), clean(m.poc_phone)].filter(Boolean).join("  ") || null;
  at(19, 2).value = clean(m.remark) || null;
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
      D.value = b.chks[k] ? clean(b.chks[k].name) : null;
      E.value = b.chks[k] ? clean(b.chks[k].due_text) : null;
      const top = rr === first ? MED : undefined, bottom = rr === last ? MED : undefined;
      restyle(A, { fill: fill ? { type: "pattern", pattern: "solid", fgColor: { argb: fill } } : undefined,
                   alignment: { horizontal: "center", vertical: "middle" },
                   border: { left: MED, right: MED, top, bottom } });
      restyle(B, { font: { ...(B.style.font || {}), size: 20 },
                   alignment: { horizontal: "left", vertical: "middle", shrinkToFit: true },
                   border: { left: MED, top, bottom } });
      restyle(ws.getCell(rr, 3), { border: { right: MED, top, bottom } });
      restyle(D, { border: { left: MED, top, bottom } });
      restyle(E, { border: { right: MED, top, bottom } });
    }
    r = last + 1;
    if (r > PANEL_LAST) break;
  }
}

function fillStby(ws, stbys) {
  const m = stbys[0];
  if (!m) return;
  const type = clean(m.aircraft?.type) || "ATR72-500/600";
  const title = /^STBY/i.test(clean(m.mission_name)) ? clean(m.mission_name)       // ชื่อจากกระดาน เช่น "STBY ATR72-600"
    : m.kind === "stby_dechochai" ? `STBY เดโชชัย ${type}` : `STBY ${type}`;
  ws.getCell("A32").value = title;
  ws.getCell("C32").value = "Callsign";
  ws.getCell("D32").value = clean(m.callsign) || null;
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
    ws.getCell(r, 1).value = role;
    ws.getCell(r, 2).value = names[0] || null;
    ws.getCell(r, 3).value = names[1] || null;
    ws.getCell(r, 4).value = names.slice(2).join(", ") || null;
  });
}

const personLine = (note) => [clean(note?.duty_officer), clean(note?.duty_phone)].filter(Boolean).join(" ") || null;

/**
 * สร้างไฟล์ Excel กระดานของวันที่ `day` แล้วดาวน์โหลด
 * @returns {Promise<{file: string, skipped: number}>}  skipped = ภารกิจที่เกิน 6 ใบ (ไม่ได้ลงกระดาน)
 */
export async function exportBoardXlsx({ day, missions, aircraft, defMap, chkMap, noteToday, noteNext, stLabel }) {
  const ExcelJS = await loadExcelJS();
  const res = await fetch(TEMPLATE_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error("โหลดแม่แบบ Excel ไม่สำเร็จ");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await res.arrayBuffer());
  const ws = wb.worksheets[0];
  // ExcelJS เขียน <pageSetUpPr> ก่อน <outlinePr> (ผิด schema) → Excel ฟ้อง "XML error" · ไม่ใช้ outline อยู่แล้ว
  if (ws.properties) delete ws.properties.outlineProperties;
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);

  ws.name = shortTH(day);
  ws.getCell("A2").value = `วัน ${TH_DOW[day.getDay()]} ที่ ${day.getDate()} ${TH_MONTH[day.getMonth()]} พ.ศ.${day.getFullYear() + 543}`;

  const order = (a) => [clean(a.type), clean(a.tail_number)].join("|");    // -500 ก่อน -600 เหมือนกระดาน
  fillPanel(ws, [...aircraft].sort((a, b) => order(a).localeCompare(order(b))), defMap, chkMap, stLabel);
  fillStby(ws, missions.filter((m) => isStby(m.kind)));

  ws.getCell("A38").value = personLine(noteToday);
  ws.getCell("A39").value = `น.จัดบิน ภารกิจ วันที่ ${shortTH(next)}`;
  ws.getCell("A40").value = personLine(noteNext);

  // ป้ายการ์ดในแม่แบบเขียน "COWBOY" → เปลี่ยนเป็น "Callsign" ทุกการ์ด (รวมการ์ดที่ว่าง)
  CARD_ORIGINS.forEach(([r, c]) => { ws.getCell(r, c + 4).value = "Callsign"; });
  const cards = orderMissions(missions.filter((m) => !isStby(m.kind)));
  cards.slice(0, CARD_ORIGINS.length).forEach((m, i) => fillCard(ws, CARD_ORIGINS[i], m));

  wb.creator = wb.lastModifiedBy = "Flight Operation";
  const buf = await wb.xlsx.writeBuffer();
  const file = `จัดบิน ฝูง.603 ${shortTH(day)}.xlsx`;
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: file });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { file, skipped: Math.max(0, cards.length - CARD_ORIGINS.length) };
}
