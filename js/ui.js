// =====================================================================
//  ui.js — ส่วนประกอบหน้าจอที่ใช้ร่วมกัน (แถบเมนูด้านบน)
// =====================================================================
import { signOut, canPlan, isAdmin } from "./auth.js";
import { DB_ENV } from "./supabase.js";

const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const LINKS = [
  { href: "home.html",      label: "หน้าหลัก" },
  { href: "dashboard.html", label: "ภารกิจ" },
  { href: "queue.html",     label: "คิวบิน" },
  { href: "crew.html",      label: "ทะเบียนนักบิน" },
  { href: "pilot-month.html", label: "พ." },
  { href: "status.html",    label: "สถานภาพเครื่อง" },
  { href: "stats.html",     label: "สถิติ" },
  { href: "archive.html",   label: "ย้อนหลัง" },
  { href: "https://greensupawich.github.io/flightplan/", label: "Flight Plan ↗", external: true },
  { href: "admin.html",     label: "ผู้ดูแล", adminOnly: true },
];

// ป้ายบอกว่ากำลังต่อฐานไหน (เว็บจริงไม่มีป้าย)
const BADGE = (txt, bg, fg, tip) => `<span title="${tip}" style="margin-inline-start:8px;font-size:11px;font-weight:700;background:${bg};color:${fg};border-radius:5px;padding:2px 7px">${txt}</span>`;
const ENV_BADGE = {
  "dev":        BADGE("DEV", "#f59e0b", "#111", "ต่อฐานทดสอบ (DEV) — ไม่ใช่ข้อมูลจริง"),
  "prod-local": BADGE("ฐานจริง (PROD)", "#ef4444", "#fff", "เปิดจากเครื่อง แต่ต่อฐานข้อมูลจริง — แก้อะไรมีผลกับข้อมูลจริงทันที"),
};

// วาดแถบเมนู แล้วเสียบไว้บนสุดของ body
export function renderTopbar(profile) {
  const here = location.pathname.split("/").pop() || "dashboard.html";
  const links = LINKS
    .filter((l) => !l.adminOnly || isAdmin(profile))
    .map((l) => l.external
      ? `<a href="${l.href}" target="_blank" rel="noopener" title="เปิด Flight Plan Generator ในแท็บใหม่">${l.label}</a>`
      : `<a href="${l.href}" class="${l.href === here ? "active" : ""}">${l.label}</a>`)
    .join("");

  const bar = document.createElement("div");
  bar.className = "topbar";
  bar.innerHTML = `
    <div class="wrap">
      <div class="brand"><span class="mk">🛩️</span> Flight Operation${ENV_BADGE[DB_ENV] || ""}</div>
      <button class="nav-toggle" id="__navToggle" aria-label="เมนู" aria-expanded="false">
        <span></span><span></span><span></span>
      </button>
      <nav class="nav" id="__nav">${links}</nav>
      <div class="userchip">
        <span class="role">${escHtml(profile.role)}</span>
        <span class="uname">${escHtml(profile.full_name || profile.email)}</span>
        <button class="btn sm ghost" id="__signout">ออก</button>
      </div>
    </div>`;
  document.body.prepend(bar);
  document.getElementById("__signout").addEventListener("click", signOut);

  // เมนูมือถือ: กด ☰ เพื่อเปิด/ปิด · ปิดเมื่อคลิกนอกแถบ
  const toggle = document.getElementById("__navToggle");
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = bar.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  });
  document.addEventListener("click", (e) => {
    if (bar.classList.contains("open") && !bar.contains(e.target)) {
      bar.classList.remove("open"); toggle.setAttribute("aria-expanded", "false");
    }
  });
}

export { canPlan, isAdmin };
