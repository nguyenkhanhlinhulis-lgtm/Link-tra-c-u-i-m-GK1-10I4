/* ==========================================================================
   Tra cứu điểm – app.js
   Dùng chung cho index.html (tra cứu) và admin.html (cập nhật dữ liệu).
   Không cần máy chủ: dữ liệu nằm trong data.json, mỗi học sinh được mã hoá
   bằng khoá suy ra từ "họ tên + ngày sinh" (PBKDF2-SHA256 → AES-GCM).
   ========================================================================== */

/* ---------- CẤU HÌNH ---------- */
const CONFIG = {
  dataUrl: "data.json",
  // SHA-256 của mật khẩu trang quản trị. Mặc định: "doimatkhau10i4"
  // Đổi mật khẩu: xem hướng dẫn trong README.md (mục "Đổi mật khẩu").
  adminPasswordHash: "6caefd8aae73976ac949eb887a69b3a913cc20bb8fef697406d32b17104646c0",
  pbkdf2Iterations: 150000,
  // Các cột KHÔNG đưa lên trang tra cứu (so khớp không phân biệt hoa thường)
  hiddenColumns: ["stt", "mã định danh", "ma dinh danh", "đối chiếu"],
};

/* ---------- LÕI DÙNG CHUNG ---------- */
const Core = (() => {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const subtle = globalThis.crypto.subtle;

  function normalizeName(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Trả về "dd/mm/yyyy" hoặc null nếu không hợp lệ
  function normalizeDob(v) {
    if (v === null || v === undefined || v === "") return null;
    let d, m, y;
    if (v instanceof Date && !isNaN(v)) {
      d = v.getDate(); m = v.getMonth() + 1; y = v.getFullYear();
    } else if (typeof v === "number" && v > 20000 && v < 80000) {
      // số sê-ri ngày của Excel
      const dt = new Date(Math.round((v - 25569) * 86400000));
      d = dt.getUTCDate(); m = dt.getUTCMonth() + 1; y = dt.getUTCFullYear();
    } else {
      const s = String(v).trim();
      let mt = s.match(/^(\d{1,2})\s*[\/\-.\s]\s*(\d{1,2})\s*[\/\-.\s]\s*(\d{4})$/);
      if (mt) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
      else if ((mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
      else if ((mt = s.match(/^(\d{2})(\d{2})(\d{4})$/))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
      else return null;
    }
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
    const test = new Date(y, m - 1, d);
    if (test.getMonth() !== m - 1) return null;
    return String(d).padStart(2, "0") + "/" + String(m).padStart(2, "0") + "/" + y;
  }

  const b64 = {
    enc: (buf) => {
      const bytes = new Uint8Array(buf);
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return btoa(s);
    },
    dec: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
  };
  const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

  // Suy ra (id tra cứu, khoá AES) từ họ tên + ngày sinh
  async function deriveKeys(name, dob, saltB64, iterations) {
    const secret = normalizeName(name) + "|" + dob;
    const base = await subtle.importKey("raw", enc.encode(secret), "PBKDF2", false, ["deriveBits"]);
    const bits = await subtle.deriveBits(
      { name: "PBKDF2", hash: "SHA-256", salt: b64.dec(saltB64), iterations },
      base, 512
    );
    const key = await subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
    return { id: hex(bits.slice(32, 64)), key };
  }

  async function encryptRecord(record, saltB64, iterations) {
    const { id, key } = await deriveKeys(record.n, record.d, saltB64, iterations);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const ct = await subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(record)));
    return { id, iv: b64.enc(iv), ct: b64.enc(ct) };
  }

  async function lookup(db, name, dob) {
    const { id, key } = await deriveKeys(name, dob, db.salt, db.iterations);
    const hit = db.records.find((r) => r.id === id);
    if (!hit) return null;
    const pt = await subtle.decrypt({ name: "AES-GCM", iv: b64.dec(hit.iv) }, key, b64.dec(hit.ct));
    return JSON.parse(dec.decode(pt));
  }

  async function buildDatabase(students, meta, onProgress) {
    const salt = b64.enc(globalThis.crypto.getRandomValues(new Uint8Array(16)));
    const iterations = CONFIG.pbkdf2Iterations;
    const records = [];
    for (let i = 0; i < students.length; i++) {
      records.push(await encryptRecord(students[i], salt, iterations));
      if (onProgress) onProgress(i + 1, students.length);
    }
    // xáo trộn để thứ tự không lộ thứ tự danh sách lớp
    for (let i = records.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [records[i], records[j]] = [records[j], records[i]];
    }
    return {
      format: "tracuu-diem/v1",
      title: meta.title || "Tra cứu điểm",
      className: meta.className || "",
      schoolYear: meta.schoolYear || "",
      term: meta.term || "",
      updatedAt: new Date().toISOString(),
      count: records.length,
      kdf: "PBKDF2-SHA256",
      cipher: "AES-256-GCM",
      iterations,
      salt,
      records,
    };
  }

  async function sha256Hex(text) {
    return hex(await subtle.digest("SHA-256", enc.encode(text)));
  }

  /* --- Định dạng giá trị điểm để hiển thị --- */
  // Tách "10,9.5" → ["10","9,5"]; số 5.25 → ["5,25"]
  function scoreTokens(v, single = false) {
    if (v === null || v === undefined || v === "") return [];
    if (typeof v === "number") return [String(Math.round(v * 100) / 100).replace(".", ",")];
    const s = String(v).trim();
    if (/[a-zA-ZÀ-ỹ]{2,}/.test(s)) return null; // là chữ (nhận xét), không phải điểm
    if (single) return [s.replace(".", ",")];
    return s.split(/[;,]\s*|\s{2,}/).map((t) => t.trim()).filter(Boolean).map((t) => t.replace(".", ","));
  }
  const isLow = (tok) => {
    const n = parseFloat(String(tok).replace(",", "."));
    return !isNaN(n) && n < 5;
  };

  return { normalizeName, normalizeDob, deriveKeys, encryptRecord, lookup, buildDatabase, sha256Hex, scoreTokens, isLow, b64 };
})();

/* ---------- ĐỌC FILE EXCEL / CSV / JSON (dùng ở trang quản trị) ---------- */
const Parser = (() => {
  const isHidden = (label) => {
    const l = String(label || "").toLowerCase();
    return CONFIG.hiddenColumns.some((h) => l.includes(h));
  };
  const isNote = (label) => /nhận xét|ghi chú|nhan xet|ghi chu/i.test(String(label || ""));
  const clean = (v) => (typeof v === "string" ? v.trim() : v);
  const empty = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");

  function subjectFromSheet(title) {
    let s = String(title).replace(/\s*[-–]\s*HK\s*\d.*$/i, "").replace(/\s+\d{1,2}[A-Z]\d*\s*$/i, "").trim();
    const map = { "Hóa": "Hóa học", "Hoá": "Hóa học", "Lý": "Vật lí", "Văn": "Ngữ văn", "Anh": "Tiếng Anh", "Sử": "Lịch sử", "Sinh": "Sinh học" };
    return map[s] || s;
  }

  // Gộp nhiều môn vào từng học sinh, khoá = tên chuẩn hoá + ngày sinh
  function makeStore() {
    const map = new Map();
    const warnings = [];
    return {
      map, warnings,
      add(name, dobRaw, subject, items, notes, where) {
        const dob = Core.normalizeDob(dobRaw);
        if (empty(name)) return;
        if (!dob) { warnings.push(`${where}: "${name}" có ngày sinh không hợp lệ (${dobRaw ?? "trống"}) – đã bỏ qua.`); return; }
        const k = Core.normalizeName(name) + "|" + dob;
        if (!map.has(k)) map.set(k, { n: String(name).trim().replace(/\s+/g, " "), d: dob, s: [] });
        const st = map.get(k);
        if (st.s.some((x) => x.name === subject)) {
          warnings.push(`${where}: "${name}" (${dob}) xuất hiện hai lần trong môn ${subject} – giữ dòng đầu tiên.`);
          return;
        }
        st.s.push({ name: subject, items, notes });
      },
    };
  }

  function fromWorkbook(wb) {
    const store = makeStore();
    wb.SheetNames.forEach((sn) => {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null });
      const hi = rows.findIndex((r) => r && r.some((c) => /họ và tên|ho va ten|họ tên/i.test(String(c || ""))));
      if (hi < 0) { store.warnings.push(`Sheet "${sn}": không thấy cột "Họ và tên" – bỏ qua sheet này.`); return; }
      const header = rows[hi].map((c) => (c === null ? "" : String(c).trim()));
      const iName = header.findIndex((h) => /họ và tên|ho va ten|họ tên/i.test(h));
      const iDob = header.findIndex((h) => /ngày sinh|ngay sinh/i.test(h));
      if (iDob < 0) { store.warnings.push(`Sheet "${sn}": không thấy cột "Ngày sinh" – bỏ qua sheet này.`); return; }
      const subject = subjectFromSheet(sn);
      for (let r = hi + 1; r < rows.length; r++) {
        const row = rows[r] || [];
        if (empty(row[iName]) || empty(row[iDob])) continue;
        const items = [], notes = [];
        header.forEach((h, c) => {
          if (c === iName || c === iDob || !h || isHidden(h)) return;
          const v = clean(row[c]);
          if (empty(v)) return;
          (isNote(h) ? notes : items).push({ label: h, value: v });
        });
        store.add(row[iName], row[iDob], subject, items, notes, `Sheet "${sn}", dòng ${r + 1}`);
      }
    });
    return finish(store);
  }

  // CSV dạng dọc: Họ và tên,Ngày sinh,Môn học,Cột,Giá trị
  function fromCsv(text) {
    const wb = XLSX.read(text, { type: "string", raw: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    const h = (rows[0] || []).map((c) => Core.normalizeName(c));
    const idx = (k) => h.findIndex((x) => x.includes(k));
    const iN = idx("ho va ten"), iD = idx("ngay sinh"), iS = idx("mon"), iC = idx("cot"), iV = idx("gia tri");
    if ([iN, iD, iS, iC, iV].some((i) => i < 0)) throw new Error('CSV cần đủ 5 cột: "Họ và tên, Ngày sinh, Môn học, Cột, Giá trị". Tải file mẫu để xem.');
    const grouped = new Map();
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]; if (!row || empty(row[iN])) continue;
      const key = row[iN] + "§" + row[iD] + "§" + row[iS];
      if (!grouped.has(key)) grouped.set(key, { name: row[iN], dob: row[iD], subject: String(row[iS]).trim(), items: [], notes: [], line: r + 1 });
      const g = grouped.get(key);
      const label = String(row[iC] || "").trim(), v = clean(row[iV]);
      if (!label || empty(v) || isHidden(label)) continue;
      (isNote(label) ? g.notes : g.items).push({ label, value: v });
    }
    const store = makeStore();
    grouped.forEach((g) => store.add(g.name, g.dob, g.subject, g.items, g.notes, `CSV dòng ${g.line}`));
    return finish(store);
  }

  // JSON gốc (không mã hoá) do chính trang này xuất ra
  function fromPlainJson(obj) {
    if (obj && obj.records && obj.salt) throw new Error("Đây là data.json đã mã hoá – không đọc ngược được. Hãy nhập file Excel/CSV gốc hoặc file JSON gốc (chưa mã hoá).");
    const list = Array.isArray(obj) ? obj : obj.students;
    if (!Array.isArray(list)) throw new Error('JSON gốc phải có dạng { "students": [ ... ] }.');
    const store = makeStore();
    list.forEach((st, i) => (st.s || st.subjects || []).forEach((sub) =>
      store.add(st.n || st.name, st.d || st.dob, sub.name, sub.items || [], sub.notes || [], `JSON học sinh #${i + 1}`)));
    return finish(store);
  }

  function finish(store) {
    const students = [...store.map.values()].sort((a, b) =>
      a.n.split(" ").pop().localeCompare(b.n.split(" ").pop(), "vi") || a.n.localeCompare(b.n, "vi"));
    const subjects = [...new Set(students.flatMap((s) => s.s.map((x) => x.name)))];
    // học sinh thiếu môn (thường do sai chính tả tên/ngày sinh ở một sheet)
    students.forEach((st) => {
      const missing = subjects.filter((x) => !st.s.some((y) => y.name === x));
      if (missing.length && missing.length < subjects.length)
        store.warnings.push(`"${st.n}" (${st.d}) không có dữ liệu môn: ${missing.join(", ")}. Kiểm tra họ tên/ngày sinh ở các sheet đó có gõ khác không.`);
    });
    students.forEach((st) => st.s.sort((a, b) => subjects.indexOf(a.name) - subjects.indexOf(b.name)));
    return { students, subjects, warnings: store.warnings };
  }

  return { fromWorkbook, fromCsv, fromPlainJson };
})();

/* ---------- HIỂN THỊ (dùng chung) ---------- */
const View = (() => {
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function chips(value, single = false) {
    const toks = Core.scoreTokens(value, single);
    if (toks === null) return `<span class="text-ink">${esc(value)}</span>`;
    return toks.map((t) => `<span class="chip ${Core.isLow(t) ? "chip-low" : ""}">${esc(t)}</span>`).join("");
  }
  const isMidterm = (label) => /giữa kỳ|giua ky|gk\b|ddggk|đđggk/i.test(label);

  function subjectBlock(sub) {
    const mid = sub.items.filter((i) => isMidterm(i.label));
    const regular = sub.items.filter((i) => !isMidterm(i.label));
    const regHtml = regular.length
      ? regular.map((i) => `<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-0.5"><span class="text-muted text-sm min-w-[7.5rem]">${esc(i.label)}</span><span class="flex flex-wrap gap-1">${chips(i.value)}</span></div>`).join("")
      : `<span class="text-muted text-sm">Chưa có điểm</span>`;
    const midHtml = mid.length ? mid.map((i) => chips(i.value, true)).join("") : `<span class="text-muted text-sm">—</span>`;
    const noteHtml = sub.notes.length
      ? `<div class="note">${sub.notes.map((n) => `<p><span class="font-semibold">${esc(n.label)}:</span> ${esc(n.value)}</p>`).join("")}</div>` : "";
    return `
      <section class="subject">
        <h3 class="subject-name">${esc(sub.name)}</h3>
        <div class="subject-regular">${regHtml}</div>
        <div class="subject-mid"><span class="sm:hidden inline-block text-muted text-sm min-w-[7.5rem] mr-2">Giữa kỳ</span>${midHtml}</div>
        ${noteHtml}
      </section>`;
  }

  function resultCard(st, db) {
    const meta = [db.className && `Lớp ${esc(db.className)}`, db.term && esc(db.term), db.schoolYear && `năm học ${esc(db.schoolYear)}`].filter(Boolean).join(", ");
    return `
      <article class="report" aria-live="polite">
        <header class="report-head">
          <div>
            <p class="text-muted text-sm">${meta}</p>
            <h2 class="report-name">${esc(st.n)}</h2>
            <p class="text-ink/80">Ngày sinh ${esc(st.d)}</p>
          </div>
          <button type="button" onclick="window.print()" class="btn-ghost no-print">In bảng điểm</button>
        </header>
        <div class="subject subject-headrow" aria-hidden="true">
          <span>Môn học</span><span>Điểm thường xuyên</span><span class="text-right">Giữa kỳ</span>
        </div>
        ${st.s.map(subjectBlock).join("")}
        <footer class="report-foot">
          Điểm dưới 5 được tô đỏ. Dữ liệu cập nhật ngày ${new Date(db.updatedAt).toLocaleDateString("vi-VN")}.
          Nếu phát hiện sai sót, Quý phụ huynh vui lòng liên hệ giáo viên chủ nhiệm.
        </footer>
      </article>`;
  }

  return { esc, chips, resultCard };
})();

/* ---------- TRANG TRA CỨU ---------- */
function initLookupPage() {
  const $ = (id) => document.getElementById(id);
  const form = $("lookup-form"), out = $("result"), btn = $("btn-search"), dobInput = $("dob"), nameInput = $("name");
  const btnLabel = btn.querySelector(".btn-label") || btn;
  const idleText = btnLabel.textContent;
  let dbPromise = null;
  const loadDb = () => (dbPromise ||= fetch(CONFIG.dataUrl, { cache: "no-store" }).then((r) => {
    if (!r.ok) throw new Error("Không tải được dữ liệu điểm (data.json).");
    return r.json();
  }));

  loadDb().then((db) => {
    const bits = [db.className && `Lớp ${db.className}`, db.schoolYear && `Năm học ${db.schoolYear}`].filter(Boolean);
    if (bits.length && $("class-line")) $("class-line").textContent = bits.join(", ");
    if ($("updated-line")) $("updated-line").textContent = `Dữ liệu cập nhật ngày ${new Date(db.updatedAt).toLocaleDateString("vi-VN")}.`;
  }).catch(() => {});

  // đánh dấu ô nhập bị lỗi
  const setInvalid = (input, bad) => {
    input.setAttribute("aria-invalid", bad ? "true" : "false");
    input.closest(".field")?.classList.toggle("is-invalid", !!bad);
  };
  [nameInput, dobInput].forEach((el) => el.addEventListener("input", () => setInvalid(el, false)));

  // tự chèn dấu "/" khi gõ ngày sinh
  dobInput.addEventListener("input", (e) => {
    if (e.inputType && e.inputType.startsWith("delete")) return;
    let v = dobInput.value.replace(/[^\d]/g, "").slice(0, 8);
    if (v.length >= 5) v = v.slice(0, 2) + "/" + v.slice(2, 4) + "/" + v.slice(4);
    else if (v.length >= 3) v = v.slice(0, 2) + "/" + v.slice(2);
    dobInput.value = v;
  });

  const message = (kind, title, body) => {
    out.innerHTML = `<div class="msg msg-${kind}" role="alert"><p class="font-semibold">${title}</p><p class="mt-1">${body}</p></div>`;
  };

  // nút "Nhập lại"
  const resetBtn = $("btn-reset");
  if (resetBtn) resetBtn.addEventListener("click", () => {
    form.reset(); out.innerHTML = "";
    [nameInput, dobInput].forEach((el) => setInvalid(el, false));
    nameInput.focus();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const dob = Core.normalizeDob(dobInput.value);
    if (Core.normalizeName(name).split(" ").length < 2) {
      setInvalid(nameInput, true); nameInput.focus();
      return message("warn", "Chưa nhập đủ họ và tên học sinh.", "Quý phụ huynh vui lòng nhập đầy đủ họ, tên đệm và tên, ví dụ: Nguyễn Văn An.");
    }
    if (!dob) {
      setInvalid(dobInput, true); dobInput.focus();
      return message("warn", "Ngày sinh chưa đúng định dạng.", "Quý phụ huynh vui lòng nhập theo ngày/tháng/năm, ví dụ: 01/01/2010.");
    }
    btn.disabled = true; btnLabel.textContent = "Đang tra cứu…";
    try {
      const db = await loadDb();
      const st = await Core.lookup(db, name, dob);
      if (!st) {
        setInvalid(nameInput, true); setInvalid(dobInput, true);
        message("error", "Không tìm thấy học sinh.",
          `Không có học sinh nào khớp với họ tên <b>${View.esc(name)}</b> và ngày sinh <b>${dob}</b>. Quý phụ huynh vui lòng kiểm tra lại chính tả họ tên và ngày sinh rồi tra cứu lại.`);
      } else {
        out.innerHTML = View.resultCard(st, db);
        out.querySelector(".report").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      }
    } catch (err) {
      message("error", "Chưa tra cứu được.", View.esc(err.message) + " Quý phụ huynh vui lòng tải lại trang và thử lại.");
    } finally {
      btn.disabled = false; btnLabel.textContent = idleText;
    }
  });
}

/* ---------- TRANG QUẢN TRỊ ---------- */
function initAdminPage() {
  const $ = (id) => document.getElementById(id);
  let parsed = null, built = null;

  // --- đăng nhập ---
  const unlock = () => { $("gate").classList.add("hidden"); $("panel").classList.remove("hidden"); loadCurrentInfo(); };
  if (sessionStorage.getItem("admin-ok") === "1") unlock();
  $("gate-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const h = await Core.sha256Hex($("password").value);
    if (h === CONFIG.adminPasswordHash) { sessionStorage.setItem("admin-ok", "1"); unlock(); }
    else { $("gate-error").textContent = "Sai mật khẩu."; $("password").select(); }
  });
  $("btn-logout").addEventListener("click", () => { sessionStorage.removeItem("admin-ok"); location.reload(); });

  // --- thông tin data.json đang đăng ---
  async function loadCurrentInfo() {
    try {
      const db = await fetch(CONFIG.dataUrl, { cache: "no-store" }).then((r) => r.json());
      $("current-info").innerHTML = `Đang đăng: <b>${db.count}</b> học sinh${db.className ? `, lớp <b>${View.esc(db.className)}</b>` : ""}, cập nhật ${new Date(db.updatedAt).toLocaleString("vi-VN")}.`;
      ["title", "className", "term", "schoolYear"].forEach((k) => { if (db[k] && !$("meta-" + k).value) $("meta-" + k).value = db[k]; });
    } catch { $("current-info").textContent = "Chưa có data.json trên trang (hoặc đang mở file trực tiếp, không qua máy chủ)."; }
  }

  // --- nhập file ---
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("is-over"); }));
  drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]));
  $("file").addEventListener("change", (e) => e.target.files[0] && handleFile(e.target.files[0]));

  async function handleFile(file) {
    $("file-name").textContent = file.name;
    try {
      const ext = file.name.split(".").pop().toLowerCase();
      if (ext === "json") parsed = Parser.fromPlainJson(JSON.parse(await file.text()));
      else if (ext === "csv") parsed = Parser.fromCsv(await file.text());
      else parsed = Parser.fromWorkbook(XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true }));
      built = null;
      renderPreview();
    } catch (err) {
      parsed = null;
      $("preview").innerHTML = `<div class="msg msg-error"><p class="font-semibold">Không đọc được file.</p><p class="mt-1">${View.esc(err.message)}</p></div>`;
      $("step-publish").classList.add("hidden");
    }
  }

  function renderPreview() {
    const { students, subjects, warnings } = parsed;
    const cell = (st, sub) => {
      const x = st.s.find((y) => y.name === sub);
      if (!x) return `<td class="pv-missing">thiếu</td>`;
      const parts = x.items.map((i) => `<div><span class="text-muted">${View.esc(i.label)}:</span> ${View.esc(i.value)}</div>`);
      x.notes.forEach((n) => parts.push(`<div class="italic text-muted">${View.esc(n.label)}: ${View.esc(n.value)}</div>`));
      return `<td>${parts.join("") || '<span class="text-muted">trống</span>'}</td>`;
    };
    $("preview").innerHTML = `
      <p class="mb-3"><b>${students.length}</b> học sinh, <b>${subjects.length}</b> môn: ${subjects.map(View.esc).join(", ")}.</p>
      ${warnings.length ? `<div class="msg msg-warn mb-4"><p class="font-semibold">${warnings.length} điểm cần kiểm tra</p><ul class="list-disc pl-5 mt-1 space-y-0.5">${warnings.map((w) => `<li>${View.esc(w)}</li>`).join("")}</ul></div>` : `<div class="msg msg-ok mb-4">Không phát hiện trùng lặp hay thiếu dữ liệu.</div>`}
      <div class="pv-wrap"><table class="pv">
        <thead><tr><th class="pv-sticky">Họ và tên</th><th>Ngày sinh</th>${subjects.map((s) => `<th>${View.esc(s)}</th>`).join("")}</tr></thead>
        <tbody>${students.map((st) => `<tr><td class="pv-sticky font-medium">${View.esc(st.n)}</td><td class="whitespace-nowrap">${st.d}</td>${subjects.map((s) => cell(st, s)).join("")}</tr>`).join("")}</tbody>
      </table></div>`;
    $("step-publish").classList.remove("hidden");
    $("build-status").textContent = "";
    $("after-build").classList.add("hidden");
  }

  // --- tạo data.json ---
  $("btn-build").addEventListener("click", async () => {
    if (!parsed) return;
    const meta = { title: $("meta-title").value.trim(), className: $("meta-className").value.trim(), term: $("meta-term").value.trim(), schoolYear: $("meta-schoolYear").value.trim() };
    $("btn-build").disabled = true;
    built = await Core.buildDatabase(parsed.students, meta, (i, n) => { $("build-status").textContent = `Đang mã hoá ${i}/${n} học sinh…`; });
    $("btn-build").disabled = false;
    $("build-status").textContent = `Đã tạo xong data.json (${built.count} học sinh).`;
    $("after-build").classList.remove("hidden");
  });

  const download = (name, text, type = "application/json") => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $("btn-download").addEventListener("click", () => built && download("data.json", JSON.stringify(built)));
  $("btn-backup").addEventListener("click", () => parsed && download("du-lieu-goc-KHONG-DANG-LEN.json", JSON.stringify({ students: parsed.students }, null, 1)));
  $("btn-template").addEventListener("click", () => download("mau-nhap-diem.csv",
    "\uFEFFHọ và tên,Ngày sinh,Môn học,Cột,Giá trị\nNguyễn Văn An,01/01/2010,Toán,Giữa kỳ (ĐĐGgk),7.5\nNguyễn Văn An,01/01/2010,Toán,ĐĐGtx,\"10,9\"\nNguyễn Văn An,01/01/2010,Toán,Ghi chú,Tích cực phát biểu\n", "text/csv"));

  // --- thử tra cứu trên bản vừa tạo ---
  $("test-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const out = $("test-result");
    if (!built) { out.textContent = "Hãy bấm “Tạo data.json” trước."; return; }
    const dob = Core.normalizeDob($("test-dob").value);
    if (!dob) { out.textContent = "Ngày sinh chưa đúng định dạng."; return; }
    const st = await Core.lookup(built, $("test-name").value, dob);
    out.innerHTML = st ? View.resultCard(st, built) : `<div class="msg msg-error">Không tìm thấy – kiểm tra họ tên và ngày sinh.</div>`;
  });
}

/* ---------- KHỞI ĐỘNG ---------- */
if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", () => {
    const page = document.body.dataset.page;
    if (page === "lookup") initLookupPage();
    if (page === "admin") initAdminPage();
  });
}
if (typeof module !== "undefined") module.exports = { Core, CONFIG };
