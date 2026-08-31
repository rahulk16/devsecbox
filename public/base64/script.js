let mode = "encode";

const input = document.getElementById("input");
const output = document.getElementById("output");
const runBtn = document.getElementById("runBtn");
const inputLabel = document.getElementById("inputLabel");
const outputLabel = document.getElementById("outputLabel");
const charCount = document.getElementById("charCount");
const byteCount = document.getElementById("byteCount");
const rail = document.getElementById("rail");

// Build the rail dots once
const DOT_COUNT = 60;

for (let i = 0; i < DOT_COUNT; i++) {
	const d = document.createElement("div");
	d.className = "rail-dot";
	rail.appendChild(d);
}

const dots = rail.querySelectorAll(".rail-dot");

// Switch between Encode and Decode modes
function setMode(m) {
	mode = m;

	document
		.getElementById("modeEncode")
		.classList.toggle("active", m === "encode");

	document
		.getElementById("modeDecode")
		.classList.toggle("active", m === "decode");

	inputLabel.textContent = m === "encode" ? "Input text" : "Input Base64";

	outputLabel.textContent = "Result";

	runBtn.textContent = m === "encode" ? "Encode" : "Decode";

	input.placeholder =
		m === "encode" ? "Enter text here…" : "Enter Base64 here…";

	run();
}

// Get UTF-8 byte length
function utf8ByteLength(str) {
	return new TextEncoder().encode(str).length;
}

// Validate Base64 input
function isValidBase64(value) {
	const cleaned = value.trim();

	if (!cleaned) {
		return false;
	}

	// Only valid Base64 characters
	if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
		return false;
	}

	// Base64 length must be a multiple of 4
	if (cleaned.length % 4 !== 0) {
		return false;
	}

	// Padding must be at the end
	const paddingIndex = cleaned.indexOf("=");

	if (paddingIndex !== -1) {
		const padding = cleaned.substring(paddingIndex);

		if (padding.length > 2) {
			return false;
		}

		if (paddingIndex < cleaned.length - padding.length) {
			return false;
		}
	}

	return true;
}

// Encode / Decode
function run() {
	const val = input.value;

	let result = "";
	let isError = false;

	// Empty input
	if (val.length === 0) {
		output.textContent = "Result will appear here";

		output.classList.add("empty");
		output.classList.remove("error");

		updateMeta(0, 0);
		updateRail(0);

		return;
	}

	try {
		if (mode === "encode") {
			// UTF-8 text → Base64

			const bytes = new TextEncoder().encode(val);

			let binary = "";

			bytes.forEach((byte) => {
				binary += String.fromCharCode(byte);
			});

			result = btoa(binary);
		} else {
			// Base64 → UTF-8 text

			if (!isValidBase64(val)) {
				throw new Error("Invalid Base64");
			}

			const binary = atob(val.trim());

			const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));

			result = new TextDecoder("utf-8", {
				fatal: true,
			}).decode(bytes);
		}
	} catch (e) {
		result =
			mode === "decode"
				? "Not valid Base64 — check the characters, padding, and length."
				: "Could not encode this text.";

		isError = true;
	}

	// Display result
	output.textContent = result;

	output.classList.remove("empty");

	output.classList.toggle("error", isError);

	// Update statistics
	const chars = val.length;

	const bytes =
		mode === "encode"
			? utf8ByteLength(val)
			: isError
				? 0
				: utf8ByteLength(result);

	updateMeta(chars, bytes);

	// Update visual rail
	updateRail(isError ? 0 : Math.min(result.length, DOT_COUNT));
}

// Update character / byte counter
function updateMeta(chars, bytes) {
	charCount.textContent = `Characters: ${chars}`;
	byteCount.textContent = `Bytes: ${bytes}`;
}

// Update visual rail
function updateRail(litCount) {
	dots.forEach((d, i) => {
		d.classList.toggle("lit", i < litCount);
	});
}

// Clear input and output
function clearAll() {
	input.value = "";

	run();

	input.focus();
}

// Copy result to clipboard
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
		// Modern Clipboard API
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

		// Show "Copied"
		const btn = document.getElementById("copyBtn");

		const original = btn.textContent;

		btn.textContent = "Copied";
		btn.classList.add("copied");

		setTimeout(() => {
			btn.textContent = original;
			btn.classList.remove("copied");
		}, 1300);
	} catch (error) {
		console.error("Copy failed:", error);
	}
}

// Run whenever user types
input.addEventListener("input", run);

// Initialize
run();
