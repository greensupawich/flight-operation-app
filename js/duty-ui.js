// =====================================================================
//  duty-ui.js — แท็บ ค้างคืน / เดโชชัย / STBY เดโชชัย / RTAF (ติดตั้งในหน้าคิวบิน)
//  mountDutyTabs({ host, mainEl, mainLabel, planner, loadCrew })
//   • host   = ที่วางแถบแท็บ + เนื้อหาแท็บใหม่ (ใต้หัวหน้า)
//   • mainEl = เนื้อหาเดิมของหน้า (แท็บแรก) — ซ่อนเมื่อเปิดแท็บอื่น
//  ข้อมูล: js/duty.js (migration_34) · แท็บจำใน URL hash เช่น queue.html#overnight
// =====================================================================
import { esc, qualStyle } from "./missions.js";
import { DUTY_CATS, loadDuty, addDuty, removeDuty, saveDutyNote, loadRtaf, saveRtaf, deleteRtaf } from "./duty.js";

const TABS = [["overnight", "🌙 ค้างคืน"], ["dechochai", "🔥 เดโชชัย"], ["stby_dechochai", "⏳ STBY เดโชชัย"], ["rtaf", "🌏 RTAF"]];
const TH_MON = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
const thShort = (d) => { const [y, m, dd] = d.split("-").map(Number); return `${dd} ${TH_MON[m - 1]}${String(y + 543).slice(-2)}`; };
const say = (el, text, ok) => { el.style.color = ok ? "var(--good)" : "var(--crit)"; el.textContent = text; };

const CSS = `
  .dtabs{display:flex;gap:4px;border-bottom:2px solid var(--line);margin:4px 0 16px;overflow-x:auto}
  .dtabs a{padding:9px 14px;font-size:14px;font-weight:600;color:var(--muted);text-decoration:none;white-space:nowrap;
           border-bottom:3px solid transparent;margin-bottom:-2px}
  .dtabs a.on{color:var(--primary);border-bottom-color:var(--primary)}
  .dtabs a:hover{color:var(--ink)}
  .dbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px;font-size:13px}
  .dbar input,.dbar select{width:auto}
  table.duty{width:100%;border-collapse:collapse;font-size:13px}
  table.duty th,table.duty td{border-bottom:1px solid var(--line);padding:7px 8px;text-align:start;vertical-align:top}
  table.duty th{font-size:12px;color:var(--muted);font-weight:600;background:var(--surface-2);position:sticky;top:0}
  table.duty td.nm{white-space:nowrap;font-weight:600}
  table.duty td.nm span{border-radius:5px;padding:1px 6px}
  table.duty td.num{text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap}
  .chips{display:flex;flex-wrap:wrap;gap:4px}
  .chip{display:inline-flex;align-items:center;gap:3px;background:var(--surface-2);border:1px solid var(--line);
        border-radius:6px;padding:1px 7px;font-size:12px;font-family:"IBM Plex Mono",monospace;white-space:nowrap}
  .chip.last{background:var(--primary-soft);border-color:var(--primary);color:var(--primary);font-weight:700}
  .chip button{border:0;background:none;color:var(--crit);cursor:pointer;padding:0 0 0 2px;font-weight:700}
  .addd{display:flex;gap:4px;margin-top:5px}
  .addd input{width:auto;font-size:12px;padding:3px 6px}
  .noteIn{width:100%;font-size:12.5px;padding:4px 6px}
  .rtaf input{width:100%;font-size:12.5px;padding:4px 6px;margin:0}
  .rtaf td{padding:4px 5px}
  .rtaf .cs{width:110px} .rtaf .dt{width:150px}
  .msgline{font-size:12.5px;min-height:16px;margin-top:6px}`;

const HTML = (mainLabel) => `
  <nav class="dtabs" id="dtabs">
    <a href="#" data-tab="">${mainLabel}</a>
    ${TABS.map(([k, l]) => `<a href="#${k}" data-tab="${k}">${l}</a>`).join("")}
  </nav>
  <section id="dt-duty" hidden>
    <div class="dbar">
      <b id="dutyTitle"></b><span class="muted" id="dutySub"></span>
      <span style="margin-inline-start:auto">เรียง:</span>
      <select id="dutySort"><option value="roster">ตามทะเบียน</option><option value="last">วันล่าสุด (นานสุดก่อน)</option>
        <option value="count">จำนวนครั้ง (น้อยก่อน)</option></select>
      <input id="dutyFind" placeholder="ค้นหาชื่อ" style="width:140px">
    </div>
    <div class="tablewrap"><table class="duty">
      <thead><tr><th style="width:36px">#</th><th style="width:170px">ชื่อ</th><th>วันที่</th>
        <th style="width:80px;text-align:center">จำนวนครั้ง</th><th style="width:110px;text-align:center">วันล่าสุด</th><th style="width:170px">หมายเหตุ</th></tr></thead>
      <tbody id="dutyRows"><tr><td colspan="6" class="empty">กำลังโหลด…</td></tr></tbody></table></div>
    <div class="msgline" id="dutyMsg"></div>
    <p class="muted" style="font-size:12px">แสดงเฉพาะนักบินที่อยู่ในทะเบียน (ใช้งาน) · ข้อมูลตั้งต้นจากไฟล์ "นจบ." · ผู้วางแผนเพิ่ม/ลบวันที่และแก้หมายเหตุได้</p>
  </section>
  <section id="dt-rtaf" hidden>
    <div class="dbar">
      <b>ภารกิจต่างประเทศ ฝูง.603 บน.6</b>
      <label style="margin:0">ปีงบประมาณ</label><select id="rtafFy"></select>
      <button class="btn sm primary" id="rtafAdd" hidden style="margin-inline-start:auto">+ เพิ่มแถว</button>
    </div>
    <div class="tablewrap"><table class="duty rtaf">
      <thead><tr><th class="cs">CALL SIGN</th><th class="dt">DATE</th><th>MISSION</th><th>ROUTE</th><th style="width:150px">หมายเหตุ</th><th style="width:40px"></th></tr></thead>
      <tbody id="rtafRows"><tr><td colspan="6" class="empty">กำลังโหลด…</td></tr></tbody></table></div>
    <div class="msgline" id="rtafMsg"></div>
    <p class="muted" style="font-size:12px">พิมพ์แก้ได้ทันที (บันทึกอัตโนมัติเมื่อออกจากช่อง) · ตารางนี้ไม่เชื่อมกับหน้าอื่น</p>
  </section>`;

export function mountDutyTabs({ host, mainEl, mainLabel = "หน้าหลัก", planner, loadCrew }) {
  if (!document.getElementById("duty-ui-css")) {
    const st = document.createElement("style"); st.id = "duty-ui-css"; st.textContent = CSS; document.head.appendChild(st);
  }
  host.innerHTML = HTML(mainLabel);
  const $ = (id) => host.querySelector("#" + id);
  // กันคีย์บอร์ดในแท็บใหม่ไม่ให้ไปถึงตัวดักคีย์ของหน้าเดิม (เช่น Delete ลบช่องในตารางคิวที่เลือกค้างไว้)
  ["dt-duty", "dt-rtaf"].forEach((id) => $(id).addEventListener("keydown", (e) => e.stopPropagation()));

  let crewList = null;
  const getCrew = async () => crewList || (crewList = await loadCrew());

  function showTab() {
    const t = location.hash.slice(1);
    const tab = TABS.some(([k]) => k === t) ? t : "";
    host.querySelectorAll("#dtabs a").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
    mainEl.hidden = tab !== "";
    $("dt-duty").hidden = !(tab in DUTY_CATS);
    $("dt-rtaf").hidden = tab !== "rtaf";
    if (tab in DUTY_CATS) openDuty(tab);
    if (tab === "rtaf") openRtaf();
  }
  host.querySelector('#dtabs a[data-tab=""]').addEventListener("click", (e) => {
    e.preventDefault(); history.replaceState(null, "", location.pathname + location.search); showTab();
  });
  addEventListener("hashchange", showTab);

  // ---------- ค้างคืน / เดโชชัย / STBY เดโชชัย ----------
  let dutyCat = null, duty = null;
  async function openDuty(cat) {
    dutyCat = cat;
    $("dutyTitle").textContent = DUTY_CATS[cat];
    $("dutyRows").innerHTML = `<tr><td colspan="6" class="empty">กำลังโหลด…</td></tr>`;
    const [, d] = await Promise.all([getCrew(), loadDuty(cat)]);
    if (cat !== dutyCat) return;
    duty = d;
    if (d.error) say($("dutyMsg"), d.error.message, false); else $("dutyMsg").textContent = "";
    renderDuty();
  }
  function renderDuty() {
    const q = $("dutyFind").value.trim(), sort = $("dutySort").value;
    const rows = (crewList || []).filter((c) => !q || c.full_name.includes(q)).map((c, idx) => {
      const ds = duty.days.get(c.id) || [];
      return { c, idx, ds, last: ds[ds.length - 1] || null };
    });
    if (sort === "last") rows.sort((a, b) => (a.last || "").localeCompare(b.last || "") || a.idx - b.idx);
    if (sort === "count") rows.sort((a, b) => a.ds.length - b.ds.length || (a.last || "").localeCompare(b.last || "") || a.idx - b.idx);
    $("dutySub").textContent = `${rows.length} คน · รวม ${rows.reduce((n, r) => n + r.ds.length, 0)} ครั้ง`;
    $("dutyRows").innerHTML = rows.length ? rows.map((r, i) => `
      <tr data-id="${r.c.id}">
        <td class="num">${i + 1}</td>
        <td class="nm"><span style="${qualStyle(r.c.position) || ""}">${esc(r.c.full_name)}</span></td>
        <td><div class="chips">${r.ds.map((d) => `<span class="chip${d === r.last ? " last" : ""}">${thShort(d)}${planner ? `<button title="ลบวันที่นี้" data-rm="${d}">×</button>` : ""}</span>`).join("") || `<span class="muted">—</span>`}</div>
          ${planner ? `<div class="addd"><input type="date" data-newd><button class="btn sm ghost" data-add>+ เพิ่ม</button></div>` : ""}</td>
        <td class="num">${r.ds.length}</td>
        <td class="num">${r.last ? thShort(r.last) : "—"}</td>
        <td>${planner ? `<input class="noteIn" data-note value="${esc(duty.notes.get(r.c.id) || "")}">` : esc(duty.notes.get(r.c.id) || "")}</td>
      </tr>`).join("") : `<tr><td colspan="6" class="empty">ไม่พบนักบิน</td></tr>`;
  }
  $("dutySort").addEventListener("change", renderDuty);
  $("dutyFind").addEventListener("input", renderDuty);
  $("dutyRows").addEventListener("click", async (e) => {
    const tr = e.target.closest("tr[data-id]"); if (!tr || !planner) return;
    const id = tr.dataset.id, msg = $("dutyMsg");
    if (e.target.matches("[data-rm]")) {
      const d = e.target.dataset.rm;
      if (!confirm(`ลบวันที่ ${thShort(d)} ออกจาก ${DUTY_CATS[dutyCat]}?`)) return;
      const err = await removeDuty(id, dutyCat, d);
      if (err) return say(msg, "ลบไม่สำเร็จ: " + err.message, false);
      duty.days.set(id, (duty.days.get(id) || []).filter((x) => x !== d)); renderDuty(); say(msg, "ลบแล้ว", true);
    }
    if (e.target.matches("[data-add]")) {
      const d = tr.querySelector("[data-newd]").value;
      if (!d) return say(msg, "เลือกวันที่ก่อน", false);
      const err = await addDuty(id, dutyCat, d);
      if (err) return say(msg, "เพิ่มไม่สำเร็จ: " + err.message, false);
      duty.days.set(id, [...new Set([...(duty.days.get(id) || []), d])].sort()); renderDuty(); say(msg, `เพิ่ม ${thShort(d)} แล้ว`, true);
    }
  });
  $("dutyRows").addEventListener("change", async (e) => {
    if (!e.target.matches("[data-note]")) return;
    const id = e.target.closest("tr").dataset.id;
    const err = await saveDutyNote(id, dutyCat, e.target.value);
    if (err) return say($("dutyMsg"), "บันทึกหมายเหตุไม่สำเร็จ: " + err.message, false);
    duty.notes.set(id, e.target.value.trim()); say($("dutyMsg"), "บันทึกหมายเหตุแล้ว", true);
  });

  // ---------- RTAF ----------
  let rtaf = null;
  const curFy = () => { const n = new Date(); return n.getFullYear() + 543 + (n.getMonth() >= 9 ? 1 : 0); };   // ปีงบเริ่ม ต.ค.
  const fy = () => Number($("rtafFy").value);
  async function openRtaf() {
    if (!rtaf) {
      const { rows, error } = await loadRtaf();
      if (error) { say($("rtafMsg"), error.message, false); rtaf = []; } else rtaf = rows;
      const years = [...new Set([curFy(), ...rtaf.map((r) => r.fiscal_year)])].sort((a, b) => b - a);
      const withData = years.find((y) => rtaf.some((r) => r.fiscal_year === y)) || curFy();
      $("rtafFy").innerHTML = years.map((y) => `<option ${y === withData ? "selected" : ""}>${y}</option>`).join("");
      $("rtafAdd").hidden = !planner;
    }
    renderRtaf();
  }
  function renderRtaf() {
    const rows = rtaf.filter((r) => r.fiscal_year === fy()).sort((a, b) => a.seq - b.seq);
    const cell = (r, f) => planner ? `<input data-f="${f}" value="${esc(r[f] || "")}">` : esc(r[f] || "");
    $("rtafRows").innerHTML = rows.length ? rows.map((r) => `
      <tr data-id="${r.id}"><td>${cell(r, "callsign")}</td><td>${cell(r, "date_text")}</td><td>${cell(r, "mission")}</td>
        <td>${cell(r, "route")}</td><td>${cell(r, "remark")}</td>
        <td>${planner ? `<button class="btn sm ghost" data-del title="ลบแถว" style="color:var(--crit)">×</button>` : ""}</td></tr>`).join("")
      : `<tr><td colspan="6" class="empty">ยังไม่มีภารกิจในปีงบ ${fy()}${planner ? ' · กด "+ เพิ่มแถว"' : ""}</td></tr>`;
  }
  $("rtafFy").addEventListener("change", renderRtaf);
  $("rtafAdd").addEventListener("click", async () => {
    const rows = rtaf.filter((r) => r.fiscal_year === fy());
    const nums = rows.map((r) => parseInt(String(r.callsign || "").replace(/\D/g, ""), 10)).filter((n) => !isNaN(n));
    const next = { fiscal_year: fy(), seq: Math.max(0, ...rows.map((r) => r.seq)) + 1, callsign: "RTAF" + (nums.length ? Math.max(...nums) + 1 : 301) };
    const { row, error } = await saveRtaf(next);
    if (error) return say($("rtafMsg"), "เพิ่มไม่สำเร็จ: " + error.message, false);
    rtaf.push(row); renderRtaf();
    host.querySelector(`#rtafRows tr[data-id="${row.id}"] [data-f="date_text"]`)?.focus();
  });
  $("rtafRows").addEventListener("change", async (e) => {
    const f = e.target.dataset.f; if (!f) return;
    const r = rtaf.find((x) => x.id === e.target.closest("tr").dataset.id); if (!r) return;
    r[f] = e.target.value.trim();
    const { error } = await saveRtaf(r);
    say($("rtafMsg"), error ? "บันทึกไม่สำเร็จ: " + error.message : `บันทึก ${r.callsign || ""} แล้ว`, !error);
  });
  $("rtafRows").addEventListener("click", async (e) => {
    if (!e.target.matches("[data-del]")) return;
    const id = e.target.closest("tr").dataset.id, r = rtaf.find((x) => x.id === id);
    if (!confirm(`ลบแถว ${r?.callsign || ""}?`)) return;
    const err = await deleteRtaf(id);
    if (err) return say($("rtafMsg"), "ลบไม่สำเร็จ: " + err.message, false);
    rtaf = rtaf.filter((x) => x.id !== id); renderRtaf();
  });

  showTab();
}
