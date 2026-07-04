# AGENT_GUIDE — מוסכמות גישה לנתונים (לכל הסוכנים)

מדריך זה משותף לכל סוכני המשנה של CEO HQ. קרא אותו לפני עבודה מול מסד הנתונים.

## מבנה הנתונים

- מפת קבצים ותיקיות: `assistant/config/database.json` (fileId לכל טבלה ותיקייה).
- סכמת עמודות: `assistant/db/schema.js` — סדר העמודות חייב להישמר.
- ישויות (עמודת Entity): `Company-A`, `Company-B`, `Nonprofit`, `Personal`.
- מזהים: `<PREFIX>-<מספר בן 4 ספרות>`, למשל `LEAD-0042`. ה-CLI מקצה ID אוטומטית.
- תאריכים: `YYYY-MM-DD`. סטטוסים סגורים: סגור / הושלם / בוצע / בוטל.

## קריאת נתונים (תמיד זמין)

השתמש בכלי ה-MCP של Google Drive (טען דרך ToolSearch אם צריך):

1. קח את ה-`fileId` של הטבלה מ-`assistant/config/database.json`.
2. `mcp__Google_Drive__read_file_content` עם ה-fileId — מחזיר את תוכן הגיליון כטקסט.
3. לחיפוש מסמכים חופשיים: `mcp__Google_Drive__search_files` (למשל `parentId = '<folder-id>'`).

אם ה-Service Account מוגדר, אפשר לקרוא גם דרך ה-CLI (פלט JSON נוח יותר):

```bash
node assistant/db/cli.js list leads --Entity Company-A --Status חדש
node assistant/db/cli.js find opportunities "שיתוף פעולה"
node assistant/db/cli.js report --Entity Nonprofit
```

## כתיבת נתונים

### מסלול ראשי — CLI (דרך Service Account)

```bash
node assistant/db/cli.js add leads '{"Entity":"Company-A","Name":"ישראל ישראלי","Source":"המלצה","Status":"חדש","NextAction":"שיחת היכרות","NextActionDate":"2026-07-10"}'
node assistant/db/cli.js update tasks TASK-0007 '{"Status":"הושלם"}'
```

- שדות שלא צוינו נשארים ריקים (ב-add) או ללא שינוי (ב-update).
- ה-CLI מחזיר JSON עם הרשומה המלאה כולל ה-ID שהוקצה.

### מסלול גיבוי — Inbox (כשאין credentials.json)

אם ה-CLI נכשל על חוסר credentials, כתוב "קובץ עדכון" לתיקיית 📥 Inbox בדרייב
(`folders.inbox.id` בקונפיג) בעזרת `mcp__Google_Drive__create_file`:

- שם הקובץ: `PENDING <table> <פעולה> <תאריך> - <תיאור קצר>`
- תוכן: CSV עם שורת כותרות של הטבלה + השורה החדשה/המעודכנת, ושורת הערה מה צריך לעשות.
- דווח למשתמש שהעדכון ממתין למיזוג (או להגדרת Service Account).

### מסמכים חופשיים (סיכומי ישיבות, תוכניות, דוחות)

צור Google Doc בתיקיית הישות המתאימה (`folders.company_a` וכו') דרך
`mcp__Google_Drive__create_file` עם `contentMimeType: text/plain` (יומר ל-Doc אוטומטית).
מוסכמת שם: `<YYYY-MM-DD> <סוג> - <נושא>`, למשל `2026-07-04 סיכום ישיבה - הנהלה שבועית`.
לאחר יצירת מסמך הקשור לרשומה — עדכן את שדה Notes של הרשומה עם קישור/שם המסמך.

## כללי התנהגות

1. **אל תמחק ואל תדרוס נתונים** — עדכן שדות ספציפיים בלבד. שורות דוגמה (מכילות "שורת דוגמה") מותר לעדכן.
2. **כל רשומה פתוחה = צעד הבא** — לעולם אל תשאיר רשומה בלי NextAction/DueDate/FollowUpDate רלוונטי.
3. **חצה ישויות בזהירות** — אל תניח שליד של Company-A רלוונטי ל-Company-B; שאל או ציין במפורש.
4. **החזר סיכום מובנה** — בסוף עבודתך החזר: מה נקרא, מה נכתב (טבלה + ID), ומה הצעד הבא המומלץ.
