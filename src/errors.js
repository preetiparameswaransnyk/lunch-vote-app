export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export function isUniqueConstraint(error) {
  return error?.errcode === 2067 || /UNIQUE constraint failed/.test(error?.message ?? "");
}
