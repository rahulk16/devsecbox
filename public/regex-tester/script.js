const $ = (id) => document.getElementById(id);

const patternEl = $("pattern");
const patternRow = document.querySelector(".pattern-row");
const flagsOut = $("flagsOut");
const flagBoxes = document.querySelectorAll(".flags input");
const textEl = $("text");
const highlightEl = $("highlight");
const statusEl = $("status");
const matchesWrap = $("matchesWrap");
const matchesEl = $("matches");
const matchesLabel = $("matchesLabel");
const replEl = $("replacement");
const replacedEl = $("replaced");
const matchCount = $("matchCount");
const groupCount = $("groupCount");
const timeCount = $("timeCount");

const MAX_MATCHES = 1000;
const MAX_LIST = 100;

const EXAMPLES = {
	email: {
		p: "[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+",
		f: "gi",
		t: "Contact: jane.doe@example.com, support@devsecbox.fyi, not-an-email@",
	},
	url: {
		p: "https?:\\/\\/[^\\s/$.?#][^\\s]*",
		f: "gi",
		t: "Docs at https://devsecbox.fyi/regex-tester/ and http://example.com/a?b=1.",
	},
	ipv4: {
		p: "\\b(?:(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)\\b",
		f: "g",
		t: "Hosts: 192.168.1.10, 10.0.0.255, 256.1.1.1, 8.8.8.8",
	},
	date: {
		p: "(\\d{4})-(\\d{2})-(\\d{2})",
		f: "g",
		t: "Released 2024-03-15, patched 2024-04-02, expires 2026-12-31.",
	},
	hex: {
		p: "#(?:[0-9a-f]{3}){1,2}\\b",
		f: "gi",
		t: "Colors: #fff, #1A2B3C, #12345, #00ff7f",
	},
	named: {
		p: "(?<key>\\w+)=(?<value>[^&\\s]+)",
		f: "g",
		t: "?user=jane&role=admin&token=abc123",
	},
};

// ---------- helpers ----------

function getFlags() {
	return Array.from(flagBoxes)
		.filter((b) => b.checked)
		.map((b) => b.value)
		.join("");
}

function setStatus(text, state) {
	statusEl.textContent = text;
	["ok", "warn", "bad"].forEach((s) =>
		statusEl.classList.toggle(s, state === s),
	);
}

function setBox(el, text, state) {
	el.textContent = text;
	el.classList.toggle("empty", state === "empty");
	el.classList.toggle("error", state === "error");
}

function updateMeta(m, g, ms) {
	matchCount.textContent = `Matches: ${m}`;
	groupCount.textContent = `Groups: ${g}`;
	timeCount.textContent = `Time: ${ms} ms`;
}

function showEmpty(msg) {
	setBox(highlightEl, "Matches will be highlighted here", "empty");
	setBox(replacedEl, "Replace result will appear here", "empty");
	matchesWrap.hidden = true;
	matchesEl.textContent = "";
	updateMeta(0, 0, 0);
	setStatus(msg);
}

// Collect matches with a manual exec loop so zero-length matches never loop
// forever and the sticky/non-global flags behave like the real engine.
function collect(re, text) {
	const out = [];
	let truncated = false;
	if (!re.global && !re.sticky) {
		const m = re.exec(text);
		if (m) out.push(m);
		return { out, truncated };
	}
	re.lastIndex = 0;
	let m;
	while ((m = re.exec(text)) !== null) {
		out.push(m);
		if (m[0] === "") re.lastIndex++;
		if (!re.global) break;
		if (out.length >= MAX_MATCHES) {
			truncated = true;
			break;
		}
	}
	return { out, truncated };
}

function renderHighlight(text, matches) {
	highlightEl.textContent = "";
	highlightEl.classList.remove("empty", "error");
	let last = 0;
	matches.forEach((m, i) => {
		if (m.index > last)
			highlightEl.appendChild(
				document.createTextNode(text.slice(last, m.index)),
			);
		const mk = document.createElement("mark");
		if (i % 2) mk.classList.add("alt");
		if (m[0] === "") {
			mk.classList.add("zero");
		} else {
			mk.textContent = m[0];
		}
		highlightEl.appendChild(mk);
		last = m.index + m[0].length;
	});
	if (last < text.length)
		highlightEl.appendChild(document.createTextNode(text.slice(last)));
	if (text.endsWith("\n"))
		highlightEl.appendChild(document.createTextNode("\n"));
}

function renderMatches(matches, truncated) {
	matchesEl.textContent = "";
	matchesLabel.textContent = `Matches (${matches.length}${truncated ? "+" : ""})`;
	matches.slice(0, MAX_LIST).forEach((m, i) => {
		const row = document.createElement("div");
		row.className = "match";

		const head = document.createElement("div");
		head.className = "match-head";
		const n = document.createElement("span");
		n.className = "match-n";
		n.textContent = `#${i + 1}`;
		const val = document.createElement("span");
		val.className = "match-val";
		val.textContent = m[0] === "" ? "(empty match)" : m[0];
		const pos = document.createElement("span");
		pos.className = "match-pos";
		pos.textContent = `index ${m.index}–${m.index + m[0].length}`;
		head.append(n, val, pos);
		row.appendChild(head);

		const named = m.groups ? Object.keys(m.groups) : [];
		if (m.length > 1) {
			const g = document.createElement("div");
			g.className = "groups";
			for (let k = 1; k < m.length; k++) {
				const key = document.createElement("span");
				key.className = "g-key";
				const name = named.find(
					(nm) => m.groups[nm] === m[k] && !g.dataset["n" + nm],
				);
				if (name) g.dataset["n" + name] = "1";
				key.textContent = name ? `${k} <${name}>` : `${k}`;
				const v = document.createElement("span");
				v.className = "g-val";
				if (m[k] === undefined) {
					v.textContent = "undefined";
					v.classList.add("undef");
				} else {
					v.textContent = m[k] === "" ? "(empty)" : m[k];
				}
				g.append(key, v);
			}
			row.appendChild(g);
		}
		matchesEl.appendChild(row);
	});
	if (matches.length > MAX_LIST) {
		const more = document.createElement("div");
		more.className = "more";
		more.textContent = `Showing the first ${MAX_LIST} matches.`;
		matchesEl.appendChild(more);
	}
	matchesWrap.hidden = matches.length === 0;
}

// ---------- main ----------

function run() {
	const pattern = patternEl.value;
	const flags = getFlags();
	flagsOut.textContent = flags;
	patternRow.classList.remove("bad");
	const text = textEl.value;

	if (!pattern) {
		showEmpty("Enter a pattern and some text to test.");
		return;
	}

	let re;
	try {
		re = new RegExp(pattern, flags);
	} catch (e) {
		patternRow.classList.add("bad");
		setBox(highlightEl, "Invalid regular expression", "error");
		setBox(replacedEl, "Replace result will appear here", "empty");
		matchesWrap.hidden = true;
		updateMeta(0, 0, 0);
		setStatus(e.message, "bad");
		return;
	}

	if (!text) {
		showEmpty("Pattern is valid. Add some text to test against.");
		setStatus("Pattern is valid. Add some text to test against.", "ok");
		return;
	}

	const t0 = performance.now();
	const { out, truncated } = collect(re, text);
	const ms = Math.round((performance.now() - t0) * 10) / 10;

	renderHighlight(text, out);
	renderMatches(out, truncated);
	const groups = new RegExp(`${pattern}|`, flags).exec("").length - 1;
	updateMeta(out.length, groups, ms);

	if (out.length === 0) {
		setStatus("No matches.", "warn");
	} else {
		setStatus(
			`${out.length}${truncated ? "+" : ""} match${out.length === 1 ? "" : "es"} found.` +
				(truncated ? ` Stopped at ${MAX_MATCHES}.` : ""),
			"ok",
		);
	}

	// replace preview
	if (replEl.value === "" && !replEl.dataset.touched) {
		setBox(replacedEl, "Replace result will appear here", "empty");
	} else {
		try {
			const rre = new RegExp(pattern, flags);
			setBox(replacedEl, text.replace(rre, replEl.value));
		} catch (e) {
			setBox(replacedEl, e.message, "error");
		}
	}
}

// ---------- copy ----------

async function copyText(text, btn, idle, labelEl) {
	if (!text) return;
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		const ta = document.createElement("textarea");
		ta.value = text;
		document.body.appendChild(ta);
		ta.select();
		document.execCommand("copy");
		ta.remove();
	}
	btn.classList.add("copied");
	labelEl.textContent = "Copied";
	setTimeout(() => {
		btn.classList.remove("copied");
		labelEl.textContent = idle;
	}, 1400);
}

$("copyRegexBtn").addEventListener("click", () => {
	if (!patternEl.value) return;
	copyText(
		`/${patternEl.value}/${getFlags()}`,
		$("copyRegexBtn"),
		"Copy regex",
		$("copyRegexLabel"),
	);
});
$("copyReplaceBtn").addEventListener("click", () => {
	if (
		replacedEl.classList.contains("empty") ||
		replacedEl.classList.contains("error")
	)
		return;
	copyText(
		replacedEl.textContent,
		$("copyReplaceBtn"),
		"Copy result",
		$("copyReplaceLabel"),
	);
});

// ---------- events ----------

patternEl.addEventListener("input", run);
textEl.addEventListener("input", run);
replEl.addEventListener("input", () => {
	replEl.dataset.touched = "1";
	run();
});
flagBoxes.forEach((b) => b.addEventListener("change", run));

$("examples").addEventListener("change", (e) => {
	const ex = EXAMPLES[e.target.value];
	if (!ex) return;
	patternEl.value = ex.p;
	textEl.value = ex.t;
	flagBoxes.forEach((b) => (b.checked = ex.f.includes(b.value)));
	e.target.value = "";
	run();
});

$("sampleBtn").addEventListener("click", () => {
	const ex = EXAMPLES.date;
	patternEl.value = ex.p;
	textEl.value = ex.t;
	replEl.value = "$3/$2/$1";
	replEl.dataset.touched = "1";
	flagBoxes.forEach((b) => (b.checked = ex.f.includes(b.value)));
	run();
});

$("clearBtn").addEventListener("click", () => {
	patternEl.value = "";
	textEl.value = "";
	replEl.value = "";
	delete replEl.dataset.touched;
	flagBoxes.forEach((b) => (b.checked = b.value === "g"));
	run();
	patternEl.focus();
});

$("year").textContent = new Date().getFullYear();
run();
