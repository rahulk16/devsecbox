const $ = (id) => document.getElementById(id);

const MAX_COUNT = 1000;
const GREGORIAN_OFFSET_MS = 12219292800000n; // 1582-10-15 -> 1970-01-01

const output = $("output");
const statusEl = $("status");
const resultMeta = $("resultMeta");
const countEl = $("count");
const copyBtn = $("copyBtn");
const copyLabel = $("copyLabel");
const nsSelect = $("ns");
const nsCustom = $("nsCustom");
const nameInput = $("nameInput");

const NOTES = {
	v4: "122 random bits. The general-purpose default.",
	v7: "Unix-millisecond timestamp + random bits. Sorts by creation time.",
	v1: "100 ns timestamp + random node ID (not your MAC address).",
	v5: "SHA-1 of namespace + name. The same inputs always give the same UUID.",
	nil: "The all-zero UUID, used as an empty placeholder.",
	max: "The all-one UUID, used as an upper bound.",
};

let version = "v4";

// ---------- byte helpers ----------

function randomBytes(n) {
	const b = new Uint8Array(n);
	crypto.getRandomValues(b);
	return b;
}

function setVersionVariant(b, v) {
	b[6] = (b[6] & 0x0f) | (v << 4);
	b[8] = (b[8] & 0x3f) | 0x80;
	return b;
}

function bytesToHex(b) {
	return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex) {
	const b = new Uint8Array(16);
	for (let i = 0; i < 16; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return b;
}

function hyphenate(hex) {
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Accepts hyphenated, bare, {braced} and urn:uuid: forms; returns 32 hex chars or null
function normalizeUuid(text) {
	let t = text.trim().toLowerCase();
	if (t.startsWith("urn:uuid:")) t = t.slice(9);
	if (t.startsWith("{") && t.endsWith("}")) t = t.slice(1, -1);
	if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(t)) {
		return t.replace(/-/g, "");
	}
	return /^[0-9a-f]{32}$/.test(t) ? t : null;
}

// ---------- generators ----------

function uuidV4() {
	return setVersionVariant(randomBytes(16), 4);
}

// v7 (RFC 9562, method 1): a 12-bit counter in rand_a keeps IDs from one
// batch strictly increasing, even within the same millisecond.
let v7Ms = 0;
let v7Counter = 0;

function uuidV7() {
	const now = Date.now();
	if (now > v7Ms) {
		v7Ms = now;
		// Start below 0x200 so a batch has plenty of counter room in one ms
		v7Counter = randomBytes(2).reduce((a, x) => (a << 8) | x, 0) & 0x1ff;
	} else {
		v7Counter++;
		if (v7Counter > 0xfff) {
			v7Ms++;
			v7Counter = 0;
		}
	}
	const b = randomBytes(16);
	const t = BigInt(v7Ms);
	for (let i = 0; i < 6; i++) b[i] = Number((t >> BigInt(8 * (5 - i))) & 0xffn);
	b[6] = 0x70 | (v7Counter >> 8);
	b[7] = v7Counter & 0xff;
	b[8] = (b[8] & 0x3f) | 0x80;
	return b;
}

// v1: one random node ID and clock sequence per page load, multicast bit set
// (RFC 9562 §6.10) so it can never collide with a real MAC address.
const v1Node = randomBytes(6);
v1Node[0] |= 0x01;
const v1Clock = randomBytes(2);
let v1Last = 0n;

function uuidV1() {
	let ts = (BigInt(Date.now()) + GREGORIAN_OFFSET_MS) * 10000n;
	if (ts <= v1Last) ts = v1Last + 1n;
	v1Last = ts;

	const b = new Uint8Array(16);
	const low = ts & 0xffffffffn;
	const mid = (ts >> 32n) & 0xffffn;
	const hi = (ts >> 48n) & 0x0fffn;
	for (let i = 0; i < 4; i++) b[i] = Number((low >> BigInt(8 * (3 - i))) & 0xffn);
	b[4] = Number(mid >> 8n);
	b[5] = Number(mid & 0xffn);
	b[6] = 0x10 | Number(hi >> 8n);
	b[7] = Number(hi & 0xffn);
	b[8] = 0x80 | (v1Clock[0] & 0x3f);
	b[9] = v1Clock[1];
	b.set(v1Node, 10);
	return b;
}

async function uuidV5(namespaceBytes, name) {
	const data = new TextEncoder().encode(name);
	const input = new Uint8Array(16 + data.length);
	input.set(namespaceBytes, 0);
	input.set(data, 16);
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", input));
	return setVersionVariant(digest.slice(0, 16), 5);
}

// ---------- formatting ----------

function format(bytes) {
	let s = bytesToHex(bytes);
	if (!$("optNoHyphen").checked) s = hyphenate(s);
	if ($("optUpper").checked) s = s.toUpperCase();
	if ($("optBraces").checked) s = `{${s}}`;
	return s;
}

// ---------- generate ----------

function setStatus(el, text, isError) {
	el.textContent = text;
	el.classList.toggle("error", Boolean(isError));
}

function readCount() {
	const n = Math.floor(Number(countEl.value));
	if (!Number.isFinite(n) || n < 1) return 1;
	return Math.min(n, MAX_COUNT);
}

async function generate() {
	setStatus(statusEl, "", false);
	let list = [];

	if (version === "v5") {
		const ns = nsSelect.value === "custom" ? normalizeUuid(nsCustom.value) : normalizeUuid(nsSelect.value);
		if (!ns) {
			return showResult([], "Enter a valid namespace UUID.", true);
		}
		if (!window.crypto || !crypto.subtle) {
			return showResult([], "SHA-1 needs a secure context (HTTPS).", true);
		}
		if (nameInput.value === "") {
			return showResult([], "Enter a name to hash.", false);
		}
		list = [await uuidV5(hexToBytes(ns), nameInput.value)];
	} else if (version === "nil") {
		list = Array.from({ length: readCount() }, () => new Uint8Array(16));
	} else if (version === "max") {
		list = Array.from({ length: readCount() }, () => new Uint8Array(16).fill(0xff));
	} else {
		const make = { v4: uuidV4, v7: uuidV7, v1: uuidV1 }[version];
		list = Array.from({ length: readCount() }, make);
	}
	showResult(list.map(format), "", false);
}

function showResult(lines, message, isError) {
	output.value = lines.join("\n");
	copyBtn.disabled = lines.length === 0;
	resultMeta.textContent = lines.length ? `${lines.length} generated` : "";
	setStatus(statusEl, message, isError);
}

// ---------- inspect ----------

const VERSION_NAMES = {
	1: "Version 1 — Gregorian time + node",
	2: "Version 2 — DCE security",
	3: "Version 3 — MD5 name-based",
	4: "Version 4 — random",
	5: "Version 5 — SHA-1 name-based",
	6: "Version 6 — reordered Gregorian time",
	7: "Version 7 — Unix time + random",
	8: "Version 8 — custom",
};

function variantName(b8) {
	if ((b8 & 0x80) === 0) return "NCS (reserved, backward compatible)";
	if ((b8 & 0xc0) === 0x80) return "RFC 4122 / RFC 9562";
	if ((b8 & 0xe0) === 0xc0) return "Microsoft (reserved)";
	return "Reserved for future use";
}

function timestampOf(ver, hex) {
	let ms;
	if (ver === 7) {
		ms = BigInt("0x" + hex.slice(0, 12));
	} else if (ver === 1 || ver === 6) {
		const ts =
			ver === 1
				? BigInt("0x" + hex.slice(13, 16) + hex.slice(8, 12) + hex.slice(0, 8))
				: BigInt("0x" + hex.slice(0, 8) + hex.slice(8, 12) + hex.slice(13, 16));
		ms = ts / 10000n - GREGORIAN_OFFSET_MS;
	} else {
		return null;
	}
	const d = new Date(Number(ms));
	return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function inspect() {
	const text = $("inspectInput").value;
	const grid = $("inspectGrid");
	const status = $("inspectStatus");
	if (!text.trim()) {
		setStatus(status, "Paste a UUID to see its version, variant and timestamp.", false);
		grid.hidden = true;
		return;
	}
	const hex = normalizeUuid(text);
	if (!hex) {
		setStatus(status, "Not a valid UUID. Expected 32 hex digits, e.g. 550e8400-e29b-41d4-a716-446655440000.", true);
		grid.hidden = true;
		return;
	}

	const b = hexToBytes(hex);
	const ver = b[6] >> 4;
	const rows = [{ label: "Canonical", value: hyphenate(hex) }];
	if (hex === "0".repeat(32)) {
		rows.push({ label: "Type", value: "Nil UUID" });
	} else if (hex === "f".repeat(32)) {
		rows.push({ label: "Type", value: "Max UUID" });
	} else {
		rows.push({ label: "Version", value: VERSION_NAMES[ver] || `Unknown (${ver})` });
		rows.push({ label: "Variant", value: variantName(b[8]) });
		const ts = timestampOf(ver, hex);
		if (ts) rows.push({ label: "Timestamp (UTC)", value: ts });
	}
	rows.push({ label: "Uppercase", value: hyphenate(hex).toUpperCase() });
	rows.push({ label: "No hyphens", value: hex });
	rows.push({ label: "URN", value: `urn:uuid:${hyphenate(hex)}` });

	setStatus(status, "Valid UUID", false);
	grid.textContent = "";
	for (const { label, value } of rows) {
		const item = document.createElement("div");
		item.className = "item";
		const dt = document.createElement("dt");
		dt.textContent = label;
		const dd = document.createElement("dd");
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "val";
		btn.title = "Click to copy";
		btn.textContent = value;
		dd.appendChild(btn);
		item.append(dt, dd);
		grid.appendChild(item);
	}
	grid.hidden = false;
}

// ---------- copy ----------

async function copyText(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch (error) {
		console.error("Copy failed:", error);
		return false;
	}
}

// ---------- events ----------

function setVersion(v) {
	version = v;
	document.querySelectorAll("#versions .mode-btn").forEach((btn) => {
		const on = btn.dataset.v === v;
		btn.classList.toggle("active", on);
		btn.setAttribute("aria-pressed", String(on));
	});
	$("v5Fields").hidden = v !== "v5";
	$("versionNote").textContent = NOTES[v];
	countEl.disabled = v === "v5";
	generate();
}

document.querySelectorAll("#versions .mode-btn").forEach((btn) => {
	btn.addEventListener("click", () => setVersion(btn.dataset.v));
});

nsSelect.addEventListener("change", () => {
	nsCustom.hidden = nsSelect.value !== "custom";
	generate();
});
nsCustom.addEventListener("input", generate);
nameInput.addEventListener("input", generate);

["optUpper", "optNoHyphen", "optBraces"].forEach((id) => $(id).addEventListener("change", generate));
countEl.addEventListener("change", () => {
	countEl.value = readCount();
	generate();
});
$("genBtn").addEventListener("click", generate);

$("clearBtn").addEventListener("click", () => {
	output.value = "";
	copyBtn.disabled = true;
	resultMeta.textContent = "";
	setStatus(statusEl, "", false);
	$("inspectInput").value = "";
	inspect();
});

copyBtn.addEventListener("click", async () => {
	if (!(await copyText(output.value))) return;
	copyLabel.textContent = "Copied";
	copyBtn.classList.add("copied");
	setTimeout(() => {
		copyLabel.textContent = "Copy all";
		copyBtn.classList.remove("copied");
	}, 1300);
});

$("inspectInput").addEventListener("input", inspect);

// Click a value in the inspector to copy it
$("inspectGrid").addEventListener("click", async (e) => {
	const btn = e.target.closest("button.val");
	if (!btn || !(await copyText(btn.textContent))) return;
	btn.classList.add("copied");
	setTimeout(() => btn.classList.remove("copied"), 1000);
});

$("year").textContent = new Date().getFullYear();

if (!window.crypto || !crypto.getRandomValues) {
	setStatus(statusEl, "This browser has no secure random generator, so UUIDs cannot be generated.", true);
	$("genBtn").disabled = true;
} else {
	setVersion("v4");
}
inspect();
