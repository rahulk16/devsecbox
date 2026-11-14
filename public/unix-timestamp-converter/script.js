const $ = (id) => document.getElementById(id);

const tzSelect = $("tz");
const unitSelect = $("unit");
const tsInput = $("tsInput");
const tsStatus = $("tsStatus");
const tsGrid = $("tsGrid");
const dateInput = $("dateInput");
const dateStatus = $("dateStatus");
const dateGrid = $("dateGrid");
const nowSec = $("nowSec");
const nowMs = $("nowMs");

// Supported range: years 0001-9999 (keeps ISO 8601 output standard)
const MIN_MS = -62135596800000;
const MAX_MS = 253402300799999;

const UNIT_MS = { s: 1000, ms: 1, us: 1e-3, ns: 1e-6 };
const UNIT_NAME = {
	s: "seconds",
	ms: "milliseconds",
	us: "microseconds",
	ns: "nanoseconds",
};

const LOCAL_ZONE = (() => {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	} catch {
		return "UTC";
	}
})();

const FALLBACK_ZONES = [
	"America/Los_Angeles",
	"America/Denver",
	"America/Chicago",
	"America/New_York",
	"America/Sao_Paulo",
	"Europe/London",
	"Europe/Paris",
	"Europe/Moscow",
	"Africa/Cairo",
	"Asia/Dubai",
	"Asia/Kolkata",
	"Asia/Shanghai",
	"Asia/Tokyo",
	"Australia/Sydney",
	"Pacific/Auckland",
];

// ---------- timezone helpers ----------

const formatters = new Map();

function zoneParts(zone, ms) {
	let f = formatters.get(zone);
	if (!f) {
		f = new Intl.DateTimeFormat("en-US", {
			timeZone: zone,
			hourCycle: "h23",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		formatters.set(zone, f);
	}
	const p = {};
	for (const { type, value } of f.formatToParts(new Date(ms))) {
		if (type !== "literal") p[type] = Number(value);
	}
	return {
		year: p.year,
		month: p.month,
		day: p.day,
		hour: p.hour % 24,
		minute: p.minute,
		second: p.second,
	};
}

// Date.UTC treats years 0-99 as 1900-1999, so set the year explicitly
function utcFromFields(y, mo, d, h, mi, s, ms) {
	const dt = new Date(0);
	dt.setUTCFullYear(y, mo - 1, d);
	dt.setUTCHours(h, mi, s, ms);
	return dt.getTime();
}

function zoneOffsetMs(zone, ms) {
	const p = zoneParts(zone, ms);
	const asUtc = utcFromFields(p.year, p.month, p.day, p.hour, p.minute, p.second, 0);
	return asUtc - Math.floor(ms / 1000) * 1000;
}

// Wall-clock time in a zone -> epoch ms. A time skipped by a DST jump rolls
// forward (like JavaScript's Date); an ambiguous one takes the earlier instant.
function wallToEpoch(zone, f) {
	const guess = utcFromFields(f.year, f.month, f.day, f.hour, f.minute, f.second, f.ms);
	const first = zoneOffsetMs(zone, guess);
	const t = guess - first;
	const second = zoneOffsetMs(zone, t);
	if (second === first) return t;
	const candidate = guess - second;
	return zoneOffsetMs(zone, candidate) === second ? candidate : t;
}

function currentZone() {
	return tzSelect.value === "local" ? LOCAL_ZONE : tzSelect.value;
}

function zoneLabel() {
	return tzSelect.value === "local" ? `${LOCAL_ZONE} (local)` : tzSelect.value;
}

// ---------- formatting ----------

const pad = (n, w = 2) => String(n).padStart(w, "0");

function offsetText(offsetMs, colon = true) {
	const total = Math.round(offsetMs / 60000);
	const sign = total < 0 ? "-" : "+";
	const abs = Math.abs(total);
	return `${sign}${pad(Math.floor(abs / 60))}${colon ? ":" : ""}${pad(abs % 60)}`;
}

function wallText(p) {
	return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const RELATIVE_UNITS = [
	["year", 31557600000],
	["month", 2629800000],
	["day", 86400000],
	["hour", 3600000],
	["minute", 60000],
	["second", 1000],
];

function relativeText(ms) {
	const diff = ms - Date.now();
	if (Math.abs(diff) < 1000) return "just now";
	const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
	for (const [unit, size] of RELATIVE_UNITS) {
		if (Math.abs(diff) >= size) return rtf.format(Math.round(diff / size), unit);
	}
	return "just now";
}

// ---------- parsing ----------

function detectUnit(n) {
	const a = Math.abs(n);
	if (a < 1e11) return "s";
	if (a < 1e14) return "ms";
	if (a < 1e17) return "us";
	return "ns";
}

function parseTimestamp(raw) {
	const text = raw.trim().replace(/[,_\s]/g, "");
	if (!text) return { empty: true };
	if (!/^[+-]?\d+(\.\d+)?$/.test(text)) {
		return { error: "Enter a number, e.g. 1700000000 (seconds) or 1700000000000 (milliseconds)." };
	}
	const n = Number(text);
	const unit = unitSelect.value === "auto" ? detectUnit(n) : unitSelect.value;
	const ms = Math.floor(Number((n * UNIT_MS[unit]).toFixed(3)));
	if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS) {
		return { error: "Out of range. Supported dates are years 0001 to 9999." };
	}
	return { ms, unit, auto: unitSelect.value === "auto" };
}

const DATE_RE =
	/^([+-]?\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

function parseDate(raw) {
	const text = raw.trim();
	if (!text) return { empty: true };
	const m = DATE_RE.exec(text);
	if (!m) {
		return { error: "Use YYYY-MM-DD HH:mm:ss, e.g. 2026-11-14 16:30:00 (an ISO 8601 offset is also accepted)." };
	}
	const f = {
		year: Number(m[1]),
		month: Number(m[2]),
		day: Number(m[3]),
		hour: Number(m[4] || 0),
		minute: Number(m[5] || 0),
		second: Number(m[6] || 0),
		ms: m[7] ? Number(m[7].slice(0, 3).padEnd(3, "0")) : 0,
	};
	if (f.month < 1 || f.month > 12 || f.hour > 23 || f.minute > 59 || f.second > 59) {
		return { error: "One of the date or time fields is out of range." };
	}
	const check = new Date(utcFromFields(f.year, f.month, f.day, 0, 0, 0, 0));
	if (check.getUTCFullYear() !== f.year || check.getUTCMonth() !== f.month - 1 || check.getUTCDate() !== f.day) {
		return { error: "That day does not exist in the given month." };
	}

	let ms;
	let explicitOffset = null;
	if (m[8]) {
		let offsetMin = 0;
		if (m[8].toUpperCase() !== "Z") {
			const digits = m[8].replace(":", "");
			const sign = digits[0] === "-" ? -1 : 1;
			const hh = Number(digits.slice(1, 3));
			const mm = Number(digits.slice(3, 5) || 0);
			if (hh > 23 || mm > 59) return { error: "Invalid UTC offset." };
			offsetMin = sign * (hh * 60 + mm);
		}
		explicitOffset = offsetMin * 60000;
		ms = utcFromFields(f.year, f.month, f.day, f.hour, f.minute, f.second, f.ms) - explicitOffset;
	} else {
		ms = wallToEpoch(currentZone(), f);
	}
	if (!Number.isFinite(ms) || ms < MIN_MS || ms > MAX_MS) {
		return { error: "Out of range. Supported dates are years 0001 to 9999." };
	}
	return { ms, explicitOffset };
}

// ---------- rendering ----------

function setStatus(el, text, isError) {
	el.textContent = text;
	el.classList.toggle("error", Boolean(isError));
}

function renderGrid(grid, rows) {
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
	grid.hidden = rows.length === 0;
}

function isoInZone(p, offsetMs, msPart) {
	const frac = msPart ? `.${pad(msPart, 3)}` : "";
	return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${frac}${offsetText(offsetMs)}`;
}

function describe(ms) {
	const zone = currentZone();
	const offset = zoneOffsetMs(zone, ms);
	const p = zoneParts(zone, ms);
	const weekday = WEEKDAYS[new Date(utcFromFields(p.year, p.month, p.day, 0, 0, 0, 0)).getUTCDay()];
	const msPart = ((ms % 1000) + 1000) % 1000;
	return { offset, p, weekday, msPart };
}

function runTimestamp() {
	const parsed = parseTimestamp(tsInput.value);
	if (parsed.empty) {
		setStatus(tsStatus, "Enter a Unix timestamp, or press Now.", false);
		renderGrid(tsGrid, []);
		return;
	}
	if (parsed.error) {
		setStatus(tsStatus, parsed.error, true);
		renderGrid(tsGrid, []);
		return;
	}

	const { ms } = parsed;
	const { offset, p, weekday, msPart } = describe(ms);
	setStatus(
		tsStatus,
		`${parsed.auto ? "Detected" : "Treated as"} ${UNIT_NAME[parsed.unit]}`,
		false,
	);
	renderGrid(tsGrid, [
		{ label: `Date & time (${zoneLabel()})`, value: `${wallText(p)}${msPart ? "." + pad(msPart, 3) : ""}` },
		{ label: "UTC offset", value: `UTC${offsetText(offset)}` },
		{ label: "Day of week", value: weekday },
		{ label: "UTC", value: new Date(ms).toUTCString() },
		{ label: "ISO 8601 (UTC)", value: new Date(ms).toISOString() },
		{ label: "ISO 8601 (selected zone)", value: isoInZone(p, offset, msPart) },
		{ label: "Relative", value: relativeText(ms) },
		{ label: "Unix seconds", value: String(Math.floor(ms / 1000)) },
		{ label: "Unix milliseconds", value: String(ms) },
	]);
}

function runDate() {
	const parsed = parseDate(dateInput.value);
	if (parsed.empty) {
		setStatus(dateStatus, "Enter a date and time, or press Now.", false);
		renderGrid(dateGrid, []);
		return;
	}
	if (parsed.error) {
		setStatus(dateStatus, parsed.error, true);
		renderGrid(dateGrid, []);
		return;
	}

	const { ms, explicitOffset } = parsed;
	setStatus(
		dateStatus,
		explicitOffset === null
			? `Interpreted in ${zoneLabel()}`
			: `Interpreted with the UTC offset given in the input (${offsetText(explicitOffset)})`,
		false,
	);
	renderGrid(dateGrid, [
		{ label: "Unix seconds", value: String(Math.floor(ms / 1000)) },
		{ label: "Unix milliseconds", value: String(ms) },
		{ label: "ISO 8601 (UTC)", value: new Date(ms).toISOString() },
		{ label: "Relative", value: relativeText(ms) },
	]);
}

function runAll() {
	runTimestamp();
	runDate();
}

// ---------- live clock ----------

function tick() {
	const now = Date.now();
	nowSec.textContent = String(Math.floor(now / 1000));
	nowMs.textContent = String(now);
}

// ---------- copy ----------

async function copyText(btn, text) {
	try {
		await navigator.clipboard.writeText(text);
	} catch (error) {
		console.error("Copy failed:", error);
		return;
	}
	btn.classList.add("copied");
	setTimeout(() => btn.classList.remove("copied"), 1000);
}

// ---------- setup ----------

function buildZones() {
	let zones;
	try {
		zones = Intl.supportedValuesOf("timeZone");
	} catch {
		zones = FALLBACK_ZONES;
	}
	const add = (value, label) => {
		const o = document.createElement("option");
		o.value = value;
		o.textContent = label;
		tzSelect.appendChild(o);
	};
	add("local", `Local (${LOCAL_ZONE})`);
	add("UTC", "UTC");
	for (const z of zones) if (z !== "UTC") add(z, z);
}

function nowAsDateText() {
	const ms = Date.now();
	return wallText(zoneParts(currentZone(), ms));
}

buildZones();

tsInput.addEventListener("input", runTimestamp);
unitSelect.addEventListener("change", runTimestamp);
tzSelect.addEventListener("change", runAll);
dateInput.addEventListener("input", runDate);

$("tsNow").addEventListener("click", () => {
	tsInput.value = String(Math.floor(Date.now() / 1000));
	unitSelect.value = "auto";
	runTimestamp();
});
$("dateNow").addEventListener("click", () => {
	dateInput.value = nowAsDateText();
	runDate();
});
document.querySelectorAll(".chip").forEach((chip) => {
	chip.addEventListener("click", () => {
		tsInput.value = chip.dataset.ex;
		unitSelect.value = "auto";
		runTimestamp();
	});
});
$("clearBtn").addEventListener("click", () => {
	tsInput.value = "";
	dateInput.value = "";
	runAll();
	tsInput.focus();
});

// One delegated handler covers the live clock and both result grids
document.addEventListener("click", (e) => {
	const btn = e.target.closest("button.val");
	if (btn) copyText(btn, btn.textContent);
});

$("year").textContent = new Date().getFullYear();

tick();
setInterval(tick, 250);
tsInput.value = String(Math.floor(Date.now() / 1000));
dateInput.value = nowAsDateText();
runAll();
