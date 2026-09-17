import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import type { BeautiSession } from "./session.js";

const SKIN_ID = /^skin-[a-z0-9]{8,40}$/;
const MAX_IMAGE_BYTES = 18 * 1024 * 1024;
const MAX_VIDEO_BYTES = 800 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const INSTALL_TIMEOUT_MS = 30 * 60 * 1000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);
const FALLBACK_SKIN_CENTER = "https://hnnulwh.cn";
const here = path.dirname(fileURLToPath(import.meta.url));

export function isSafeSkinId(id: string): boolean {
  return SKIN_ID.test(id);
}

export function normalizeSkinCenterUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.username || url.password || url.hash) return null;
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.protocol === "http:" && !LOOPBACK.has(url.hostname.toLowerCase())) {
      return null;
    }
    const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
    return `${url.origin}${pathname}`;
  } catch {
    return null;
  }
}

async function readJsonUrl(file: string): Promise<string | null> {
  try {
    const raw = JSON.parse(await fsp.readFile(file, "utf8")) as { url?: unknown };
    return normalizeSkinCenterUrl(raw.url);
  } catch {
    return null;
  }
}

export async function resolveSkinCenterUrl(): Promise<string | null> {
  return (
    normalizeSkinCenterUrl(process.env.BEAUTICODE_SKIN_CENTER) ??
    (await readJsonUrl(path.join(here, "skin-center.json"))) ??
    (await readJsonUrl(path.join(here, "../skin-center.json"))) ??
    normalizeSkinCenterUrl(FALLBACK_SKIN_CENTER)
  );
}

function skinUrl(center: string, id: string, part = ""): string {
  return part ? `${center}/api/skins/${id}/${part}` : `${center}/api/skins/${id}`;
}

function normalizeThemeName(value: unknown, fallback = "主题"): string {
  const name = String(value ?? "")
    .replace(/[<>:"/\\|?*]/g, " ")
    .replace(/[\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return name || fallback;
}

function extensionOf(url: string, fallback: string): string {
  try {
    const ext = path.extname(new URL(url).pathname).toLowerCase();
    if (ext) return ext;
  } catch {
    /* use fallback */
  }
  return fallback;
}

function extensionForContentType(contentType: string | null): string | null {
  const mime = String(contentType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  switch (mime) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/avif":
      return ".avif";
    default:
      return null;
  }
}

async function downloadToFile(
  url: string,
  dest: string,
  opts: { maxBytes: number; expectedOrigin: string },
): Promise<{ contentType: string | null }> {
  const expected = new URL(url);
  if (expected.origin !== opts.expectedOrigin) {
    throw new Error("Skin media download host mismatch.");
  }
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(INSTALL_TIMEOUT_MS),
  });
  if (!response.ok || !response.body) {
    throw new Error("皮肤资源下载失败。");
  }
  const finalUrl = new URL(response.url);
  if (finalUrl.origin !== expected.origin) {
    throw new Error("Skin media download host mismatch.");
  }
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > opts.maxBytes) {
    throw new Error("皮肤文件超过大小限制。");
  }
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, callback) {
      size += chunk.length;
      if (size > opts.maxBytes) {
        callback(new Error("皮肤文件超过大小限制。"));
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as never),
    limiter,
    fs.createWriteStream(dest),
  );
  return { contentType: response.headers.get("content-type") };
}

export async function skinCenterConfig(): Promise<{
  ok: true;
  url: string | null;
  enabled: boolean;
}> {
  const url = await resolveSkinCenterUrl();
  return { ok: true, url, enabled: Boolean(url) };
}

export async function skinCenterCatalog(query: {
  q?: string;
  type?: string;
}): Promise<{
  ok: boolean;
  skins: unknown[];
  nextCursor?: unknown;
  url?: string | null;
  error?: string;
}> {
  const center = await resolveSkinCenterUrl();
  if (!center) {
    return { ok: false, error: "尚未配置皮肤中心地址。", skins: [] };
  }
  const target = new URL("api/catalog", `${center}/`);
  if (query.q) target.searchParams.set("q", query.q);
  if (query.type) target.searchParams.set("type", query.type);
  let response: Response;
  try {
    response = await fetch(target, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: "无法连接皮肤中心，请稍后重试。", skins: [] };
  }
  const body = (await response.json().catch(() => null)) as {
    ok?: boolean;
    error?: string;
    skins?: unknown[];
    nextCursor?: unknown;
  } | null;
  if (!response.ok || !body || body.ok === false) {
    return {
      ok: false,
      error: body?.error || "无法读取皮肤目录。",
      skins: [],
    };
  }
  return {
    ok: true,
    skins: Array.isArray(body.skins) ? body.skins : [],
    nextCursor: body.nextCursor ?? null,
    url: center,
  };
}

export async function installSkinFromCenter(
  session: BeautiSession,
  id: string,
): Promise<{ ok: boolean; error?: string; theme?: unknown; message?: string }> {
  if (!isSafeSkinId(id)) return { ok: false, error: "皮肤 ID 无效。" };
  const center = await resolveSkinCenterUrl();
  if (!center) return { ok: false, error: "尚未配置皮肤中心地址。" };
  const origin = new URL(center).origin;
  const tmpDir = path.join(
    session.dataRoot,
    "tmp",
    "gallery",
    `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`,
  );
  try {
    const metaRes = await fetch(skinUrl(center, id), {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const meta = (await metaRes.json().catch(() => null)) as {
      skin?: { name?: string; type?: string; status?: string; effects?: unknown };
    } | null;
    const skin = meta?.skin;
    if (!metaRes.ok || !skin || (skin.status && skin.status !== "approved")) {
      throw new Error("该皮肤当前不可下载。");
    }
    await fsp.mkdir(tmpDir, { recursive: true });
    const imageUrl = skinUrl(center, id, "image");
    const imageTmp = path.join(tmpDir, "image.download");
    const imageDownload = await downloadToFile(imageUrl, imageTmp, {
      maxBytes: MAX_IMAGE_BYTES,
      expectedOrigin: origin,
    });
    const imagePath = path.join(
      tmpDir,
      `image${extensionForContentType(imageDownload.contentType) ?? extensionOf(imageUrl, ".png")}`,
    );
    await fsp.rename(imageTmp, imagePath);
    let videoPath: string | undefined;
    if (skin.type === "video") {
      videoPath = path.join(tmpDir, "background.mp4");
      await downloadToFile(skinUrl(center, id, "video"), videoPath, {
        maxBytes: MAX_VIDEO_BYTES,
        expectedOrigin: origin,
      });
    }
    const name = normalizeThemeName(skin.name || id);
    const result = videoPath
      ? await session.applyAndSaveTheme(
          { type: "video", imagePath, videoPath, source: "managed" },
          name,
        )
      : await session.applyAndSaveTheme(
          { type: "image", imagePath, source: "managed" },
          name,
        );
    if (!result.ok) return { ok: false, error: result.error || "安装失败。" };
    fetch(skinUrl(center, id, "download"), {
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => {});
    return {
      ok: true,
      theme: result.theme,
      message: `已安装并应用「${name}」。`,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
