import { Router } from "express";
import multer from "multer";

import { env } from "../config/env.js";
import { HttpError } from "../lib/http-error.js";
import { requireMutationAuth } from "../middleware/require-auth.js";

export const uploadsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"];

    if (!allowed.includes(file.mimetype)) {
      callback(new HttpError(400, "INVALID_FILE", "Please upload a JPEG, PNG or WebP image."));
      return;
    }

    callback(null, true);
  },
});

type ImgbbResponse = {
  data?: { url?: string; display_url?: string };
  error?: { message?: string };
};

uploadsRouter.post(
  "/",
  requireMutationAuth,
  upload.single("image"),
  async (request, response, next) => {
    try {
      if (!env.imgbbApiKey) {
        throw new HttpError(
          503,
          "UPLOAD_NOT_CONFIGURED",
          "Image uploads are not configured. Add IMGBB_API_KEY or paste an image URL instead."
        );
      }

      if (!request.file) {
        throw new HttpError(400, "NO_FILE", "Please choose an image to upload.");
      }

      const body = new FormData();
      body.append("image", request.file.buffer.toString("base64"));
      body.append("name", `studiospace-${Date.now()}`);

      const imgbbResponse = await fetch(
        `https://api.imgbb.com/1/upload?key=${encodeURIComponent(env.imgbbApiKey)}`,
        { method: "POST", body }
      );

      const result = (await imgbbResponse.json()) as ImgbbResponse;

      if (!imgbbResponse.ok || !result.data?.url) {
        throw new HttpError(
          502,
          "UPLOAD_FAILED",
          result.error?.message ?? "The image could not be uploaded. Please try again."
        );
      }

      response.status(201).json({
        url: result.data.display_url ?? result.data.url,
      });
    } catch (error) {
      next(error);
    }
  }
);
