import SERVER_URL from "../config/api";

const DATABASE_NAME = "attendance-device-keys";
const STORE_NAME = "keys";
const DEVICE_KEY_ID = "student-device-v1";

const openDatabase = () => new Promise((resolve, reject) => {
  const request = window.indexedDB.open(DATABASE_NAME, 1);

  request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const readKey = async () => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(DEVICE_KEY_ID);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const saveKey = async (deviceKey) => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(deviceKey, DEVICE_KEY_ID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const getOrCreateDeviceKey = async () => {
  if (!window.crypto?.subtle || !window.indexedDB) {
    throw new Error("This browser cannot create a secure attendance device key.");
  }

  const existingKey = await readKey();
  if (existingKey?.publicKeyJwk && existingKey?.privateKey) return existingKey;

  // The private key is non-extractable: it can sign here but never leave this browser.
  const keyPair = await window.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign", "verify"]
  );
  const publicKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const deviceKey = { privateKey: keyPair.privateKey, publicKeyJwk };
  await saveKey(deviceKey);
  return deviceKey;
};

export const getOrCreateDevicePublicKey = async () => (await getOrCreateDeviceKey()).publicKeyJwk;

// --- Device proof (mirror of attendance-backend/utils/deviceProof.js) ---

// JSON with object keys sorted at every level, so browser and server hash identical bytes.
const canonicalJson = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
};

const sha256Hex = async (text) => {
  const digest = await window.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const toBase64Url = (buffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * Ask the server for a one-time challenge and sign it with this browser's
 * device key. Returns { challengeId, signature } to send with the request.
 * `payload` must contain exactly the request fields the server re-checks.
 * `challenge` ({ challengeId, nonce }) skips the request when the server
 * already issued one (sign-in returns a bind challenge).
 */
export const signDeviceChallenge = async ({ purpose, payload = {}, challenge = null }) => {
  const { privateKey } = await getOrCreateDeviceKey();
  let data = challenge;
  if (!data?.challengeId || !data?.nonce) {
    const response = await fetch(`${SERVER_URL}/device/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ purpose }),
    });
    data = await response.json();
    if (!response.ok) throw new Error(data.message || "Could not start the device check.");
  }

  const message = `${purpose}|${data.nonce}|${await sha256Hex(canonicalJson(payload))}`;
  const signature = await window.crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(message)
  );
  return { challengeId: data.challengeId, signature: toBase64Url(signature) };
};

// The public key fields the server fingerprints; used as the bind payload.
export const publicKeyPayload = (publicKeyJwk) => ({
  publicKey: { crv: publicKeyJwk.crv, kty: publicKeyJwk.kty, x: publicKeyJwk.x, y: publicKeyJwk.y },
});
