import { request } from "./http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export type UploadAssetResult = {
  fileName: string;
  contentType: string;
  url: string;
  ref: string;
};

export type UploadAssetContext = {
  businessType?: string;
  source?: string;
  refType?: string;
  refId?: string;
  remark?: string;
};

export async function uploadImageAsset(file: File, _context: UploadAssetContext = {}): Promise<UploadAssetResult> {
  const dataUrl = await readFileAsDataUrl(file);
  const contentType = file.type || (file.name.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "");
  const result = await request<UploadAssetResult>("/api/topology/assets", {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      contentType,
      dataUrl,
      businessType: _context.businessType
    })
  });

  const url = result.url.startsWith("http") ? result.url : `${API_BASE_URL}${result.url}`;
  return {
    ...result,
    url,
    ref: url
  };
}

export function isOssAssetRef(_value?: string) {
  return false;
}

export function isImageAsset(value?: string) {
  return !!value && (
    /^https?:\/\//.test(value)
    || value.startsWith("data:image/")
    || value.startsWith("/uploads/")
    || /\.(png|jpe?g|webp|gif|svg)(\?.*)?$/i.test(value)
  );
}

export function displayAssetText(value?: string) {
  return value ?? "";
}

export async function resolveAssetUrl(value?: string): Promise<string> {
  if (!value) return "";
  if (/^https?:\/\//.test(value) || value.startsWith("data:image/")) return value;
  return value.startsWith("/") ? `${API_BASE_URL}${value}` : value;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}
