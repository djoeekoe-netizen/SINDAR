# تشغيل SINDAR على جوال Android (بدون كمبيوتر)

> الوقت المتوقع: 5–10 دقائق · التكلفة: 0 ريال · تحتاج: جوال Android 7+ واتصال إنترنت

## 1) ثبّت Termux (مرة واحدة)

Termux برنامج مجاني يحوّل جوالك إلى "كمبيوتر صغير" بداخله — فيه يعمل عقل SINDAR.

- حمّله من **F-Droid**: <https://f-droid.org/packages/com.termux/>
  (أو من GitHub: <https://github.com/termux/termux-app/releases>)
- ⚠️ **لا تستخدم نسخة Google Play** — قديمة ومعطّلة.
- اختياري لكن مفيد: **Termux:API** من F-Droid <https://f-droid.org/packages/com.termux.api/> (يسمح لـ SINDAR بإرسال إشعارات، قراءة الحافظة، الكاميرا…).

## 2) ثبّت SINDAR (أمر واحد)

افتح Termux، والصق هذا السطر ثم اضغط Enter:

```bash
curl -fsSL https://raw.githubusercontent.com/djoeekoe-netizen/SINDAR/arena/ed5f3c48-sindar/scripts/install.sh | bash
```

> للّصق في Termux: اضغط مطوّلاً على الشاشة ← **Paste**.

السكربت يقوم بما يلي تلقائياً: **تحديث Termux كاملاً** (مهم — يمنع تعارض المكتبات) ← تثبيت Node.js ← تنزيل SINDAR ← تشغيل فحص الجاهزية `sindar doctor`.

> ⚠️ لا تثبّت حزماً منفردة قبل ذلك (مثل `pkg install curl`) — `curl` موجود أصلاً في Termux، وتثبيت حزمة واحدة فوق نظام قديم يسبب خطأ `CANNOT LINK EXECUTABLE`. أبقِ الشاشة مفتوحة والشاحن موصولاً أثناء التثبيت.

في النهاية سترى تقريراً مثل:

```
فحص SINDAR — الإصدار 0.1.0 (a1b2c3d)

✔ Node.js v22.x
ℹ المنصة: Android (Termux 0.118) · arm64 · الصدَفة: bash
✔ تم إنشاء مجلد SINDAR لأول مرة: /data/data/com.termux/files/home/.sindar
✔ الإعدادات: config.yaml · النموذج الافتراضي: mock:echo
✔ قاعدة البيانات: node:sqlite · SQLite 3.x · بحث نصي FTS5 · المخطط v1
...
النتيجة: جاهز مع 2 تنبيه
```

**أرسل لي هذا التقرير كاملاً** (انسخه من Termux) — هو شرط قبول المرحلة M0.

## 3) إعدادات مهمة للجوال

| ماذا | لماذا | كيف |
|---|---|---|
| **عطّل تحسين البطارية لـ Termux** | حتى لا يغلق Android العقل في الخلفية | إعدادات Android ← التطبيقات ← Termux ← البطارية ← **غير مقيّد / Unrestricted** |
| **فعّل التخزين المشترك** | ليستطيع SINDAR قراءة ملفاتك (الصور، التنزيلات…) | في Termux: `termux-setup-storage` ثم اسمح بالإذن |
| **أبقِ Termux مفتوحاً أو في الخلفية** | الإشعار الدائم لـ Termux طبيعي — لا تزله | — |

## 4) أوامر ستحتاجها

| الأمر | الوظيفة |
|---|---|
| `sindar doctor` | فحص الجاهزية |
| `sindar doctor --lang en` | نفس الفحص بالإنجليزية (أوضح في الطرفية) |
| `sindar update` | التحديث لآخر نسخة |
| `sindar --help` | كل الأوامر |

> **ملاحظة عن النص العربي في Termux**: الطرفية تعرض العربية بشكل مقبول لكن ليس مثالياً (قد تظهر الحروف مفككة). الواجهة الجميلة بالعربية تأتي في المرحلة **M2** (من المتصفح) و**M5** (تطبيق). للطرفية يمكنك استخدام `--lang en`.

## 5) حل المشاكل

| المشكلة | الحل |
|---|---|
| `CANNOT LINK EXECUTABLE "curl": cannot locate symbol …` | Termux قديم وجرى تحديث حزمة واحدة فقط. شغّل: `apt update && apt full-upgrade -y -o Dpkg::Options::=--force-confnew` ثم أعد أمر التثبيت |
| `sindar: command not found` بعد التثبيت | أغلق Termux تماماً وافتحه من جديد |
| `npm ERR! 404` أو فشل التنزيل | المستودع خاص أو لم تُبنَ النسخة بعد — انتظر دقائق أو أخبرني |
| `Unable to locate package nodejs-lts` | شغّل `pkg update` ثم أعد المحاولة |
| التثبيت بطيء جداً | طبيعي أول مرة (تنزيل Node.js ~30MB)؛ استخدم Wi-Fi |
| Termux يُغلق تلقائياً بعد دقائق | عطّل تحسين البطارية (الخطوة 3) |

## 6) ماذا بعد؟

بعد نجاح `sindar doctor` ننتقل إلى **M1**: الدردشة الحقيقية من الطرفية بمفتاح مجاني (Groq أو Gemini) — سأرشدك للحصول عليه عندما نصل.
