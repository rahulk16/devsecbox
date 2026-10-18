const PLACEHOLDER = "Result will appear here";
const DOT_COUNT = 60;

let mode = "encode";

const input = document.getElementById("input");
const output = document.getElementById("output");
const inputLabel = document.getElementById("inputLabel");
const outputLabel = document.getElementById("outputLabel");
const charCount = document.getElementById("charCount");
const byteCount = document.getElementById("byteCount");
const rail = document.getElementById("rail");
const modeEncodeBtn = document.getElementById("modeEncode");
const modeDecodeBtn = document.getElementById("modeDecode");
const clearBtn = document.getElementById("clearBtn");
const copyBtn = document.getElementById("copyBtn");
const copyLabel = document.getElementById("copyLabel");

// Build the rail dots once
for (let i = 0; i < DOT_COUNT; i++) {
	const d = document.createElement("div");
	d.className = "rail-dot";
	rail.appendChild(d);
}
const dots = rail.querySelectorAll(".rail-dot");

// ---------- helpers ----------

function utf8ByteLength(str) {
	return new TextEncoder().encode(str).length;
}

// UTF-8 text -> Base64 (chunked so large inputs don't blow the call stack)
function encodeBase64(text) {
	const bytes = new TextEncoder().encode(text);
	const CHUNK = 0x8000;
	let binary = "";
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
	}
	return btoa(binary);
}

// Base64 -> UTF-8 text. Throws "invalid-base64" or "invalid-utf8".
function decodeBase64(value) {
	// Allow line-wrapped Base64 (e.g. from emails / PEM): drop all whitespace
	const cleaned = value.replace(/\s+/g, "");

	if (
		!cleaned ||
		!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
			cleaned,
		)
	) {
		throw new Error("invalid-base64");
	}

	const binary = atob(cleaned);
	const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));

	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new Error("invalid-utf8");
	}
}

function showResult(text, state) {
	output.textContent = text;
	output.classList.toggle("empty", state === "empty");
	output.classList.toggle("error", state === "error");
}

function updateMeta(chars, bytes) {
	charCount.textContent = `Characters: ${chars}`;
	byteCount.textContent = `Bytes: ${bytes}`;
}

function updateRail(litCount) {
	dots.forEach((d, i) => d.classList.toggle("lit", i < litCount));
}

// ---------- main ----------

function run() {
	const val = input.value;

	if (val.length === 0) {
		showResult(PLACEHOLDER, "empty");
		updateMeta(0, 0);
		updateRail(0);
		return;
	}

	let result = "";
	let isError = false;

	try {
		result = mode === "encode" ? encodeBase64(val) : decodeBase64(val);
	} catch (e) {
		isError = true;
		if (mode === "decode" && e.message === "invalid-utf8") {
			result =
				"Valid Base64, but the decoded data isn't UTF-8 text (it may be binary data).";
		} else if (mode === "decode") {
			result = "Not valid Base64 — check the characters, padding, and length.";
		} else {
			result = "Could not encode this text.";
		}
	}

	showResult(result, isError ? "error" : "ok");

	const chars = Array.from(val).length;
	const bytes =
		mode === "encode"
			? utf8ByteLength(val)
			: isError
				? 0
				: utf8ByteLength(result);

	updateMeta(chars, bytes);
	updateRail(isError ? 0 : Math.min(result.length, DOT_COUNT));
}

function setMode(m) {
	mode = m;

	const isEncode = m === "encode";
	modeEncodeBtn.classList.toggle("active", isEncode);
	modeDecodeBtn.classList.toggle("active", !isEncode);
	modeEncodeBtn.setAttribute("aria-pressed", String(isEncode));
	modeDecodeBtn.setAttribute("aria-pressed", String(!isEncode));

	inputLabel.textContent = isEncode ? "Input text" : "Input Base64";
	outputLabel.textContent = "Result";
	input.placeholder = isEncode ? "Enter text here…" : "Enter Base64 here…";

	run();
}

function clearAll() {
	input.value = "";
	run();
	input.focus();
}

async function copyOutput() {
	const text = output.textContent;

	// Don't copy empty or error messages
	if (
		!text ||
		output.classList.contains("empty") ||
		output.classList.contains("error")
	) {
		return;
	}

	try {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text);
		} else {
			// Fallback for older / non-secure environments
			const textarea = document.createElement("textarea");
			textarea.value = text;
			textarea.style.position = "fixed";
			textarea.style.opacity = "0";
			document.body.appendChild(textarea);
			textarea.focus();
			textarea.select();
			document.execCommand("copy");
			textarea.remove();
		}

		const original = "Copy";
		copyLabel.textContent = "Copied";
		copyBtn.classList.add("copied");

		setTimeout(() => {
			copyLabel.textContent = original;
			copyBtn.classList.remove("copied");
		}, 1300);
	} catch (error) {
		console.error("Copy failed:", error);
	}
}

// ---------- events ----------
modeEncodeBtn.addEventListener("click", () => setMode("encode"));
modeDecodeBtn.addEventListener("click", () => setMode("decode"));
clearBtn.addEventListener("click", clearAll);
copyBtn.addEventListener("click", copyOutput);
input.addEventListener("input", run);

// Footer year
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Initialize
run();
