// =====================================================================
//  daily-report.js — ข้อความรายงานภารกิจประจำวัน (คัดลอกไปรายงานต่อ) · popup ในหน้าหลัก
//   • ภารกิจ = การ์ดในหน้าหลัก (ไม่นับ STBY ทั่วไป) เรียงลำดับเดียวกับหน้าหลัก
//   • รายงานหลังบินแล้ว → ปฏิบัติภารกิจเรียบร้อย · ยังไม่รายงาน → อยู่ระหว่างปฏิบัติภารกิจ · ยกเลิก → ยกเลิกภารกิจ
// =====================================================================
import { reportOf, parseMissionNames } from "./missions.js";
import { orderMissions } from "./mission-sheet.js";

const TH_MON_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
// "2026-11-02" → "2 พ.ย.69"
export const thShort = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${TH_MON_SHORT[m - 1]}${String(y + 543).slice(-2)}`;
};

export const RESULT = {
  done: "-ปฏิบัติภารกิจเรียบร้อย",
  pending: "-อยู่ระหว่างปฏิบัติภารกิจ",
  cancelled: "-ยกเลิกภารกิจ",
};
export const resultOf = (m) => m.status === "cancelled" ? "cancelled" : reportOf(m) ? "done" : "pending";

// ภารกิจที่อยู่ในรายงาน (เหมือนการ์ดหน้าหลัก: ทุกชนิดยกเว้น STBY ทั่วไป)
export const reportMissions = (all) => orderMissions((all || []).filter((m) => m.kind !== "stby"));

// เส้นทาง: ตัดเวลาในวงเล็บ เช่น "บุรีรัมย์(1120)" → "บุรีรัมย์"
const cleanRoute = (r) => String(r || "").replace(/\s*\(\s*\d{3,4}\s*\)/g, "").replace(/\s+/g, " ").trim();

export function buildDailyReport(dateIso, all) {
  const list = reportMissions(all);
  const head = [`ขออนุญาตรายงานภารกิจการบินฝูง.603`, `วันที่ ${thShort(dateIso)}`];
  if (!list.length) return [...head, `ไม่มีภารกิจ`, ``, `ครับ`].join("\n");
  const blocks = list.map((m, i) => {
    const route = cleanRoute(m.route);
    return [
      `(${i + 1}) ${parseMissionNames(m).join(", ") || "-"}`,
      ...(route ? [`เส้นทางบิน ${route}`] : []),
      RESULT[resultOf(m)],
    ].join("\n");
  });
  return [...head, `ทั้งหมด ${list.length} ภารกิจ`, ``, blocks.join("\n\n"), ``, `ครับ`].join("\n");
}

// ---------- หน้าต่าง popup ในหน้าหลัก (แก้ข้อความก่อนคัดลอกได้) · ใช้ CSS .dsh-* ของ home.html ----------
export function openDailyReport({ date, title, missions }) {
  const list = reportMissions(missions);
  const n = { done: 0, pending: 0, cancelled: 0 };
  list.forEach((m) => n[resultOf(m)]++);
  const bg = document.createElement("div");
  bg.className = "dsh-bg";
  bg.innerHTML = `
    <div class="dsh drp" role="dialog" aria-label="รายงานประจำวัน">
      <div class="dsh-h"><b>📝 รายงานประจำวัน</b><span class="muted">${title}</span>
        <button type="button" class="btn sm ghost" data-close style="margin-inline-start:auto">ปิด</button></div>
      <p class="dsh-hint">${list.length ? `เรียบร้อย ${n.done} · ระหว่างปฏิบัติ ${n.pending}${n.cancelled ? ` · ยกเลิก ${n.cancelled}` : ""} · ` : ""}
        รายงานหลังบินแล้ว → <b>-ปฏิบัติภารกิจเรียบร้อย</b> · ยังไม่รายงาน → <b>-อยู่ระหว่างปฏิบัติภารกิจ</b> · แก้ข้อความก่อนคัดลอกได้</p>
      <textarea class="drp-txt" spellcheck="false" aria-label="ข้อความรายงาน"></textarea>
      <div class="dsh-f">
        <span class="dsh-msg" data-msg style="margin-inline-end:auto"></span>
        <button type="button" class="btn ghost" data-reset title="สร้างข้อความใหม่จากข้อมูลล่าสุด (ล้างที่แก้เอง)">↻ สร้างใหม่</button>
        <button type="button" class="btn primary" data-copy>📋 คัดลอกข้อความ</button>
      </div>
    </div>`;
  document.body.appendChild(bg);
  const txt = bg.querySelector(".drp-txt");
  txt.value = buildDailyReport(date, missions);
  const close = () => { bg.remove(); removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  addEventListener("keydown", onKey);
  bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
  bg.querySelector("[data-close]").addEventListener("click", close);
  bg.querySelector("[data-reset]").addEventListener("click", () => { txt.value = buildDailyReport(date, missions); });
  bg.querySelector("[data-copy]").addEventListener("click", async () => {
    let ok = true;
    try { await navigator.clipboard.writeText(txt.value); }
    catch { txt.select(); ok = document.execCommand("copy"); }          // เบราว์เซอร์ที่ไม่ให้ใช้ clipboard API
    const msg = bg.querySelector("[data-msg]");
    msg.textContent = ok ? "✓ คัดลอกแล้ว" : "คัดลอกไม่สำเร็จ — เลือกข้อความแล้วกด Ctrl/Cmd+C เอง";
    msg.classList.toggle("err", !ok);
  });
}
