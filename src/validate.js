import { HttpError } from "./errors.js";

const LIMITS = {
  title: 120,
  optionName: 80,
  description: 280,
  voterName: 40,
};

function invalid(message) {
  throw new HttpError(400, message);
}

function cleanText(value, { max, label, required }) {
  if (value === undefined || value === null) {
    if (required) {
      invalid(`${label} is required`);
    }
    return "";
  }
  if (typeof value !== "string") {
    invalid(`${label} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) {
      invalid(`${label} is required`);
    }
    return "";
  }
  if (trimmed.length > max) {
    invalid(`${label} must be ${max} characters or fewer`);
  }
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) {
    invalid(`${label} contains characters that are not allowed`);
  }
  if (required && !/[\p{L}\p{N}]/u.test(trimmed)) {
    invalid(`${label} must include a letter or number`);
  }
  return trimmed;
}

export function normalizeKey(value) {
  return value.trim().toLowerCase();
}

export function parseId(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }
  const text = String(value);
  if (!/^[1-9]\d*$/.test(text)) {
    return null;
  }
  const id = Number(text);
  if (!Number.isSafeInteger(id)) {
    return null;
  }
  return id;
}

export function requireId(value, label) {
  const id = parseId(value);
  if (id === null) {
    invalid(`${label} must be a positive whole number`);
  }
  return id;
}

export function lunchDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalid("Lunch date must be YYYY-MM-DD");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    invalid("Lunch date must be a real calendar date");
  }
  return value;
}

export function pollTitle(value) {
  return cleanText(value, { max: LIMITS.title, label: "Title", required: true });
}

export function optionName(value) {
  return cleanText(value, { max: LIMITS.optionName, label: "Option name", required: true });
}

export function optionDescription(value) {
  return cleanText(value, {
    max: LIMITS.description,
    label: "Description",
    required: false,
  });
}

export function voterName(value) {
  return cleanText(value, { max: LIMITS.voterName, label: "Name", required: true });
}

export function pollStatus(value) {
  if (value !== "open" && value !== "closed") {
    invalid("Status must be open or closed");
  }
  return value;
}

export function readBody(body) {
  if (body === undefined) {
    return {};
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    invalid("Request body must be a JSON object");
  }
  return body;
}
