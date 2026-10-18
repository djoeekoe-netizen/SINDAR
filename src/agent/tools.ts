import { Directory, Filesystem } from "@capacitor/filesystem";
import type { ToolDef } from "./types";

// المسارات نسبية لـ Directory.ExternalStorage (مثل "Download" أو "DCIM/Camera")
const DIR = Directory.ExternalStorage;

const CATEGORIES: Record<string, string[]> = {
  images: ["jpg", "jpeg", "png", "gif", "webp", "heic"],
  videos: ["mp4", "mkv", "mov", "avi", "webm"],
  audio: ["mp3", "m4a", "wav", "ogg", "flac", "opus"],
  documents: ["pdf", "doc", "docx", "txt", "xls", "xlsx", "ppt", "pptx", "md"],
  archives: ["zip", "rar", "7z", "tar", "gz"],
  apks: ["apk", "xapk"],
};

function categoryOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  for (const [cat, exts] of Object.entries(CATEGORIES)) if (exts.includes(ext)) return cat;
  return "other";
}

// منع الخروج من المجلد المسموح (path traversal)
function safe(path: string): string {
  const clean = path.replace(/^\/+/, "");
  if (clean.split("/").includes("..")) throw new Error("مسار غير مسموح");
  return clean;
}

export const tools: ToolDef[] = [
  {
    name: "list_files",
    description: "يعرض الملفات والمجلدات داخل مجلد (الاسم والنوع والحجم وتاريخ التعديل).",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "مثل Download أو DCIM" } },
      required: ["path"],
    },
    run: async ({ path }) => {
      const r = await Filesystem.readdir({ path: safe(path), directory: DIR });
      return r.files.slice(0, 300).map((f) => ({
        name: f.name,
        type: f.type,
        size: f.size,
        modified: f.mtime,
      }));
    },
  },
  {
    name: "group_files_by_type",
    description: "يصنّف ملفات مجلد حسب النوع (صور، فيديو، مستندات...) ويرجع العدد والحجم لكل فئة.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    run: async ({ path }) => {
      const r = await Filesystem.readdir({ path: safe(path), directory: DIR });
      const groups: Record<string, { count: number; bytes: number; examples: string[] }> = {};
      for (const f of r.files) {
        if (f.type === "directory") continue;
        const c = categoryOf(f.name);
        const g = (groups[c] ??= { count: 0, bytes: 0, examples: [] });
        g.count++;
        g.bytes += f.size ?? 0;
        if (g.examples.length < 3) g.examples.push(f.name);
      }
      return groups;
    },
  },
  {
    name: "create_folder",
    description: "ينشئ مجلداً جديداً.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    run: async ({ path }) => {
      await Filesystem.mkdir({ path: safe(path), directory: DIR, recursive: true });
      return { created: path };
    },
  },
  {
    name: "move_file",
    description: "ينقل أو يعيد تسمية ملف. يحتاج موافقة المستخدم.",
    risky: true,
    parameters: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"],
    },
    run: async ({ from, to }) => {
      await Filesystem.rename({ from: safe(from), to: safe(to), directory: DIR, toDirectory: DIR });
      return { moved: { from, to } };
    },
  },
  {
    name: "delete_file",
    description: "يحذف ملفاً نهائياً. يحتاج موافقة المستخدم دائماً.",
    risky: true,
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    run: async ({ path }) => {
      await Filesystem.deleteFile({ path: safe(path), directory: DIR });
      return { deleted: path };
    },
  },
  {
    name: "list_apps",
    description: "يعرض التطبيقات المثبتة على الجوال.",
    parameters: { type: "object", properties: {} },
    // يحتاج إضافة Kotlin (PackageManager). مؤجل للمرحلة 3.
    run: async () => ({ error: "غير مفعّل بعد: يحتاج الجسر الأصلي للجهاز" }),
  },
];

/** الصيغة التي يفهمها النموذج (OpenAI tools) */
export function toolSchemas(list: ToolDef[] = tools) {
  return list.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}
