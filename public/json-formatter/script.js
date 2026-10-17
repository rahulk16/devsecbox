const PLACEHOLDER = "Result will appear here";
const IDLE = "Paste JSON to validate it.";
const SAMPLE =
	'{"name":"DevSecBox","tools":["base64","json","jwt"],"private":true,"stats":{"count":3,"ratio":0.75},"notes":null}';

let mode = "format";
let lastValid = false;

const input = document.getElementById("input");
const output = document.getElementById("output");
const outputLabel = document.getElementById("outputLabel");
const status = document.getElementById("status");
const keyCount = document.getElementById("keyCount");
const depthCount = document.getElementById("depthCount");
const byteCount = document.getElementById("byteCount");
const modeFormatBtn = document.getElementById("modeFormat");
const modeMinifyBtn = document.getElementById("modeMinify");
const indentSel = document.getElementById("indent");
const sortKeys = document.getElementById("sortKeys");
const clearBtn = document.getElementById("clearBtn");
const sampleBtn = document.getElementById("sampleBtn");
const fileInput = document.getElementById("fileInput");
const copyBtn = document.getElementById("copyBtn");
const copyLabel = document.getElementById("copyLabel");
const downloadBtn = document.getElementById("downloadBtn");

// ---------- helpers ----------

function utf8ByteLength(str) {
	return new TextEncoder().encode(str).length;
}

function sortDeep(v) {
	if (Array.isArray(v)) return v.map(sortDeep);
	if (v && typeof v === "object") {
		const o = {};
		Object.keys(v)
			.sort()
			.forEach((k) => (o[k] = sortDeep(v[k])));
		return o;
	}
	return v;
}

function lineColFromPos(text, pos) {
	const lines = text.slice(0, pos).split("\n");
	return { line: lines.length, col: lines[lines.length - 1].length + 1 };
}

// Browsers word JSON.parse errors differently; pull out a position if any.
function parseJson(text) {
	try {
		return { ok: true, value: JSON.parse(text) };
	} catch (e) {
		const msg = String(e.message);
		let pos = null;
		let line = null;
		let col = null;
		let m;
		if ((m = /position (\d+)/.exec(msg))) {
			pos = parseInt(m[1], 10);
			({ line, col } = lineColFromPos(text, pos));
		} else if ((m = /line (\d+) column (\d+)/.exec(msg))) {
			line = +m[1];
			col = +m[2];
			const rows = text.split("\n");
			pos = 0;
			for (let i = 0; i < line - 1; i++) pos += rows[i].length + 1;
			pos += col - 1;
		}
		return { ok: false, msg, pos, line, col };
	}
}

function measure(value) {
	let keys = 0;
	let depth = 0;
	(function walk(x, d) {
		depth = Math.max(depth, d);
		if (Array.isArray(x)) x.forEach((i) => walk(i, d + 1));
		else if (x && typeof x === "object")
			Object.keys(x).forEach((k) => {
				keys++;
				walk(x[k], d + 1);
			});
	})(value, 1);
	return { keys, depth };
}

function setStatus(text, state) {
	status.textContent = text;
	status.classList.toggle("ok", state === "ok");
	status.classList.toggle("bad", state === "bad");
}

function showResult(text, state) {
	output.textContent = text;
	output.classList.toggle("empty", state === "empty");
	output.classList.toggle("error", state === "error");
}

function updateMeta(keys, depth, bytes) {
	keyCount.textContent = `Keys: ${keys}`;
	depthCount.textContent = `Depth: ${depth}`;
	byteCount.textContent = `Bytes: ${bytes}`;
}

function indentValue() {
	return indentSel.value === "tab" ? "\t" : parseInt(indentSel.value, 10);
}

// ---------- main render ----------

function render(focusError = false) {
	const text = input.value;
	outputLabel.textContent = mode === "format" ? "Formatted" : "Minified";

	if (!text.trim()) {
		lastValid = false;
		showResult(PLACEHOLDER, "empty");
		setStatus(IDLE);
		updateMeta(0, 0, 0);
		return;
	}

	const res = parseJson(text);
	if (!res.ok) {
		lastValid = false;
		const where = res.line ? ` at line ${res.line}, column ${res.col}` : "";
		showResult("Invalid JSON", "error");
		setStatus(`Invalid JSON${where}. ${res.msg}`, "bad");
		updateMeta(0, 0, utf8ByteLength(text));
		if (focusError && res.pos !== null) {
			input.focus();
			input.setSelectionRange(res.pos, Math.min(res.pos + 1, text.length));
		}
		return;
	}

	const value = sortKeys.checked ? sortDeep(res.value) : res.value;
	const result =
		mode === "format"
			? JSON.stringify(value, null, indentValue())
			: JSON.stringify(value);
	lastValid = true;
	showResult(result, "ok");

	const { keys, depth } = measure(value);
	updateMeta(keys, depth, utf8ByteLength(result));
	setStatus(
		`Valid JSON. ${mode === "format" ? "Formatted" : "Minified"}: ${utf8ByteLength(text)} → ${utf8ByteLength(result)} bytes.`,
		"ok",
	);
}

function setMode(next) {
	mode = next;
	const isFormat = next === "format";
	modeFormatBtn.classList.toggle("active", isFormat);
	modeMinifyBtn.classList.toggle("active", !isFormat);
	modeFormatBtn.setAttribute("aria-pressed", String(isFormat));
	modeMinifyBtn.setAttribute("aria-pressed", String(!isFormat));
	indentSel.disabled = !isFormat;
	render();
}

// ---------- events ----------

modeFormatBtn.addEventListener("click", () => setMode("format"));
modeMinifyBtn.addEventListener("click", () => setMode("minify"));
input.addEventListener("input", () => render());
indentSel.addEventListener("change", () => render());
sortKeys.addEventListener("change", () => render());

input.addEventListener("keydown", (e) => {
	if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
		e.preventDefault();
		render(true);
	}
});

clearBtn.addEventListener("click", () => {
	input.value = "";
	render();
	input.focus();
});

sampleBtn.addEventListener("click", () => {
	input.value = SAMPLE;
	render();
});

fileInput.addEventListener("change", (e) => {
	const file = e.target.files[0];
	if (!file) return;
	const reader = new FileReader();
	reader.onload = () => {
		input.value = reader.result;
		render(true);
	};
	reader.readAsText(file);
	e.target.value = "";
});

copyBtn.addEventListener("click", async () => {
	if (!lastValid) return;
	try {
		await navigator.clipboard.writeText(output.textContent);
	} catch {
		const range = document.createRange();
		range.selectNodeContents(output);
		const sel = window.getSelection();
		sel.removeAllRanges();
		sel.addRange(range);
		document.execCommand("copy");
		sel.removeAllRanges();
	}
	copyBtn.classList.add("copied");
	copyLabel.textContent = "Copied";
	setTimeout(() => {
		copyBtn.classList.remove("copied");
		copyLabel.textContent = "Copy";
	}, 1400);
});

downloadBtn.addEventListener("click", () => {
	if (!lastValid) return;
	const a = document.createElement("a");
	a.href = URL.createObjectURL(
		new Blob([output.textContent], { type: "application/json" }),
	);
	a.download = mode === "format" ? "formatted.json" : "minified.json";
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

document.getElementById("year").textContent = new Date().getFullYear();
render();
