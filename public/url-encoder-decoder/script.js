const PLACEHOLDER = "Result will appear here";
const MAX_PARAMS = 200;

let mode = "encode";
let lastResult = "";

const $ = (id) => document.getElementById(id);

const input = $("input");
const output = $("output");
const statusEl = $("status");
const scopeEl = $("scope");
const plusEl = $("optPlus");
const strictEl = $("optStrict");
const strictWrap = $("strictWrap");
const copyBtn = $("copyBtn");
const copyLabel = $("copyLabel");

// ---------- core (pure) ----------

function encode(text, { scope, plus, strict }) {
	let out = scope === "full" ? encodeURI(text) : encodeURIComponent(text);
	if (strict) {
		out = out.replace(
			/[!'()*]/g,
			(c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
		);
	}
	if (plus) out = out.replace(/%20/g, "+");
	return out;
}

// Decodes every valid %XX run and leaves malformed ones untouched
function decode(text, { scope, plus }) {
	const fn = scope === "full" ? decodeURI : decodeURIComponent;
	const src = plus ? text.replace(/\+/g, " ") : text;
	let malformed = false;
	const value = src.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) => {
		try {
			return fn(run);
		} catch {
			malformed = true;
			return run;
		}
	});
	// A '%' not followed by two hex digits is also malformed
	if (/%(?![0-9a-fA-F]{2})/.test(src)) malformed = true;
	return { value, malformed };
}

function utf8ByteLength(str) {
	return new TextEncoder().encode(str).length;
}

// ---------- ui ----------

function setStatus(text, isError) {
	statusEl.textContent = text;
	statusEl.classList.toggle("error", Boolean(isError));
}

function showOutput(text, isEmpty, isError) {
	output.textContent = isEmpty ? PLACEHOLDER : text;
	output.classList.toggle("empty", Boolean(isEmpty));
	output.classList.toggle("error", Boolean(isError));
}

function renderParams(text) {
	const wrap = $("params");
	const body = $("paramsBody");
	body.textContent = "";

	let query = null;
	const t = text.trim();
	if (t.startsWith("?")) {
		query = t.slice(1).split("#")[0];
	} else {
		try {
			query = new URL(t).search.slice(1);
		} catch {
			query = null;
		}
	}
	if (!query) {
		wrap.hidden = true;
		return;
	}

	const entries = Array.from(new URLSearchParams(query));
	if (!entries.length) {
		wrap.hidden = true;
		return;
	}
	entries.slice(0, MAX_PARAMS).forEach(([k, v], i) => {
		const tr = document.createElement("tr");
		for (const cell of [String(i + 1), k, v]) {
			const td = document.createElement("td");
			td.textContent = cell;
			tr.appendChild(td);
		}
		body.appendChild(tr);
	});
	wrap.hidden = false;
}

function run() {
	const text = input.value;
	$("charCount").textContent = `Characters: ${[...text].length}`;
	$("byteCount").textContent = `Bytes: ${utf8ByteLength(text)}`;
	renderParams(text);

	if (!text) {
		lastResult = "";
		showOutput("", true, false);
		setStatus("", false);
		return;
	}

	const opts = {
		scope: scopeEl.value,
		plus: plusEl.checked,
		strict: strictEl.checked,
	};

	if (mode === "encode") {
		try {
			lastResult = encode(text, opts);
			showOutput(lastResult, false, false);
			setStatus("", false);
		} catch {
			lastResult = "";
			showOutput("Cannot encode: the text contains an unpaired surrogate character.", false, true);
			setStatus("", false);
		}
		return;
	}

	const { value, malformed } = decode(text, opts);
	lastResult = value;
	showOutput(value, false, false);
	if (malformed) {
		setStatus("Some sequences are malformed (invalid % or UTF-8) and were left unchanged.", true);
	} else if (/%[0-9a-fA-F]{2}/.test(value)) {
		setStatus("Result still contains %XX sequences — it may have been encoded twice.", false);
	} else if (value === text) {
		setStatus("Nothing to decode — the input has no percent-encoded characters.", false);
	} else {
		setStatus("", false);
	}
}

function setMode(next) {
	mode = next;
	const enc = next === "encode";
	$("modeEncode").classList.toggle("active", enc);
	$("modeDecode").classList.toggle("active", !enc);
	$("modeEncode").setAttribute("aria-pressed", String(enc));
	$("modeDecode").setAttribute("aria-pressed", String(!enc));
	$("inputLabel").textContent = enc ? "Text to encode" : "Text to decode";
	$("outputLabel").textContent = enc ? "Encoded result" : "Decoded result";
	input.placeholder = enc ? "Enter text or a URL here…" : "Enter a percent-encoded string here…";
	strictWrap.hidden = !enc;
	run();
}

async function copyOutput() {
	if (!lastResult) return;
	try {
		await navigator.clipboard.writeText(lastResult);
	} catch (error) {
		console.error("Copy failed:", error);
		return;
	}
	copyLabel.textContent = "Copied";
	copyBtn.classList.add("copied");
	setTimeout(() => {
		copyLabel.textContent = "Copy";
		copyBtn.classList.remove("copied");
	}, 1300);
}

function swap() {
	const next = mode === "encode" ? "decode" : "encode";
	if (lastResult) input.value = lastResult;
	setMode(next);
}

function clearAll() {
	input.value = "";
	run();
	input.focus();
}

$("modeEncode").addEventListener("click", () => setMode("encode"));
$("modeDecode").addEventListener("click", () => setMode("decode"));
$("swapBtn").addEventListener("click", swap);
$("clearBtn").addEventListener("click", clearAll);
copyBtn.addEventListener("click", copyOutput);
input.addEventListener("input", run);
[scopeEl, plusEl, strictEl].forEach((el) => el.addEventListener("change", run));

$("year").textContent = new Date().getFullYear();
run();
