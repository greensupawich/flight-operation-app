// =====================================================================
//  daily-sheet.js — ตาราง "ภารกิจประจำวัน" (ฟอร์มรวมทุกฝูง) สำหรับคัดลอกไปวางใน Excel / Google Sheets
//   คอลัมน์: ฝูง · Taxi · T/O · แบบ บ. · Pax · เลข บ. · C/S · ภารกิจ · เส้นทาง · ลูกเรือ · สนับสนุน · หมายเหตุ
//   • ภารกิจ = การ์ดหน้าหลัก (ไม่นับ STBY ทั่วไป) เรียงเหมือนกระดาน · ไม่มีภารกิจ → 1 แถว "ไม่มีภารกิจ"
//   • ลูกเรือ = นักบิน (AC → IP → P → CP → นบ.ราชฯ → ตห. → N)
//   • สนับสนุน ไม่มีในระบบ → เดาจากเส้นทาง = บน. ที่แวะระหว่างทาง (ไม่นับต้นทาง/ปลายทาง) · ไม่มี → "-" · แก้ในตารางก่อนคัดลอกได้
//   • หมายเหตุ: จัดรับรอง "1 ขา / 2 ขา" → "จัดรับรอง" · ข้อความอื่น (เช่น ใช้จาก บ.จริง) → ตามที่กรอก · ยกเลิก → "ยกเลิกภารกิจ"
// =====================================================================
import { PILOT_ROLES, parseMissionNames, esc } from "./missions.js";
import { orderMissions } from "./mission-sheet.js";

export const SQUADRON = "603";
export const HEADERS = ["ฝูง", "Taxi", "T/O", "แบบ บ.", "Pax", "เลข บ.", "C/S", "ภารกิจ", "เส้นทาง", "ลูกเรือ", "สนับสนุน", "หมายเหตุ"];
const AC_TYPE = { "ATR72-500": "บ.ล.16", "ATR72-600": "บ.ล.16 ก" };
const dash = (v) => String(v ?? "").trim() || "-";

const isStbyTime = (t) => /^STBY$/i.test(String(t || "").trim());
function crewLine(m) {
  const order = (p) => PILOT_ROLES.indexOf(String(p || "").toUpperCase());
  const seen = new Set();
  return (m.mission_crew || [])
    .filter((c) => order(c.position) >= 0 && (c.crew_name || "").trim())
    .sort((a, b) => order(a.position) - order(b.position) || (a.sort_order || 0) - (b.sort_order || 0))
    .map((c) => c.crew_name.trim())
    .filter((n) => !seen.has(n) && seen.add(n))
    .join(", ");
}
export const SUPPORT_COL = 10;
function supportOf(route) {
  const stops = String(route || "").split(/\s+-\s+|\s*–\s*/).map((s) => s.replace(/\(.*?\)/g, "").trim()).filter(Boolean);
  const mid = [...new Set(stops.slice(1, -1).filter((s) => /^บน\.\s*\d+$/.test(s)))];
  return mid.join(", ") || "-";
}
function remarkOf(m) {
  if (m.status === "cancelled") return "ยกเลิกภารกิจ";
  const c = String(m.catering || "").trim();
  if (!c || c === "-") return "-";
  return /^\d+\s*ขา/.test(c) ? "จัดรับรอง" : c;
}

export function dailySheetRows(all, aircraft = []) {
  const list = orderMissions((all || []).filter((m) => m.kind !== "stby"));
  const defType = AC_TYPE[aircraft.find((a) => a.type)?.type] || "บ.ล.16 ก";
  if (!list.length) return [[SQUADRON, "-", "-", defType, "-", "-", "-", "ไม่มีภารกิจ", "-", "-", "-", "-"]];
  return list.map((m) => [
    SQUADRON,
    m.taxi_time?.trim() ? m.taxi_time.trim() : isStbyTime(m.takeoff_time) ? "STBY" : "-",
    dash(m.takeoff_time),
    dash(AC_TYPE[m.aircraft?.type] || m.aircraft?.type),
    dash(m.pax),
    dash(m.aircraft?.tail_number),
    dash(m.callsign),
    dash(parseMissionNames(m).join(", ")),
    dash(m.route),
    dash(crewLine(m)),
    supportOf(m.route),
    remarkOf(m),
  ]);
}

// ---------- คัดลอก: text/html (ตาราง) + text/plain (TSV) → วางใน Excel / Google Sheets แยกช่องให้เอง ----------
const tsvCell = (v) => { const s = String(v ?? ""); return /[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export const toTSV = (rows) => rows.map((r) => r.map(tsvCell).join("\t")).join("\n");
export const toHTML = (rows) => `<table>${rows.map((r) => `<tr>${r.map((v) =>
  `<td style="mso-number-format:'\\@'">${esc(v).replace(/\n/g, "<br>")}</td>`).join("")}</tr>`).join("")}</table>`;

export async function copyRows(rows) {
  const text = toTSV(rows), html = toHTML(rows);
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/plain": new Blob([text], { type: "text/plain" }),
      "text/html": new Blob([html], { type: "text/html" }),
    })]);
    return true;
  } catch {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* ด้านล่าง */ }
  }
  const ta = Object.assign(document.createElement("textarea"), { value: text });     // เบราว์เซอร์ที่ไม่ให้ใช้ clipboard API
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand("copy"); ta.remove();
  return ok;
}

// ---------- หน้าต่างแสดงตาราง (แก้ช่องได้ก่อนคัดลอก) ----------
export function openDailySheet({ title, missions, aircraft }) {
  const rows = dailySheetRows(missions, aircraft);
  const bg = document.createElement("div");
  bg.className = "dsh-bg";
  bg.innerHTML = `
    <div class="dsh" role="dialog" aria-label="ตารางภารกิจประจำวัน">
      <div class="dsh-h"><b>📋 ตารางภารกิจประจำวัน</b><span class="muted">${esc(title)}</span>
        <button type="button" class="btn sm ghost" data-close style="margin-inline-start:auto">ปิด</button></div>
      <p class="dsh-hint">คลิกช่องเพื่อแก้ก่อนคัดลอกได้ · ช่อง <b class="dsh-guess">สนับสนุน</b> ระบบเดาจาก บน. ที่แวะในเส้นทาง — ตรวจก่อนคัดลอก ·
        กดคัดลอกแล้วไปวางที่ช่องแรกของแถวใน Excel / Google Sheets</p>
      <div class="dsh-wrap"><table class="dsh-t">
        <thead><tr>${HEADERS.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td contenteditable="plaintext-only" spellcheck="false"${i === SUPPORT_COL ? ' class="dsh-guess"' : ""}>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
      <div class="dsh-f">
        <label class="dsh-chk"><input type="checkbox" data-head> รวมหัวคอลัมน์</label>
        <span class="dsh-msg" data-msg></span>
        <button type="button" class="btn ghost" data-reset>↻ สร้างใหม่</button>
        <button type="button" class="btn primary" data-copy>📋 คัดลอกตาราง</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
  const close = () => { bg.remove(); removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  addEventListener("keydown", onKey);
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  bg.querySelector("[data-close]").addEventListener("click", close);
  bg.querySelector("[data-reset]").addEventListener("click", () => { close(); openDailySheet({ title, missions, aircraft }); });
  bg.querySelector("[data-copy]").addEventListener("click", async () => {
    const cur = [...bg.querySelectorAll(".dsh-t tbody tr")].map((tr) => [...tr.cells].map((td) => td.innerText.trim()));
    const ok = await copyRows(bg.querySelector("[data-head]").checked ? [HEADERS, ...cur] : cur);
    const msg = bg.querySelector("[data-msg]");
    msg.textContent = ok ? `✓ คัดลอก ${cur.length} แถวแล้ว` : "คัดลอกไม่สำเร็จ — เลือกตารางแล้วกด Ctrl/Cmd+C เอง";
    msg.classList.toggle("err", !ok);
  });
}
