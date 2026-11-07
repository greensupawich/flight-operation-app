// =====================================================================
//  status-pdf.js — อ่าน "รายงานสภาพ บ. ประจำวัน" (แบบพิมพ์ ทอ.36) จากภาพสแกน → ข้อมูลรายเครื่อง
//  ใช้ร่วมกันได้ทั้งในเบราว์เซอร์ (status-import.html) และใน Node (ทดสอบ) — ไม่มีการเรียกฐานข้อมูล
//
//  ขั้นตอน:
//   1) OCR ทั้งหน้า (tha+eng) → words [{t,x0,y0,x1,y1}] — ใช้หา "ตำแหน่ง" แถว/คอลัมน์/บรรทัด
//   2) analyzeLayout(): หาแถวเครื่องจากเลข (313) (315) … · หาเขตคอลัมน์จากคำหลัก (1. / FMC / MONTH / CHECK)
//   3) extractSheet(): OCR ซ้ำแบบเจาะช่อง (ocrCrop) เพื่อความแม่นยำ
//        - ช่องสถานภาพ: อังกฤษ ขยาย 3 เท่า · ช่องข้อขัดข้อง: ไทย+อังกฤษ ทีละบรรทัด
//        - ชื่อเช็ค: อังกฤษ · วันที่เช็ค: ไทยล้วน (อ่านชื่อเดือนไทยได้ดีกว่า)
//   4) reconcile(): เทียบกับข้อมูลเดิมในระบบ — ข้อความที่ใกล้เคียงของเดิมให้ใช้ของเดิม (แก้ OCR ผิดเล็กน้อย)
//  ผลลัพธ์ทั้งหมดผู้วางแผนตรวจทาน/แก้ได้ก่อนกดนำเข้า
// =====================================================================

export const TH_MONTHS = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const TH_DIGITS = "๐๑๒๓๔๕๖๗๘๙";
export const thaiDigitsToArabic = (s) => String(s || "").replace(/[๐-๙]/g, (c) => TH_DIGITS.indexOf(c));

// แก้รูปแบบอักษรไทยที่ OCR ชอบออกผิด: "ํา" (นิคหิต+สระอา) → "ำ" · วรรณยุกต์ซ้ำ "้้" → "้"
export const fixThai = (s) => String(s || "").replace(/\u0E4D\u0E32/g, "\u0E33").replace(/([\u0E48-\u0E4B])\1+/g, "$1");
// ชื่อเดือนย่อที่จุดหาย/มีช่องว่าง เช่น "ตค." "ต .ค" → "ต.ค." (เรียงแบบยาวก่อน กัน ม.ค. ไปจับใน มี.ค.)
const MONTH_FIX = ["มี.ค.","เม.ย.","มิ.ย.","ม.ค.","ก.พ.","พ.ค.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."].map((m) => {
  const [a, ...rest] = m.replace(/\.$/, "").split(".");
  return [new RegExp(a + "\\s*\\.?\\s*" + rest.join("") + "\\s*\\.?", "g"), m];
});
export const fixMonths = (s) => MONTH_FIX.reduce((t, [re, m]) => t.replace(re, m), String(s || ""));

// "7 ต.ค.69" / "ประจำวันที่ 7 ต.ค. 2569" → "2026-10-07"
export function parseThaiDate(str) {
  const s = thaiDigitsToArabic(str).replace(/\s+/g, " ");
  for (let mi = 0; mi < 12; mi++) {
    const mon = TH_MONTHS[mi].replace(/\./g, "\\.?\\s*");
    const m = s.match(new RegExp(`(\\d{1,2})\\s*${mon}\\s*(\\d{2,4})`));
    if (m) {
      let y = +m[2]; if (y < 100) y += 2500; if (y > 2400) y -= 543;
      const d = +m[1]; if (d < 1 || d > 31) continue;
      return `${y}-${String(mi + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  return null;
}

// ---------- จัดคำเป็นบรรทัดตามแกน y ----------
export function groupLines(words, tol) {
  const ws = [...words].sort((a, b) => (a.y0 + a.y1) - (b.y0 + b.y1));
  const lines = [];
  for (const w of ws) {
    const cy = (w.y0 + w.y1) / 2;
    const ln = lines.find((l) => Math.abs(l.cy - cy) <= tol);
    if (ln) { ln.words.push(w); ln.cy = (ln.cy * (ln.words.length - 1) + cy) / ln.words.length;
              ln.y0 = Math.min(ln.y0, w.y0); ln.y1 = Math.max(ln.y1, w.y1); }
    else lines.push({ cy, y0: w.y0, y1: w.y1, words: [w] });
  }
  lines.forEach((l) => l.words.sort((a, b) => a.x0 - b.x0));
  return lines.sort((a, b) => a.cy - b.cy);
}
const joinWords = (ws) => ws.map((w) => w.t).join(" ").replace(/\s+/g, " ").trim();
const isJunk = (t) => /^[|\[\]{}()_\-—–.,:;'"`~]+$/.test(t.trim());
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// ---------- 2) หาโครงสร้างตาราง ----------
export function analyzeLayout(words, W, H) {
  const k = H / 3507;                                   // อ้างอิงที่ 300dpi A4 (สูง 3507px)
  const lineH = median(words.map((w) => w.y1 - w.y0).filter((h) => h > 10 * k && h < 60 * k)) || 24 * k;
  const tol = Math.max(10 * k, lineH * 0.6);

  // เขตคอลัมน์ — หาจากคำหลักในเอกสาร ถ้าไม่เจอใช้สัดส่วนมาตรฐานของแบบฟอร์ม
  const nums = words.filter((w) => /^\d{1,2}[.)]$/.test(w.t) && w.x0 > 0.3 * W && w.x0 < 0.5 * W);
  const defX0 = nums.length ? Math.min(...nums.map((w) => w.x0)) - 8 * k : 0.349 * W;
  const names = words.filter((w) => /MONTH|CHECK|HANGAR|QUEEN/i.test(w.t) && w.x0 > 0.6 * W);
  const remX0 = names.length ? Math.min(...names.map((w) => w.x0)) - 40 * k : 0.735 * W;
  const nameX1 = names.length ? Math.max(...names.map((w) => w.x1)) + 25 * k : 0.835 * W;
  const zones = {
    mark: [0.175 * W, 0.195 * W], status: [0.192 * W, 0.243 * W], hoursAF: [0.243 * W, 0.293 * W],
    def: [defX0, remX0], rem: [remX0, 0.99 * W], nameX1,
  };

  // แถวเครื่อง: เลขในวงเล็บ (313) ใต้หมายเลข 1/52
  //  มาจาก 2 รอบ OCR: ทั้งหน้า (ไทย+อังกฤษ — บางทีอ่าน "(302)" เป็นอักษรไทย) + คอลัมน์หมายเลข (อังกฤษล้วน, src "col")
  //  → รวมกัน ตัดซ้ำ: เลขเดียวกันใกล้กัน = แถวเดียว · ตำแหน่งเดียวกันแต่อ่านต่างกัน = เชื่อรอบคอลัมน์
  const tails = [];
  for (const w of words.filter((w) => /^\(?3\d{2}\)?$/.test(w.t) && w.x0 < 0.2 * W && w.x0 > 0.08 * W)
                       .sort((a, b) => (a.src === "col" ? 0 : 1) - (b.src === "col" ? 0 : 1))) {
    const t3 = w.t.replace(/\D/g, "");
    if (tails.some((x) => x.t.replace(/\D/g, "") === t3 && Math.abs(x.y0 - w.y0) < 150 * k)) continue;
    if (tails.some((x) => Math.abs(x.y0 - w.y0) < 40 * k)) continue;
    tails.push(w);
  }
  tails.sort((a, b) => a.y0 - b.y0);
  const rows = tails.map((tw) => {
    const above = words.find((w) => /\/\s*(52|66)$/.test(w.t) && Math.abs(w.x0 - tw.x0) < 60 * k &&
                                    w.y0 < tw.y0 - 15 * k && w.y0 > tw.y0 - 120 * k);
    return { tail3: tw.t.replace(/\D/g, ""), y0: (above ? above.y0 : tw.y0 - 55 * k) - 12 * k };
  });
  // ขอบล่างของแต่ละแถว = ขอบบนแถวถัดไป · แถวสุดท้าย = ก่อนตารางสรุป (คำฝั่งซ้ายบรรทัดถัดไป)
  const gaps = rows.slice(1).map((r, i) => r.y0 - rows[i].y0);
  const minGap = gaps.length ? Math.min(...gaps) : 260 * k;
  rows.forEach((r, i) => {
    if (i < rows.length - 1) { r.y1 = rows[i + 1].y0; return; }
    const below = words.filter((w) => w.x0 < 0.15 * W && w.y0 > r.y0 + minGap * 0.6 && !/^\(?3\d{2}\)?$/.test(w.t));
    r.y1 = Math.min(r.y0 + minGap * 1.15, below.length ? Math.min(...below.map((w) => w.y0)) - 4 * k : Infinity);
  });

  const inZone = (w, z, r) => w.x0 >= z[0] && w.x1 <= z[1] + 15 * k && w.y0 >= r.y0 && w.y1 <= r.y1 + 6 * k;
  rows.forEach((r) => {
    const top = (w) => w.y0 < r.y0 + lineH * 2.2;                // บรรทัดแรกของแถว
    const markW = words.filter((w) => inZone(w, zones.mark, r) && top(w) && !/^\|+$/.test(w.t));
    const mt = joinWords(markW);
    r.mark = /[xX×%*]/.test(mt) ? "X" : /[\/lI]/.test(mt) ? "/" : null;
    r.statusRaw = joinWords(words.filter((w) => inZone(w, zones.status, r) && top(w)));
    r.statusRect = { x: zones.status[0], y: r.y0, w: zones.status[1] - zones.status[0], h: lineH * 2.6 };
    r.hoursAF = joinWords(words.filter((w) => inZone(w, zones.hoursAF, r) && top(w))).replace(/[^\d.,]/g, "");

    const defLines = groupLines(words.filter((w) => inZone(w, zones.def, r) && !isJunk(w.t)), tol);
    r.defectLines = defLines.map((l) => ({ raw: joinWords(l.words),
      rect: { x: zones.def[0], y: l.y0 - 10 * k, w: zones.def[1] - zones.def[0], h: (l.y1 - l.y0) + 20 * k } }));

    const remLines = groupLines(words.filter((w) => inZone(w, zones.rem, r) && !isJunk(w.t)), tol);
    r.checkLines = remLines.map((l) => ({
      nameRaw: joinWords(l.words.filter((w) => w.x0 < zones.nameX1)),
      dateRaw: joinWords(l.words.filter((w) => w.x0 >= zones.nameX1 - 10 * k)),
      nameRect: { x: zones.rem[0], y: l.y0 - 10 * k, w: zones.nameX1 - zones.rem[0], h: (l.y1 - l.y0) + 20 * k },
      dateRect: { x: zones.nameX1 - 10 * k, y: l.y0 - 10 * k, w: zones.rem[1] - zones.nameX1 + 10 * k, h: (l.y1 - l.y0) + 20 * k },
    }));
  });
  return { rows, zones, lineH };
}

// ---------- ชื่อเช็ค → รูปแบบที่ระบบใช้ ("2 MONTH"→"2 M", "A12-CHECK"→"A12-Cx") ----------
export function normalizeCheckName(raw) {
  let s = thaiDigitsToArabic(raw).toUpperCase().replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
  if (/HANGAR|QUEEN/.test(s)) return "HANGAR QUEEN";
  const mo = s.match(/(\d+)\s*-?\s*MONTH/); if (mo) return `${mo[1]} M`;
  const ck = s.match(/([A-Z])\s*(\d{0,2})\s*-?\s*CHE?CK/);
  if (ck) return `${ck[1]}${ck[2]}-Cx`;
  return s;
}
const cleanDate = (s) => fixMonths(fixThai(thaiDigitsToArabic(s))).replace(/[|\[\]{}]/g, " ").replace(/\s+/g, " ").trim()
  .replace(/\s*-\s*/g, " - ").replace(/^[^\d]+/, "")
  .replace(/(\d)\.(?=\s)/g, "$1")                      // "24. ธ.ค." → "24 ธ.ค."
  .replace(/(\d)(?=[ก-๙])/g, "$1 ")                     // "5ม.ค." → "5 ม.ค."
  .replace(/\s+/g, " ").trim();

// ---------- ตัดสินสถานภาพ ----------
export function decideStatus(readings, mark, nDefects) {
  const toks = readings.map((r) => String(r || "").toUpperCase().replace(/[^A-Z]/g, "")).filter(Boolean);
  const any = (re) => toks.some((t) => re.test(t));
  const sAny = any(/NMCS|NCS|MCS$/);
  if (mark === "X") return sAny ? "NMCS" : "NMC";
  if (mark === "/") return any(/^PMC/) && nDefects > 0 ? "PMC" : "FMC";
  if (any(/^N/)) return sAny ? "NMCS" : "NMC";
  if (any(/^F/)) return "FMC";
  if (any(/^P/)) return "PMC";
  return nDefects > 0 ? "NMC" : "FMC";
}

// ---------- 3) ประกอบผล + OCR ซ้ำแบบเจาะช่อง ----------
//  ocrCrop(rect, kind) → Promise<string>  · kind: "status" | "defect" | "checkName" | "checkDate"
export async function extractSheet({ words, W, H, ocrCrop, fileName = "", onProgress = () => {} }) {
  const { rows } = analyzeLayout(words, W, H);
  const headerText = words.filter((w) => w.y1 < 0.12 * H).map((w) => w.t).join(" ");
  const date = parseThaiDate(fileName) || parseThaiDate(headerText);
  const total = rows.reduce((n, r) => n + 1 + r.defectLines.length + r.checkLines.length, 0) || 1;
  let done = 0; const tick = () => onProgress(++done / total);

  const out = [];
  for (const r of rows) {
    const readings = [r.statusRaw];
    if (ocrCrop) readings.push(...(await ocrCrop(r.statusRect, "status")).split("\n"));
    tick();

    // ข้อขัดข้อง: บรรทัดที่ขึ้นต้นด้วยเลข = ข้อใหม่ · ไม่มีเลข = ต่อจากข้อก่อนหน้า
    const defects = [];
    for (const dl of r.defectLines) {
      let t = ocrCrop ? (await ocrCrop(dl.rect, "defect")) : dl.raw;
      t = fixThai(t || dl.raw).replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
      if (!/\(/.test(t)) t = t.replace(/\s*[)\]]+\s*$/, "");      // วงเล็บปิดเกินท้ายบรรทัด (เส้นตาราง)
      tick();
      if (!t || isJunk(t)) continue;
      const m = thaiDigitsToArabic(t).match(/^(\d{1,2})\s*[.)]\s*(.*)$/);
      if (m) defects.push(m[2].trim());
      else if (defects.length) defects[defects.length - 1] += " " + t;
      else defects.push(t);
    }

    const checks = [];
    for (const cl of r.checkLines) {
      let name = normalizeCheckName(cl.nameRaw);
      if (ocrCrop && !/^(\d+ M|[A-Z]\d*-Cx|HANGAR QUEEN)$/.test(name)) {
        name = normalizeCheckName(await ocrCrop(cl.nameRect, "checkName")) || name;
      }
      let due = cl.dateRaw ? cleanDate(cl.dateRaw) : "";
      if (ocrCrop && cl.dateRaw) due = cleanDate(await ocrCrop(cl.dateRect, "checkDate")) || due;
      tick();
      if (!name && !due) continue;
      checks.push({ name: name || "?", due_text: name === "HANGAR QUEEN" ? "" : due, dueRaw: cl.dateRaw });
    }

    const st = decideStatus(readings, r.mark, defects.length);
    out.push({ tail3: r.tail3, status: st, statusRead: readings.filter(Boolean).join(" / "), mark: r.mark,
               hoursAF: r.hoursAF, defects, checks });
  }
  return { date, headerText, rows: out };
}

// ---------- 4) เทียบกับข้อมูลเดิมในระบบ ----------
const norm = (s) => fixThai(thaiDigitsToArabic(s)).toLowerCase().replace(/[\s.,:;()\[\]|'"`\-–—]/g, "");
export function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const m = a.length, n = b.length; let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return 1 - prev[n] / Math.max(m, n);
}
const digits = (s) => (thaiDigitsToArabic(s).match(/\d+/g) || []);
const isSubseq = (sub, arr) => { let i = 0; for (const x of arr) if (x === sub[i]) i++; return i === sub.length; };

//  existing: { [tail3]: { status, defects:[text], checks:[{name,due_text}] } }
export function reconcile(rows, existing = {}) {
  return rows.map((r) => {
    const ex = existing[r.tail3] || { defects: [], checks: [] };
    const used = new Set();
    const defects = r.defects.map((d) => {
      let best = -1, bs = 0;
      ex.defects.forEach((e, i) => { const s = similarity(d, e); if (s > bs && !used.has(i)) { bs = s; best = i; } });
      if (best >= 0 && bs >= 0.72) { used.add(best); return { text: ex.defects[best], ocr: d, matched: true }; }
      return { text: d, ocr: d, matched: false };
    });
    const checks = r.checks.map((c) => {
      const e = ex.checks.find((x) => norm(x.name) === norm(c.name)) ||
                ex.checks.find((x) => similarity(x.name, c.name) >= 0.7);
      if (e) {
        const dE = digits(e.due_text || "");
        if (!dE.length && !c.due_text) return { ...c, name: e.name, due_text: e.due_text || "", matched: true };
        // ตัวเลขวัน/ปีตรงกับของเดิม (เทียบทั้งข้อความที่ OCR ซ้ำ และของดิบ) → ใช้ข้อความเดิมที่ถูกต้อง
        if (dE.length && (isSubseq(dE, digits(c.due_text)) || isSubseq(dE, digits(c.dueRaw || ""))))
          return { ...c, name: e.name, due_text: e.due_text, matched: true };
        return { ...c, name: e.name, matched: false };
      }
      return { ...c, matched: false };
    });
    return { ...r, defects, checks, prevStatus: ex.status || null };
  });
}
