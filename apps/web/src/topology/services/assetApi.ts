import { request } from "./http";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export type UploadAssetResult = {
  fileName: string;
  contentType: string;
  url: string;
};

export async function uploadImageAsset(file: File): Promise<UploadAssetResult> {
  const dataUrl = await readFileAsDataUrl(file);
  const contentType = file.type || (file.name.toLowerCase().endsWith(".svg") ? "image/svg+xml" : "");
  const result = await request<UploadAssetResult>("/api/topology/assets", {
    method: "POST",
    body: JSON.stringify({
      fileName: file.name,
      contentType,
      dataUrl
    })
  });

  return {
    ...result,
    url: result.url.startsWith("http") ? result.url : `${API_BASE_URL}${result.url}`
  };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}
