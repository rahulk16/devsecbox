// ---------- parsing ----------

function parseIPv4(str) {
	const parts = str.split(".");
	if (parts.length !== 4) return null;
	let n = 0n;
	for (const p of parts) {
		if (!/^\d{1,3}$/.test(p)) return null;
		const v = Number(p);
		if (v > 255) return null;
		n = (n << 8n) | BigInt(v);
	}
	return n;
}

function parseIPv6(str) {
	if (!/^[0-9a-fA-F:.]+$/.test(str) || str.includes(":::")) return null;
	const halves = str.split("::");
	if (halves.length > 2) return null;

	const toGroups = (s) => (s === "" ? [] : s.split(":"));
	const head = toGroups(halves[0]);
	const tail = halves.length === 2 ? toGroups(halves[1]) : [];

	// An embedded IPv4 tail (e.g. ::ffff:192.0.2.1) counts as two groups
	const last = halves.length === 2 ? tail : head;
	if (last.length && last[last.length - 1].includes(".")) {
		const v4 = parseIPv4(last[last.length - 1]);
		if (v4 === null) return null;
		last.splice(
			last.length - 1,
			1,
			((v4 >> 16n) & 0xffffn).toString(16),
			(v4 & 0xffffn).toString(16),
		);
	}

	const all = head.concat(tail);
	if (!all.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
	if (halves.length === 2 ? all.length > 7 : all.length !== 8) return null;

	const fill = new Array(8 - all.length).fill("0");
	const groups = halves.length === 2 ? [...head, ...fill, ...tail] : head;
	let n = 0n;
	for (const g of groups) n = (n << 16n) | BigInt(parseInt(g, 16));
	return n;
}

function parseInput(raw) {
	let text = raw.trim();
	if (!text) return { empty: true };

	let prefixText = null;
	const slash = text.indexOf("/");
	if (slash !== -1) {
		prefixText = text.slice(slash + 1).trim();
		text = text.slice(0, slash).trim();
	}
	if (text.startsWith("[") && text.endsWith("]")) text = text.slice(1, -1);

	let version;
	let addr;
	if (text.includes(":")) {
		version = 6;
		addr = parseIPv6(text);
	} else {
		version = 4;
		addr = parseIPv4(text);
	}
	if (addr === null) {
		return { error: "Invalid IP address. Use IPv4 (192.168.1.0) or IPv6 (2001:db8::)." };
	}

	const bits = version === 4 ? 32 : 128;
	let prefix = bits;
	if (prefixText !== null) {
		if (!/^\d{1,3}$/.test(prefixText) || Number(prefixText) > bits) {
			return { error: `Prefix length must be a number from 0 to ${bits}.` };
		}
		prefix = Number(prefixText);
	}
	return { version, bits, addr, prefix, hasPrefix: prefixText !== null };
}

// ---------- formatting ----------

function formatIPv4(n) {
	return [24n, 16n, 8n, 0n].map((s) => Number((n >> s) & 0xffn)).join(".");
}

function formatIPv6(n) {
	const groups = [];
	for (let i = 7n; i >= 0n; i--) groups.push(Number((n >> (i * 16n)) & 0xffffn));

	// Compress the longest run of zero groups (length >= 2)
	let bestStart = -1;
	let bestLen = 0;
	for (let i = 0; i < 8; ) {
		if (groups[i] !== 0) {
			i++;
			continue;
		}
		let j = i;
		while (j < 8 && groups[j] === 0) j++;
		if (j - i > bestLen) {
			bestStart = i;
			bestLen = j - i;
		}
		i = j;
	}

	const hex = groups.map((g) => g.toString(16));
	if (bestLen < 2) return hex.join(":");
	const left = hex.slice(0, bestStart).join(":");
	const right = hex.slice(bestStart + bestLen).join(":");
	return `${left}::${right}`;
}

function formatIPv6Full(n) {
	const groups = [];
	for (let i = 7n; i >= 0n; i--) {
		groups.push(((n >> (i * 16n)) & 0xffffn).toString(16).padStart(4, "0"));
	}
	return groups.join(":");
}

function formatCount(n) {
	return n.toLocaleString("en-US");
}

// ---------- classification ----------

function inRange(addr, base, prefix, bits) {
	const shift = BigInt(bits - prefix);
	return addr >> shift === base >> shift;
}

const V4_TYPES = [
	["0.0.0.0", 8, "“This” network (unspecified)"],
	["10.0.0.0", 8, "Private (RFC 1918)"],
	["100.64.0.0", 10, "Shared address space / CGNAT (RFC 6598)"],
	["127.0.0.0", 8, "Loopback"],
	["169.254.0.0", 16, "Link-local"],
	["172.16.0.0", 12, "Private (RFC 1918)"],
	["192.0.0.0", 24, "IETF protocol assignments"],
	["192.0.2.0", 24, "Documentation (TEST-NET-1)"],
	["192.168.0.0", 16, "Private (RFC 1918)"],
	["198.18.0.0", 15, "Benchmarking"],
	["198.51.100.0", 24, "Documentation (TEST-NET-2)"],
	["203.0.113.0", 24, "Documentation (TEST-NET-3)"],
	["224.0.0.0", 4, "Multicast"],
	["240.0.0.0", 4, "Reserved"],
];

const V6_TYPES = [
	["::", 128, "Unspecified"],
	["::1", 128, "Loopback"],
	["::ffff:0:0", 96, "IPv4-mapped"],
	["64:ff9b::", 96, "IPv4/IPv6 translation (NAT64)"],
	["2001:db8::", 32, "Documentation"],
	["2002::", 16, "6to4"],
	["fc00::", 7, "Unique local (ULA)"],
	["fe80::", 10, "Link-local"],
	["ff00::", 8, "Multicast"],
	["2000::", 3, "Global unicast"],
];

function classify(version, network, prefix) {
	const bits = version === 4 ? 32 : 128;
	const table = version === 4 ? V4_TYPES : V6_TYPES;
	const parse = version === 4 ? parseIPv4 : parseIPv6;

	// Use the most specific listed range that fully contains the block
	let found = null;
	let bestPrefix = -1;
	let overlapsSpecial = false;
	for (const [base, entryPrefix, label] of table) {
		const entryBase = parse(base);
		if (entryPrefix <= prefix && inRange(network, entryBase, entryPrefix, bits)) {
			if (entryPrefix > bestPrefix) {
				found = label;
				bestPrefix = entryPrefix;
			}
		} else if (entryPrefix > prefix && inRange(entryBase, network, prefix, bits)) {
			overlapsSpecial = true;
		}
	}
	if (found) return found;
	if (overlapsSpecial) return "Mixed (spans several address ranges)";
	return version === 4 ? "Public" : "Reserved / unassigned";
}

function ipv4Class(addr) {
	const first = Number(addr >> 24n);
	if (first < 128) return "A";
	if (first < 192) return "B";
	if (first < 224) return "C";
	if (first < 240) return "D (multicast)";
	return "E (reserved)";
}

// ---------- calculation ----------

function calculate(p) {
	const { version, bits, addr, prefix } = p;
	const hostBits = BigInt(bits - prefix);
	const allOnes = (1n << BigInt(bits)) - 1n;
	const hostMask = (1n << hostBits) - 1n;
	const mask = allOnes ^ hostMask;
	const network = addr & mask;
	const last = network | hostMask;
	const total = 1n << hostBits;
	const fmt = version === 4 ? formatIPv4 : formatIPv6;

	let firstUsable;
	let lastUsable;
	let usable;
	if (version === 4) {
		if (prefix >= 31) {
			// /31 point-to-point (RFC 3021) and /32 single host: no network/broadcast
			firstUsable = network;
			lastUsable = last;
			usable = total;
		} else {
			firstUsable = network + 1n;
			lastUsable = last - 1n;
			usable = total - 2n;
		}
	} else {
		firstUsable = network;
		lastUsable = last;
		usable = total;
	}

	const rows = [];
	const add = (label, value) => rows.push({ label, value });

	add("CIDR notation", `${fmt(network)}/${prefix}`);
	if (p.hasPrefix && addr !== network) add("Input address", fmt(addr));
	add("Network address", fmt(network));
	if (version === 4) {
		add(
			"Broadcast address",
			prefix === 32 ? "None" : prefix === 31 ? "None (RFC 3021)" : fmt(last),
		);
		add("Subnet mask", formatIPv4(mask));
		add("Wildcard mask", formatIPv4(hostMask));
		add("First usable host", fmt(firstUsable));
		add("Last usable host", fmt(lastUsable));
		add("Total addresses", formatCount(total));
		add("Usable hosts", formatCount(usable));
		add("Prefix length", `/${prefix}`);
		add("IP class", ipv4Class(network));
	} else {
		add("Expanded network", formatIPv6Full(network));
		add("First address", fmt(firstUsable));
		add("Last address", fmt(lastUsable));
		add("Prefix mask", formatIPv6(mask));
		add("Total addresses", formatCount(total));
		add("Prefix length", `/${prefix}`);
	}
	add("Address type", classify(version, network, prefix));
	return { rows, prefix, bits, version };
}

// ---------- UI ----------

const input = document.getElementById("cidr");
const statusEl = document.getElementById("status");
const bitsWrap = document.getElementById("bitsWrap");
const bitsEl = document.getElementById("bits");
const resultsEl = document.getElementById("results");
const gridEl = document.getElementById("grid");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const copyLabel = document.getElementById("copyLabel");

const IDLE_MESSAGE = "Enter a CIDR block such as 192.168.1.0/24";
let current = null;

function setStatus(text, isError) {
	statusEl.textContent = text;
	statusEl.classList.toggle("error", Boolean(isError));
}

function renderBits(version, bits, prefix) {
	bitsEl.textContent = "";
	bitsEl.classList.toggle("v6", version === 6);
	const groupSize = version === 4 ? 8 : 16;
	let group = null;
	for (let i = 0; i < bits; i++) {
		if (i % groupSize === 0) {
			group = document.createElement("span");
			group.className = "bit-group";
			bitsEl.appendChild(group);
		}
		const cell = document.createElement("span");
		cell.className = i < prefix ? "bit net" : "bit host";
		group.appendChild(cell);
	}
}

function renderRows(rows) {
	gridEl.textContent = "";
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
		btn.addEventListener("click", () => copyValue(btn, value));
		dd.appendChild(btn);

		item.append(dt, dd);
		gridEl.appendChild(item);
	}
}

function showResults(result) {
	renderBits(result.version, result.bits, result.prefix);
	renderRows(result.rows);
	bitsWrap.hidden = false;
	resultsEl.hidden = false;
	copyBtn.disabled = false;
}

function hideResults() {
	bitsWrap.hidden = true;
	resultsEl.hidden = true;
	copyBtn.disabled = true;
	current = null;
}

function run() {
	const parsed = parseInput(input.value);
	if (parsed.empty) {
		hideResults();
		setStatus(IDLE_MESSAGE, false);
		return;
	}
	if (parsed.error) {
		hideResults();
		setStatus(parsed.error, true);
		return;
	}
	current = calculate(parsed);
	showResults(current);
	setStatus(
		`IPv${parsed.version} · /${parsed.prefix}${parsed.hasPrefix ? "" : " (no prefix given, treated as a single address)"}`,
		false,
	);
}

async function writeClipboard(text) {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch (error) {
		console.error("Copy failed:", error);
		return false;
	}
}

async function copyValue(btn, value) {
	if (!(await writeClipboard(value))) return;
	btn.classList.add("copied");
	setTimeout(() => btn.classList.remove("copied"), 1000);
}

async function copyAll() {
	if (!current) return;
	const text = current.rows.map((r) => `${r.label}: ${r.value}`).join("\n");
	if (!(await writeClipboard(text))) return;
	copyLabel.textContent = "Copied";
	copyBtn.classList.add("copied");
	setTimeout(() => {
		copyLabel.textContent = "Copy all";
		copyBtn.classList.remove("copied");
	}, 1300);
}

function clearAll() {
	input.value = "";
	run();
	input.focus();
}

// ---------- events ----------
input.addEventListener("input", run);
clearBtn.addEventListener("click", clearAll);
copyBtn.addEventListener("click", copyAll);
document.querySelectorAll(".chip").forEach((chip) => {
	chip.addEventListener("click", () => {
		input.value = chip.dataset.ex;
		run();
	});
});

document.getElementById("year").textContent = new Date().getFullYear();
input.value = "192.168.1.0/24";
run();

