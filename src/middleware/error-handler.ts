import type { NextFunction, Request, Response } from "express";
import multer from "multer";

import { HttpError } from "../lib/http-error.js";

export function notFoundHandler(
  _request: Request,
  response: Response
): void {
  response.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "This API route does not exist.",
    },
  });
}

export function errorHandler(
  error: unknown,
  _request: Request,
  response: Response,
  next: NextFunction
): void {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: { code: error.code, message: error.message },
    });
    return;
  }

  if (error instanceof multer.MulterError) {
    response.status(400).json({
      error: {
        code: error.code,
        message:
          error.code === "LIMIT_FILE_SIZE"
            ? "Image must be 5 MB or smaller."
            : "The image could not be uploaded. Please try another file.",
      },
    });
    return;
  }

  console.error("[server] Unhandled error:", error);

  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "Something went wrong on the server.",
    },
  });
}
