const $ = (id) => document.getElementById(id);

const tokenEl = $("token");
const tokenState = $("tokenState");
const statusEl = $("status");
const headerEl = $("header");
const payloadEl = $("payload");
const sigEl = $("signature");
const claimsWrap = $("claimsWrap");
const claimsEl = $("claims");
const verifyState = $("verifyState");
const secretEl = $("secret");
const secretB64 = $("secretB64");

const PH = {
	header: "Decoded header will appear here",
	payload: "Decoded payload will appear here",
	sig: "Signature will appear here",
};
const CLAIM_NAMES = {
	iss: "Issuer",
	sub: "Subject",
	aud: "Audience",
	exp: "Expires at",
	nbf: "Not valid before",
	iat: "Issued at",
	jti: "Token ID",
};
const HMAC = { HS256: "SHA-256", HS384: "SHA-384", HS512: "SHA-512" };

let current = null; // { parts, header, payload } for the last valid decode

// ---------- helpers ----------

function b64urlToBytes(str) {
	const b64 = str.replace(/-/g, "+").replace(/_/g, "/");
	const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
	const bin = atob(padded);
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function bytesToB64url(bytes) {
	let bin = "";
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeJsonPart(part, label) {
	if (!/^[A-Za-z0-9_-]*$/.test(part)) {
		throw new Error(`${label} is not valid Base64URL.`);
	}
	let text;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(
			b64urlToBytes(part),
		);
	} catch {
		throw new Error(`${label} could not be decoded as UTF-8 text.`);
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${label} is not valid JSON.`);
	}
}

function setBox(el, text, state) {
	el.textContent = text;
	el.classList.toggle("empty", state === "empty");
	el.classList.toggle("error", state === "error");
}

function setStatus(text, state) {
	statusEl.textContent = text;
	["ok", "warn", "bad"].forEach((s) =>
		statusEl.classList.toggle(s, state === s),
	);
}

function setState(el, text, state) {
	el.textContent = text;
	el.classList.toggle("ok", state === "ok");
	el.classList.toggle("bad", state === "bad");
}

function relative(seconds) {
	const abs = Math.abs(seconds);
	const units = [
		["day", 86400],
		["hour", 3600],
		["minute", 60],
		["second", 1],
	];
	for (const [name, size] of units) {
		if (abs >= size || name === "second") {
			const n = Math.floor(abs / size);
			const label = `${n} ${name}${n === 1 ? "" : "s"}`;
			return seconds >= 0 ? `in ${label}` : `${label} ago`;
		}
	}
}

function clearOutputs() {
	current = null;
	setBox(headerEl, PH.header, "empty");
	setBox(payloadEl, PH.payload, "empty");
	setBox(sigEl, PH.sig, "empty");
	claimsWrap.hidden = true;
	claimsEl.textContent = "";
	setState(verifyState, "", null);
	setState(tokenState, "", null);
}

// ---------- claims ----------

function renderClaims(payload) {
	claimsEl.textContent = "";
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		claimsWrap.hidden = true;
		return;
	}
	const keys = Object.keys(CLAIM_NAMES).filter((k) => k in payload);
	keys.forEach((k) => {
		const row = document.createElement("div");
		row.className = "claim";
		const key = document.createElement("span");
		key.className = "claim-key";
		key.textContent = k;
		const val = document.createElement("div");
		val.className = "claim-val";

		const name = document.createElement("span");
		name.className = "claim-name";
		name.textContent = CLAIM_NAMES[k];

		const main = document.createElement("span");
		const v = payload[k];
		if (["exp", "nbf", "iat"].includes(k) && typeof v === "number") {
			const d = new Date(v * 1000);
			main.textContent = isNaN(d) ? String(v) : d.toLocaleString();
			const t = document.createElement("span");
			t.className = "claim-time";
			t.textContent = isNaN(d)
				? "Invalid timestamp"
				: `${d.toISOString()} (${relative(v - Date.now() / 1000)})`;
			val.append(name, main, t);
		} else {
			main.textContent = typeof v === "object" ? JSON.stringify(v) : String(v);
			val.append(name, main);
		}
		row.append(key, val);
		claimsEl.appendChild(row);
	});
	claimsWrap.hidden = keys.length === 0;
}

function expiryStatus(payload) {
	const now = Date.now() / 1000;
	if (payload && typeof payload.nbf === "number" && payload.nbf > now) {
		return {
			text: `Not valid yet — nbf is ${relative(payload.nbf - now)}.`,
			state: "warn",
		};
	}
	if (payload && typeof payload.exp === "number") {
		return payload.exp <= now
			? { text: `Expired ${relative(payload.exp - now)}.`, state: "bad" }
			: {
					text: `Not expired — expires ${relative(payload.exp - now)}.`,
					state: "ok",
				};
	}
	return { text: "No exp claim — this token never expires.", state: "warn" };
}

// ---------- decode ----------

function decode() {
	const raw = tokenEl.value.trim().replace(/^Bearer\s+/i, "");
	setState(verifyState, "", null);

	if (!raw) {
		clearOutputs();
		setStatus("Paste a JWT to decode it.");
		return;
	}

	const parts = raw.split(".");
	if (parts.length !== 3) {
		clearOutputs();
		setStatus(
			`A JWT has 3 parts separated by dots; found ${parts.length}.` +
				(parts.length === 5
					? " This looks like an encrypted JWE token, which cannot be decoded here."
					: ""),
			"bad",
		);
		setState(tokenState, "Invalid", "bad");
		return;
	}

	let header, payload;
	try {
		header = decodeJsonPart(parts[0], "Header");
		payload = decodeJsonPart(parts[1], "Payload");
	} catch (e) {
		clearOutputs();
		setStatus(e.message, "bad");
		setState(tokenState, "Invalid", "bad");
		return;
	}

	current = { parts, header, payload };
	setBox(headerEl, JSON.stringify(header, null, 2));
	setBox(payloadEl, JSON.stringify(payload, null, 2));
	setBox(
		sigEl,
		parts[2] || "(empty — token is unsigned)",
		parts[2] ? "" : "empty",
	);
	renderClaims(payload);
	setState(tokenState, "Decoded", "ok");

	const alg = header && header.alg;
	if (typeof alg === "string" && alg.toLowerCase() === "none") {
		setStatus(
			"Warning: alg is “none”, so this token has no signature. Servers must reject it.",
			"bad",
		);
		return;
	}
	const ex = expiryStatus(payload);
	setStatus(`${alg ? `Algorithm ${alg}. ` : ""}${ex.text}`, ex.state);
}

// ---------- verify (HMAC only) ----------

async function hmacKey(alg) {
	let keyBytes;
	if (secretB64.checked) {
		if (!/^[A-Za-z0-9_-]*$/.test(secretEl.value.trim())) {
			throw new Error("Secret is not valid Base64URL.");
		}
		keyBytes = b64urlToBytes(secretEl.value.trim());
	} else {
		keyBytes = new TextEncoder().encode(secretEl.value);
	}
	return crypto.subtle.importKey(
		"raw",
		keyBytes,
		{ name: "HMAC", hash: HMAC[alg] },
		false,
		["sign"],
	);
}

async function verify() {
	if (!current) {
		setState(verifyState, "Decode a token first", "bad");
		return;
	}
	const alg = current.header && current.header.alg;
	if (!HMAC[alg]) {
		setState(
			verifyState,
			alg
				? `${alg} needs a public key — only HS256/384/512 are supported here`
				: "No alg in header",
			"bad",
		);
		return;
	}
	if (!secretEl.value) {
		setState(verifyState, "Enter the secret", "bad");
		return;
	}
	if (!(window.crypto && crypto.subtle)) {
		setState(verifyState, "Web Crypto not available (needs HTTPS)", "bad");
		return;
	}
	try {
		const key = await hmacKey(alg);
		const data = new TextEncoder().encode(
			`${current.parts[0]}.${current.parts[1]}`,
		);
		const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
		const ok = bytesToB64url(sig) === current.parts[2];
		setState(
			verifyState,
			ok ? "Signature valid" : "Signature invalid",
			ok ? "ok" : "bad",
		);
	} catch (e) {
		setState(verifyState, e.message || "Verification failed", "bad");
	}
}

// ---------- sample ----------

async function loadSample() {
	const enc = (obj) =>
		bytesToB64url(new TextEncoder().encode(JSON.stringify(obj)));
	const now = Math.floor(Date.now() / 1000);
	const head = enc({ alg: "HS256", typ: "JWT" });
	const body = enc({
		sub: "1234567890",
		name: "Jane Doe",
		role: "admin",
		iat: now,
		exp: now + 3600,
	});
	const secret = "devsecbox-demo-secret";
	let sig = "";
	if (window.crypto && crypto.subtle) {
		const key = await crypto.subtle.importKey(
			"raw",
			new TextEncoder().encode(secret),
			{ name: "HMAC", hash: "SHA-256" },
			false,
			["sign"],
		);
		sig = bytesToB64url(
			new Uint8Array(
				await crypto.subtle.sign(
					"HMAC",
					key,
					new TextEncoder().encode(`${head}.${body}`),
				),
			),
		);
	}
	secretEl.value = secret;
	secretB64.checked = false;
	tokenEl.value = `${head}.${body}.${sig}`;
	decode();
}

// ---------- copy ----------

async function copyText(text, btn, idleLabel, labelEl) {
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
	(labelEl || btn).textContent = "Copied";
	setTimeout(() => {
		btn.classList.remove("copied");
		(labelEl || btn).textContent = idleLabel;
	}, 1400);
}

document.querySelectorAll("[data-copy]").forEach((btn) => {
	btn.addEventListener("click", () => {
		if (!current) return;
		const obj =
			btn.dataset.copy === "header" ? current.header : current.payload;
		copyText(JSON.stringify(obj, null, 2), btn, "Copy");
	});
});
$("copyTokenBtn").addEventListener("click", () =>
	copyText(
		tokenEl.value.trim(),
		$("copyTokenBtn"),
		"Copy token",
		$("copyTokenLabel"),
	),
);

// ---------- events ----------

tokenEl.addEventListener("input", decode);
$("verifyBtn").addEventListener("click", verify);
secretEl.addEventListener("keydown", (e) => {
	if (e.key === "Enter") verify();
});
$("sampleBtn").addEventListener("click", loadSample);
$("clearBtn").addEventListener("click", () => {
	tokenEl.value = "";
	secretEl.value = "";
	decode();
	tokenEl.focus();
});

$("year").textContent = new Date().getFullYear();
decode();
