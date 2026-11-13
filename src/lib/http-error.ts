/**
 * Error with an HTTP status and a stable machine-readable code.
 * The error handler turns this into a JSON response.
 */
export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}
